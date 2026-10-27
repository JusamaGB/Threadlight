const require_stt = require("./chunks/stt-CHNEib_B.js");
// src/shared/speechText.ts
var MAX_PHRASE_WORDS = 6;
var RUN = 3;
function collapseRepeats(text) {
	const words = text.split(/\s+/).filter(Boolean);
	const norm = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
	const out = [];
	let i = 0;
	while (i < words.length) {
		let collapsed = false;
		for (let size = 1; size <= MAX_PHRASE_WORDS && !collapsed; size++) {
			const phrase = words.slice(i, i + size).map(norm);
			if (phrase.length < size || phrase.every((w) => !w)) break;
			let runs = 1;
			while (words.slice(i + runs * size, i + (runs + 1) * size).map(norm).join(" ") === phrase.join(" ")) runs += 1;
			if (runs >= RUN) {
				out.push(...words.slice(i, i + size).map((w, k) => k === size - 1 ? stripEnd(w) : w));
				out[out.length - 1] += "…";
				i += runs * size;
				collapsed = true;
			}
		}
		if (!collapsed) out.push(words[i++]);
	}
	return out.join(" ");
}
/** A phrase's last word without its trailing comma or full stop, before the "…". */
function stripEnd(word) {
	return word.replace(/[,.;:!?]+$/, "");
}
// src/main/stt/worker.ts
/** Whisper hears 30 s at a time; anything longer goes in overlapping 30 s chunks. */
var CHUNK_S = 30;
var transcriber = null;
var post = (message) => process.parentPort.postMessage(message);
process.parentPort.on("message", (event) => {
	const message = event.data;
	if (message.type === "load") load(message.cacheDir, message.allowDownload);
	else if (message.type === "transcribe") transcribe(message.id, message.audio);
});
async function load(cacheDir, allowDownload) {
	try {
		const { pipeline, env } = await import("@huggingface/transformers");
		env.cacheDir = cacheDir;
		env.allowRemoteModels = allowDownload;
		const files = /* @__PURE__ */ new Map();
		transcriber = await pipeline("automatic-speech-recognition", require_stt.STT_MODEL, {
			dtype: "q8",
			device: "cpu",
			progress_callback: (info) => {
				if (info.status !== "progress" || !info.file) return;
				files.set(info.file, {
					loaded: info.loaded ?? 0,
					total: info.total ?? 0
				});
				const totals = [...files.values()].reduce((sum, f) => ({
					loaded: sum.loaded + f.loaded,
					total: sum.total + f.total
				}), {
					loaded: 0,
					total: 0
				});
				if (totals.total > 0) post({
					type: "progress",
					progress: totals.loaded / totals.total
				});
			}
		});
		post({ type: "ready" });
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		if (!allowDownload) post({ type: "missing" });
		else post({
			type: "load-error",
			message: text
		});
	}
}
async function transcribe(id, audio) {
	if (!transcriber) return post({
		type: "failed",
		id,
		message: "The speech model is not loaded."
	});
	try {
		const long = audio.length > CHUNK_S * require_stt.STT_SAMPLE_RATE;
		const output = await transcriber(audio, long ? {
			chunk_length_s: CHUNK_S,
			stride_length_s: 5
		} : void 0);
		post({
			type: "result",
			id,
			text: collapseRepeats((Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text).trim())
		});
	} catch (error) {
		post({
			type: "failed",
			id,
			message: error instanceof Error ? error.message : String(error)
		});
	}
}
