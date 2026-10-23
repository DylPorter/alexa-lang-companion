/**
 * Optional LOCAL TTS server for the sim's voice mode — used ONLY when the
 * browser exposes no speechSynthesis voices (Linux/Chromium). Neural quality
 * via Piper (piper-tts venv + onnx models in data/piper-voices/).
 *
 *   node scripts/piper-tts-server.mjs          → http://127.0.0.1:5055/tts
 *   GET /tts?lang=en&text=...                  → audio/wav
 *
 * Loopback-only bind, origin allowlist for the sim dev port, text length cap,
 * no auth needed because it never leaves the machine. Not part of the
 * submission path — the demo machine may simply have good browser voices.
 */
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = Number(process.env.PIPER_PORT ?? 5055);
const ROOT = resolve(process.cwd());
const VOICES_DIR = process.env.PIPER_VOICES_DIR ?? resolve(ROOT, "data", "piper-voices");
const PIPER_BIN = process.env.PIPER_BIN ?? resolve(ROOT, ".piper-venv", "bin", "piper");
const ALLOWED_ORIGINS = (process.env.PIPER_ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:5199")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_TEXT = 600;

const MODELS = {
  en: "en_US-lessac-medium",
  fr: "fr_FR-siwis-medium",
  de: "de_DE-thorsten-medium",
};

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
  }
  return { Vary: "Origin" };
}

function synthesize(model, text) {
  return new Promise((resolveP, rejectP) => {
    mkdtemp(join(tmpdir(), "sala-tts-"))
      .then(async (dir) => {
        const out = join(dir, "out.wav");
        const child = execFile(
          PIPER_BIN,
          ["-m", join(VOICES_DIR, `${model}.onnx`), "-f", out],
          { timeout: 30_000, maxBuffer: 1024 },
          async (err) => {
            try {
              if (err) throw err;
              const wav = await readFile(out);
              resolveP(wav);
            } catch (e) {
              rejectP(e);
            } finally {
              void rm(dir, { recursive: true, force: true });
            }
          },
        );
        child.stdin.end(text);
      })
      .catch(rejectP);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors).end();
    return;
  }
  if (url.pathname !== "/tts" || req.method !== "GET") {
    res.writeHead(404, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "not found" }));
    return;
  }

  const lang = (url.searchParams.get("lang") ?? "en").slice(0, 2).toLowerCase();
  const model = MODELS[lang];
  const text = (url.searchParams.get("text") ?? "").slice(0, MAX_TEXT);
  // Split errors, deliberately. One `need lang + text` for both cases told a caller that
  // it had forgotten to pass a language when it had passed `lang=es` perfectly well — the
  // real reason is that no Spanish voice is installed here. The client shows this string
  // in the on-screen notice, so it has to be the truth.
  if (!model) {
    res.writeHead(400, { "content-type": "application/json", ...cors }).end(
      JSON.stringify({ error: `no Piper voice for lang "${lang}"`, voices: Object.keys(MODELS).sort() }),
    );
    return;
  }
  if (!text) {
    res.writeHead(400, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "need text" }));
    return;
  }

  try {
    const wav = await synthesize(model, text);
    res.writeHead(200, { "content-type": "audio/wav", "content-length": String(wav.length), ...cors });
    res.end(wav);
  } catch (err) {
    console.error("[piper-tts] synthesis failed:", err?.message ?? err);
    res.writeHead(500, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "synthesis failed" }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[piper-tts] local TTS on http://127.0.0.1:${PORT}/tts (voices: ${Object.keys(MODELS).join(", ")})`);
});
