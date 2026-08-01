// Attempt Veo video generation for the story demo. Free-tier keys are EXPECTED
// to be refused — that is fine; the demo ships with animated stills by design.
// Usage: GEMINI_API_KEY=... node veo-attempt.mjs [outDir]
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY required"); process.exit(1); }

const outDir = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "video-out");
mkdirSync(outDir, { recursive: true });

const MODELS = ["veo-3.0-fast-generate-001", "veo-3.0-generate-001", "veo-2.0-generate-001"];
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const STYLE = " Abstract flat geometric animation style, off-white and near-black palette with lime, deep orchid and blue accents. No text, no logos, no realistic human faces.";
const CLIPS = [
  { id: "cold-open", prompt: "Dozens of chat message bubbles raining down around a small desk while a clock looms, dense, overwhelming, 6 second ambient loop." },
  { id: "rewind", prompt: "Message bubbles flowing backward along a curved arc into a single glowing point of light, hopeful, 6 second ambient loop." },
];

async function tryModel(model, clip) {
  const res = await fetch(`${BASE}/models/${model}:predictLongRunning`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify({
      instances: [{ prompt: clip.prompt + STYLE }],
      parameters: { aspectRatio: "16:9", durationSeconds: 6 },
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`${model}: HTTP ${res.status}`), { status: res.status });
  const { name } = await res.json();
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const poll = await fetch(`${BASE}/${name}`, { headers: { "x-goog-api-key": KEY } });
    const op = await poll.json();
    if (op.done) {
      const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) throw new Error("no video uri in response");
      const vid = await fetch(uri, { headers: { "x-goog-api-key": KEY } });
      const buf = Buffer.from(await vid.arrayBuffer());
      if (buf.length > 2.5 * 1024 * 1024) throw new Error("clip exceeds 2.5MB cap — not shipping");
      writeFileSync(join(outDir, `${clip.id}.mp4`), buf);
      return buf.length;
    }
  }
  throw new Error("timed out polling");
}

let shipped = 0;
for (const clip of CLIPS) {
  let done = false;
  for (const model of MODELS) {
    try {
      process.stdout.write(`${clip.id} via ${model} ... `);
      const bytes = await tryModel(model, clip);
      console.log(`ok, ${(bytes / 1048576).toFixed(1)}MB`);
      shipped++; done = true; break;
    } catch (err) {
      console.log(err.status ? `refused (${err.status})` : `failed: ${err.message}`);
    }
  }
  if (!done) console.log(`${clip.id}: no model available on this key.`);
}
console.log(shipped
  ? `${shipped} clip(s) generated — drop into assets/video/ to upgrade the demo.`
  : "Veo unavailable on this key — shipping animated stills (the primary design). Drop MP4s into assets/video/ later to upgrade.");
process.exit(0);
