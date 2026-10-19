/**
 * Sala MCP server entry point.
 *
 *   npm start            → http://localhost:3000/mcp  (Streamable HTTP)
 *   SALA_LLM=echo|proxy|bedrock  forces the backend; default selection order in
 *   src/llm/index.ts (AWS creds → Bedrock, ANTHROPIC_BASE_URL → Proxy, else Echo).
 *   SALA_DB_PATH defaults to ./data/sala.db (gitignored) — the file is the user's.
 */
import { DB_PATH, PORT } from "../config.js";
import { defaultLLM } from "../llm/index.js";
import { MemoryStore } from "../memory/db.js";
import { ACCOUNT_ID } from "../config.js";
import { createSalaHttpServer, MCP_PATH } from "./http.js";

const memory = new MemoryStore(DB_PATH, ACCOUNT_ID);
const llm = defaultLLM();
const server = createSalaHttpServer({ memory, llm });

server.listen(PORT, () => {
  // Never print env values — names only.
  console.log(
    `[sala] MCP server (Streamable HTTP) on http://localhost:${PORT}${MCP_PATH} — llm=${llm.name} db=${DB_PATH}`,
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
