// Generate study illustrations via Gemini image API.
// Usage: GEMINI_API_KEY=... node generate-images.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("GEMINI_API_KEY env var is required. Never hardcode the key.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || join(here, "out");
mkdirSync(outDir, { recursive: true });

const promptsFile = process.argv[3] || join(here, "prompts.json");
const spec = JSON.parse(readFileSync(promptsFile, "utf8"));
const { styleSuffix, images } = spec;

const MODEL = "gemini-2.5-flash-image";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function generate(img, withAspect) {
  const suffix = (img.suffixKey && spec[img.suffixKey]) || styleSuffix;
  const body = {
    contents: [{ parts: [{ text: img.prompt + suffix }] }],
    generationConfig: withAspect
      ? { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: img.aspect } }
      : { responseModalities: ["IMAGE"] },
  };
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`), {
      status: res.status,
    });
  }
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) throw new Error(`No image in response: ${JSON.stringify(json).slice(0, 300)}`);
  return Buffer.from(imagePart.inlineData.data, "base64");
}

let failures = 0;
for (const img of images) {
  process.stdout.write(`${img.id} (${img.aspect}) ... `);
  try {
    let buf;
    try {
      buf = await generate(img, true);
    } catch (err) {
      if (err.status === 400) {
        process.stdout.write("(retrying without aspect config) ");
        buf = await generate(img, false);
      } else throw err;
    }
    const file = join(outDir, `${img.id}.png`);
    writeFileSync(file, buf);
    console.log(`ok, ${(buf.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    failures++;
    console.log(`FAILED: ${err.message}`);
  }
}
console.log(failures ? `${failures} image(s) failed` : "all images generated");
process.exit(failures ? 1 : 0);
