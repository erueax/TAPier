from pyspark.sql import SparkSession
from pyspark.sql.functions import col, count, from_json, explode, collect_list, struct, to_json
from pyspark.sql.types import StructType, StringType
from pyspark.ml.feature import StringIndexer, IndexToString
from pyspark.ml.recommendation import ALS

spark = SparkSession.builder.appName("tapier-train").getOrCreate()
spark.sparkContext.setLogLevel("WARN")

# Only the two fields ALS needs
# extra fields are ignored
wc_schema = StructType().add("user_id", StringType()).add("lemma", StringType())

# Read the retained word_checks log as a BATCH
raw = (spark.read.format("kafka")
    .option("kafka.bootstrap.servers", "kafka-1:29092")
    .option("subscribe", "word_checks")
    .option("startingOffsets", "earliest")
    .option("endingOffsets", "latest")
    .load()
    .selectExpr("CAST(value AS STRING) AS v"))

checks = (raw.select(from_json(col("v"), wc_schema).alias("e"))
             .select("e.user_id", "e.lemma")
             .where(col("user_id").isNotNull() & col("lemma").isNotNull()))

# Implicit-feedback matrix: how many times each user looked up each lemma.
pairs = checks.groupBy("user_id", "lemma").agg(count("*").alias("checks"))

# ALS needs integer ids — index, keeping the fitted models to invert later
u_idx = StringIndexer(inputCol="user_id", outputCol="u").fit(pairs)
w_idx = StringIndexer(inputCol="lemma",   outputCol="w").fit(pairs)
data  = w_idx.transform(u_idx.transform(pairs))

# Train. implicitPrefs=True treats the count as a confidence (not rating)
als = ALS(userCol="u", itemCol="w", ratingCol="checks",
          implicitPrefs=True, rank=16, regParam=0.1,
          coldStartStrategy="drop", nonnegative=True)
model = als.fit(data)

# Top-10 per user, then map indices back to the real user_id and lemma.
recs = (model.recommendForAllUsers(10)
        .select("u", explode("recommendations").alias("rec"))
        .select("u", col("rec.w").alias("w"), col("rec.rating").alias("score")))

recs = IndexToString(inputCol="u", outputCol="user_id", labels=u_idx.labels).transform(recs)
recs = IndexToString(inputCol="w", outputCol="lemma",   labels=w_idx.labels).transform(recs)

# One JSON document per user, keyed by user_id, written to Kafka.
out = (recs.groupBy("user_id")
       .agg(collect_list(struct("lemma", "score")).alias("recs"))
       .select(col("user_id").alias("key"),
               to_json(struct("user_id", "recs")).alias("value")))

(out.write.format("kafka")
    .option("kafka.bootstrap.servers", "kafka-1:29092")
    .option("topic", "recommendations")
    .save())

# keep the model itself for inspection or reuse
model.write().overwrite().save("/models/als-latest")
spark.stop()