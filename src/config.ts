/**
 * Runtime configuration + identity stub.
 *
 * IDENTITY (SPEC portability pitch): v1 is single-user. Every row is stored under
 * ACCOUNT_ID below and the SQLite file itself belongs to the user — it can be copied,
 * backed up, or deleted without any server-side account.
 *
 * PRODUCTION PATH (documented, not built in v1): Alexa+ account linking uses OAuth 2.1.
 * The MCP server would register an authorization server metadata document, the Alexa
 * client would obtain a bearer access token via the OAuth 2.1 flow (PKCE mandatory),
 * and every request would arrive with `Authorization: Bearer <token>` which the
 * StreamableHTTPServerTransport surfaces as `req.auth` (AuthInfo) when an
 * AuthProvider is configured. ACCOUNT_ID would then be derived from the validated
 * token's subject claim instead of being a constant. No schema change is needed:
 * every table already carries account_id.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as dotenv from "dotenv";

// Accept a gitignored .env next to the repo root; real env vars still win
// (dotenv never overwrites existing process.env values).
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) dotenv.config({ path: envPath, quiet: true });

export const ACCOUNT_ID = "demo-user";

// Language-agnostic product (SPEC §Positioning): defaults are configuration, not
// identity. English-first defaults match the demo persona ("review panel in clear
// simple English"); A2/video picks the actual demo language.
export const DEFAULT_TARGET_LANGUAGE = process.env.SALA_TARGET_LANG ?? "en";
export const DEFAULT_NATIVE_LANGUAGE = process.env.SALA_NATIVE_LANG ?? "en";

/** Where the user's memory DB lives. Defaults to ./data/sala.db (gitignored via *.db). */
export const DB_PATH = process.env.SALA_DB_PATH ?? resolve(process.cwd(), "data", "sala.db");

export const PORT = Number(process.env.PORT ?? 3000);
