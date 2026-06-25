let SETTINGS = { base: "http://localhost:8080", key: "" };

async function loadSettings() {
	const s = await chrome.storage.local.get(["server_base", "demo_key"]);
	SETTINGS.base = s.server_base || "http://localhost:8080";
	SETTINGS.key = s.demo_key || "";
}

// Attach the access code to every request.
function authHeaders(extra = {}) {
	const h = { ...extra };
	if (SETTINGS.key) h["X-Demo-Key"] = SETTINGS.key;
	return h;
}

const ingestUrl = () => `${SETTINGS.base}/ingest/sentences`;
const resultUrl = (id) => `${SETTINGS.base}/es/sentence_results/_doc/${id}`;
const wordChecksUrl = () => `${SETTINGS.base}/es/word_checks/_search`;
const recUrl = (id) => `${SETTINGS.base}/es/recommendations/_doc/${id}`;

let current = null;   // current selection
let latestId = null;  // to stop an older result from rendering over a newer one
let USER_ID = null;
chrome.storage.local.get("user_id").then((s) => {
	USER_ID = s.user_id || null;
});

const els = {
	source: document.getElementById("source"),
	excerpt: document.getElementById("excerpt"),
	selection: document.getElementById("selection"),
	empty: document.getElementById("empty"),
	result: document.getElementById("result"),
	resultSection: document.getElementById("result-section"),
	btn: document.getElementById("send-btn"),
	status: document.getElementById("send-status"),
};

const CFORM_EN = {
	"連用形-一般": "continuative (-masu stem)",
	"連用形-促音便": "continuative (て/た)",
	"未然形-一般": "irrealis (negative stem)",
	"終止形-一般": "terminal (dictionary)",
	"連体形-一般": "attributive",
	"仮定形-一般": "hypothetical (-ば)",
	"命令形": "imperative",
	"意志推量形": "volitional",
};

async function emitWordCheck(tok, sentenceData) {
	try {
		await fetch(ingestUrl(), {
			method: "POST",
			headers: authHeaders({ "Content-Type": "application/json; charset=utf-8" }),
			body: JSON.stringify({
				event_type: "word_check",              // ← the routing key
				id: crypto.randomUUID(),               // unique per click
				sentence_id: sentenceData.id,          // ties back to the sentence
				user_id: USER_ID || "anonymous",       // pseudonymous install id
				lemma: tok.lemma || tok.surface || "",
				surface: tok.surface || "",
				pos: tok.pos || "",
				pos_en: tok.pos_en || "",
				cform: tok.cform || "",
				conjugation: tok.conjugation || "",    // plain-English chain
				reading: tok.reading || "",
				url: sentenceData.url || "",
				ts: Date.now(),
			}),
		});
	} catch (e) {
		// 
	}
}

// Updates state whenever a new sentence arrives.
function setCurrent(selection) {
	current = selection;
	if (!selection?.text) return;
	els.excerpt.textContent = selection.text;
	els.source.textContent = selection.title || selection.url || "";
	els.selection.hidden = false;
	els.empty.hidden = true;
	els.resultSection.hidden = true;   // clear the previous sentence's result
	els.result.textContent = "";
	els.status.textContent = "";
	els.btn.disabled = false;
}

// Panel opened via context menu read what the worker stored.
chrome.storage.session.get("lastSelection").then((res) => {
	if (res.lastSelection) setCurrent(res.lastSelection);
});

// New selection while the panel stays open, storage.onChanged.
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "session" && changes.lastSelection?.newValue) {
		setCurrent(changes.lastSelection.newValue);
	}
});

// live highlights pushed by the content script.
chrome.runtime.onMessage.addListener((msg) => {
	if (msg.type === "live-selection") setCurrent(msg.payload);
});

// Send current text, then poll for the result by its id.
els.btn.addEventListener("click", async () => {
	if (!current?.text) return;
	await loadSettings();             // pick up the server URL / access code
	const id = crypto.randomUUID();   // unique across instances
	latestId = id;
	els.btn.disabled = true;
	els.status.textContent = "Sending…";
	els.result.textContent = "";
	try {
		await sendToFluentBit({
			id,
			text: current.text,         // captured Japanese sentence, UTF-8
			url: current.url,
			title: current.title,
			ts: Date.now(),
		});
		els.status.textContent = "Waiting for result…";
		const data = await awaitResult(id);
		if (id !== latestId) return;    // a newer selection was sent meanwhile
		renderResult(data);
		els.status.textContent = "Done ✓";
	} catch (err) {
		if (id === latestId) els.status.textContent = `Failed: ${err.message}`;
	} finally {
		els.btn.disabled = false;
	}
});

async function sendToFluentBit(record) {
	const res = await fetch(ingestUrl(), {
		method: "POST",
		headers: authHeaders({ "Content-Type": "application/json; charset=utf-8" }),
		body: JSON.stringify(record),
	});
	if (!res.ok) throw new Error(`ingest HTTP ${res.status}`);
}

// Poll the result store until Spark has written our id 
async function awaitResult(id, { tries = 30, intervalMs = 1000 } = {}) {
	for (let i = 0; i < tries; i++) {
		const res = await fetch(resultUrl(id), { headers: authHeaders() });
		if (res.status === 200) {
			const doc = await res.json();
			if (doc.found) return doc._source;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error("timed out waiting for result");
}

// Renderer (of the result)
function renderResult(data) {
	els.resultSection.hidden = false;
	els.result.replaceChildren();

	if (data.status === "rejected") {
		els.result.textContent =
			data.reason === "no_japanese"
				? "No analysis: the selection contains no Japanese text."
				: "No analysis available for this selection.";
		return;
	}

	const tokens = Array.isArray(data.tokens) ? data.tokens : [];
	if (!tokens.length) {
		els.result.textContent = "No tokens returned.";
		return;
	}

	// Vertical, right-to-left sentence
	const sentence = document.createElement("div");
	sentence.className = "tategaki";

	tokens.forEach((tok, i) => {
		const surface = tok.surface ?? "";
		if (!surface.trim()) return;
		const atom = document.createElement("span");
		atom.className = "atom";
		atom.dataset.index = i;
		atom.dataset.pos = tok.pos_en || "other";
		atom.textContent = surface;
		sentence.appendChild(atom);
	});

	// Detail box shown below when an atom is clicked.
	const detail = document.createElement("div");
	detail.className = "atom-detail";
	detail.hidden = true;

	sentence.addEventListener("click", (e) => {
		const atom = e.target.closest(".atom");
		if (!atom) return;
		sentence.querySelectorAll(".atom.selected")
			.forEach((el) => el.classList.remove("selected"));
		atom.classList.add("selected");
		const tok = tokens[Number(atom.dataset.index)];
		showDetail(detail, tok);
		emitWordCheck(tok, data);
	});

	const wrap = document.createElement("div");
	wrap.className = "tategaki-wrap";
	wrap.appendChild(sentence);

	els.result.append(wrap, detail);

	// Start the view on the rightmost column
	sentence.scrollLeft = sentence.scrollWidth;
}

function showDetail(box, tok) {
	const surface = tok.surface ?? "";
	const lemma = tok.lemma || surface;
	const reading = tok.reading || "";
	const pos = tok.pos || "";
	const posEn = tok.pos_en || "";

	box.replaceChildren();
	box.hidden = false;

	const word = document.createElement("div");
	word.className = "ad-word";
	word.textContent = surface;

	if (reading) {
		const r = document.createElement("div");
		r.className = "ad-reading";
		r.textContent = reading;
		box.append(word, r);
	} else {
		box.append(word);
	}

	// Plain-English conjugation chain from Spark
	if (tok.conjugation) {
		const c = document.createElement("div");
		c.className = "ad-conj";
		c.textContent = tok.conjugation;
		box.append(c);
	}

	// Grammatical form name from cForm
	if (tok.cform) {
		const conj = document.createElement("div");
		conj.className = "ad-conj";
		conj.textContent = CFORM_EN[tok.cform]
			? `${tok.cform} (${CFORM_EN[tok.cform]})`
			: tok.cform;
		box.append(conj);
	}

	const posLine = document.createElement("div");
	posLine.className = "ad-pos";
	posLine.textContent = posEn ? `${pos} (${posEn})` : pos;

	const link = document.createElement("a");
	link.className = "ad-link";
	link.href = `https://jisho.org/search/${encodeURIComponent(lemma)}`;
	link.target = "_blank";
	link.rel = "noopener";
	link.textContent = `「${lemma}」を Jisho で調べる ↗`;

	box.append(posLine, link);
}

// Fetch this user's own aggregated stats (most-checked words & conjugations).
async function fetchMyStats() {
	if (!USER_ID) return null;
	const body = {
		size: 0,
		query: { term: { user_id: USER_ID } },
		aggs: {
			top_words: { terms: { field: "lemma", size: 10, order: { _count: "desc" } } },
			top_conj: { terms: { field: "conjugation", size: 10, order: { _count: "desc" } } },
		},
	};
	try {
		const res = await fetch(wordChecksUrl(), {
			method: "POST",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify(body),
		});
		if (!res.ok) return null;
		const data = await res.json();
		return {
			words: data.aggregations?.top_words?.buckets ?? [],
			conjugations: data.aggregations?.top_conj?.buckets ?? [],
		};
	} catch {
		return null;
	}
}

// Relabel the empty-string conjugation bucket for display.
function conjLabel(key) {
	return key === "" ? "base form (no conjugation)" : key;
}

const statsBtn = document.getElementById("stats-btn");
const statsBox = document.getElementById("my-stats");
let statsShown = false;

statsBtn.addEventListener("click", async () => {
	statsShown = !statsShown;                 // flip on every click

	if (!statsShown) {                        // second click: hide
		statsBox.hidden = true;
		statsBtn.textContent = "Show my stats";
		return;
	}

	statsBox.hidden = false;                  // first click: show
	statsBtn.textContent = "Hide my stats";
	statsBox.textContent = "Loading…";
	await loadSettings();
	renderMyStats(statsBox, await fetchMyStats());
});

function renderMyStats(box, stats) {
	box.replaceChildren();
	if (!stats || (!stats.words.length && !stats.conjugations.length)) {
		box.textContent = "No history yet — check a few words to see your stats.";
		return;
	}

	if (stats.words.length) {
		const h = document.createElement("h2");
		h.textContent = "Your most-checked words";
		box.appendChild(h);

		const grid = document.createElement("div");
		grid.className = "word-grid";

		stats.words.forEach((b) => {
			const card = document.createElement("a");
			card.className = "word-card";
			card.href = `https://jisho.org/search/${encodeURIComponent(b.key)}`;
			card.target = "_blank";
			card.rel = "noopener";

			const word = document.createElement("span");
			word.className = "wc-word";
			word.textContent = b.key;

			const count = document.createElement("span");
			count.className = "wc-count";
			count.textContent = `×${b.doc_count}`;

			const cue = document.createElement("span");
			cue.className = "wc-jisho";
			cue.textContent = "Jisho ↗";

			card.append(word, count, cue);
			grid.appendChild(card);
		});
		box.appendChild(grid);
	}

	// Conjugations have a smaller list
	if (stats.conjugations.length) {
		const h = document.createElement("h2");
		h.textContent = "Your most-checked conjugations";
		box.appendChild(h);

		const ul = document.createElement("ul");
		ul.className = "stats-list";
		stats.conjugations.forEach((b) => {
			const li = document.createElement("li");
			const name = document.createElement("span");
			name.textContent = conjLabel(b.key);
			const count = document.createElement("span");
			count.className = "stats-count";
			count.textContent = b.doc_count;
			li.append(name, count);
			ul.appendChild(li);
		});
		box.appendChild(ul);
	}
}

async function loadRecommendations() {
	await loadSettings();
	const { user_id } = await chrome.storage.local.get("user_id");
	try {
		const r = await fetch(recUrl(user_id), { headers: authHeaders() });
		if (!r.ok) throw 0;
		const doc = await r.json();
		return doc._source.recs;                       // [{lemma, score}, ...]
	} catch {
		// cold start: most-checked words overall (your existing aggregation)
		const r = await fetch(wordChecksUrl(), {
			method: "POST",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({
				size: 0,
				aggs: { top: { terms: { field: "lemma", size: 10 } } }
			})
		});
		const j = await r.json();
		return j.aggregations.top.buckets.map(b => ({ lemma: b.key, score: b.doc_count }));
	}
}

const jishoUrl = (w) => `https://jisho.org/search/${encodeURIComponent(w)}`;

function renderRecommendations(items) {
	const section = document.getElementById("recommendations");
	const grid = document.getElementById("rec-grid");
	grid.replaceChildren();                       // clear any previous render
	if (!items?.length) { section.hidden = true; return; }

	for (const { lemma, score } of items) {
		const card = document.createElement("a");
		card.className = "word-card";
		card.href = jishoUrl(lemma);
		card.target = "_blank";
		card.rel = "noopener";

		const word = Object.assign(document.createElement("span"),
			{ className: "wc-word", textContent: lemma });
		const value = Object.assign(document.createElement("span"),
			{
				className: "wc-count",
				textContent: Number.isInteger(score) ? score : score.toFixed(2)
			});
		const tag = Object.assign(document.createElement("span"),
			{ className: "wc-jisho", textContent: "Jisho \u2197" });

		card.append(word, value, tag);
		grid.appendChild(card);
	}
	section.hidden = false;
}

document.addEventListener("DOMContentLoaded", async () => {
	try {
		renderRecommendations(await loadRecommendations());
	} catch (err) {
		console.error("recommendations failed", err);
	}
});