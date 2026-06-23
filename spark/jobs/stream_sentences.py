from pyspark.sql import SparkSession
from pyspark.sql.functions import col, from_json, to_json, struct, udf, lit, size
from pyspark.sql.types import (StructType, StructField, StringType, LongType,
                               ArrayType)

# Create Spark Session
spark = SparkSession.builder.appName("sentence-analyzer").getOrCreate()
spark.sparkContext.setLogLevel("WARN")

# Ingested JSON schema
schema = (StructType()
    .add("id", StringType()).add("text", StringType())
    .add("url", StringType()).add("ts", LongType()))

# analyzer: loaded ONCE per Python worker via a lazy global 
_tagger = None
def get_tagger():
    global _tagger
    if _tagger is None:
        import fugashi
        _tagger = fugashi.Tagger()
    return _tagger

POS_EN = {
    "名詞": "noun", "動詞": "verb", "形容詞": "adjective", "形状詞": "adj-na",
    "副詞": "adverb", "助詞": "particle", "助動詞": "auxiliary",
    "接続詞": "conjunction", "連体詞": "adnominal", "感動詞": "interjection",
    "代名詞": "pronoun", "接頭辞": "prefix", "接尾辞": "suffix",
    "記号": "symbol", "補助記号": "symbol", "空白": "whitespace",
}

# Morphemes that ATTACH to a preceding verb/adjective rather than standing alone.
CONTINUERS = {"助動詞", "接尾辞"}              # auxiliary, suffix
ATTACH_PARTICLES = {"て", "で"}               # conjunctive particles act as endings

# Plain-English meaning of common auxiliaries, for the conjugation summary.
AUX_MEANING = {
    "た": "past", "だ": "past", "ない": "negative", "なかっ": "negative",
    "ぬ": "negative", "ん": "negative", "られ": "potential/passive",
    "れ": "potential/passive", "せ": "causative", "させ": "causative",
    "たい": "desiderative", "ます": "polite", "ませ": "polite",
    "ば": "conditional", "う": "volitional", "よう": "volitional",
    "て": "te-form", "で": "te-form", "てる": "progressive",
}

def _clean(v):
    return None if v in (None, "", "*") else v

# Here is described what each token will contain
token_schema = ArrayType(StructType([
    StructField("surface",     StringType()),   # text as it appears (merged)
    StructField("lemma",       StringType()),   # dictionary form (head)
    StructField("reading",     StringType()),   # katakana reading (merged)
    StructField("pos",         StringType()),   # part of speech (Japanese)
    StructField("pos_en",      StringType()),   # part of speech (English)
    StructField("ctype",       StringType()),   # conjugation type
    StructField("cform",       StringType()),   # conjugation form (final piece)
    StructField("conjugation", StringType()),   # plain-English summary
]))

# Used to not atomize declined words too much (correct term helper verbs)
def merge_phrases(tokens):
	# Inspired by how Yomitan does it
    out = []
    i = 0
    while i < len(tokens):
        t = dict(tokens[i])
        out.append(t)
        if t["pos"] in ("動詞", "形容詞", "形状詞"):
            surface = t["surface"]
            reading = t.get("reading", "")
            last_cform = t.get("cform", "")
            meanings = []
            j = i + 1
            while j < len(tokens):
                nxt = tokens[j]
                is_continuer = nxt["pos"] in CONTINUERS
                is_attach_particle = (
                    nxt["pos"] == "助詞" and nxt["surface"] in ATTACH_PARTICLES
                )
                if not (is_continuer or is_attach_particle):
                    break
                surface += nxt["surface"]
                reading += nxt.get("reading", "")
                if nxt.get("cform"):
                    last_cform = nxt["cform"]
                m = AUX_MEANING.get(nxt["surface"])
                if m and m not in meanings:
                    meanings.append(m)
                j += 1
            t["surface"] = surface
            t["reading"] = reading
            t["cform"]   = last_cform
            t["conjugation"] = " · ".join(meanings)   # e.g. "potential · negative · past"
            i = j
        else:
            t.setdefault("conjugation", "")
            i += 1
    return out

def analyze_text(text):
    if not text:
        return []
    try:
        tagger = get_tagger()
        toks = []
        for word in tagger(text):
            f = word.feature
            pos1 = _clean(getattr(f, "pos1", None)) or ""
            toks.append({
                "surface":     word.surface,
                "lemma":       _clean(getattr(f, "lemma", None)) or word.surface,
                "reading":     _clean(getattr(f, "kana", None)) or "",
                "pos":         pos1,
                "pos_en":      POS_EN.get(pos1, pos1),
                "ctype":       _clean(getattr(f, "cType", None)) or "",
                "cform":       _clean(getattr(f, "cForm", None)) or "",
                "conjugation": "",
            })
        return merge_phrases(toks)            # collapse conjugations
    except Exception:
        return []

# Rem. User Defined Function, Lmbda and Arguments
analyze_udf = udf(analyze_text, token_schema)

# stream: read sentences -> analyze -> write results 
raw = (spark.readStream.format("kafka")
    .option("kafka.bootstrap.servers", "kafka-1:29092")
    .option("subscribePattern", "^sentences$")
    .option("startingOffsets", "earliest")
    .option("failOnDataLoss", "false")
    .load())

parsed = (raw
    .selectExpr("CAST(value AS STRING) AS value")
    .select(from_json(col("value"), schema).alias("e"))
    .select("e.id", "e.text", "e.url", "e.ts"))

analyzed = (parsed
    .withColumn("tokens", analyze_udf(col("text")))
    .withColumn("token_count", size(col("tokens")))
    .withColumn("status", lit("analyzed")))

results = analyzed.select(
    col("id").alias("key"),
    to_json(struct("id", "text", "url", "ts",
                   "status", "token_count", "tokens")).alias("value"),
)

query = (results.writeStream
    .format("kafka")
    .option("kafka.bootstrap.servers", "kafka-1:29092")
    .option("topic", "results")
    .option("checkpointLocation", "/tmp/checkpoints/results")
    .start())
query.awaitTermination()