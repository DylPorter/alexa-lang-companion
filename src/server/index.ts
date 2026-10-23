/**
 * Sala MCP server entry point.
 *
 *   npm start            → http://127.0.0.1:3000/mcp  (Streamable HTTP)
 *   SALA_LLM=echo|proxy|bedrock|openai|gemini  forces the backend; default selection order
 *   in src/llm/index.ts (AWS creds → Bedrock, ANTHROPIC_BASE_URL → Proxy, a Gemini key →
 *   Gemini, an OpenAI key → OpenAI, else Echo) — so a teammate who only exports his own
 *   key needs no flag at all. /health reports which one actually won.
 *   SALA_DB_PATH defaults to ./data/sala.db (gitignored) — the file is the user's.
 *
 * SECURITY (local-first demo): binds LOOPBACK by default — wider binding is an
 * explicit opt-in via SALA_HOST (e.g. 0.0.0.0 to let the A2 sim dev server or a
 * phone reach it; do NOT do that on untrusted networks: there is no request
 * auth in v1). Host/Origin allowlists + DNS-rebinding protection are wired
 * from SALA_HOST/PORT; the production auth path is OAuth 2.1 account linking
 * (bearer via AuthProvider → req.auth) — documented in src/config.ts.
 */
import { ACCOUNT_ID, DB_PATH, PORT } from "../config.js";
import { defaultLLM } from "../llm/index.js";
import { MemoryStore } from "../memory/db.js";
import { createSalaHttpServer } from "./http.js";

const HOST = process.env.SALA_HOST ?? "127.0.0.1";

// Host-header allowlist: the loopback names we actually serve on. When SALA_HOST
// is widened, callers must use an allowed host name — extend via
// SALA_ALLOWED_HOSTS (comma-separated) rather than disabling the check.
const allowedHosts =
  process.env.SALA_ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean) ??
  [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
const allowedOrigins =
  process.env.SALA_ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];

const memory = new MemoryStore(DB_PATH, ACCOUNT_ID);
const llm = defaultLLM();
const server = createSalaHttpServer({ memory, llm }, { allowedHosts, allowedOrigins });

server.listen(PORT, HOST, () => {
  // Never print env values — names only.
  console.log(
    `[sala] MCP server (Streamable HTTP) on http://${HOST}:${PORT}/mcp — llm=${llm.name} db=${DB_PATH}`,
  );
});

const shutdown = () => {
  server.close(() => {
    memory.close();
    process.exit(0);
  });
  // force-exit if connections linger (SSE streams)
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
