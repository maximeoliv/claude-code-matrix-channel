import { config as dotenv } from "dotenv"
import path from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")

dotenv({ path: path.join(PROJECT_ROOT, ".env") })

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function readSecretFile(p: string): string {
  return readFileSync(p, "utf8").trim()
}

export const MATRIX_HOMESERVER_URL = req("MATRIX_HOMESERVER_URL")
export const MATRIX_USER_ID = req("MATRIX_USER_ID")

const tokenFile = process.env.MATRIX_ACCESS_TOKEN_FILE
export const MATRIX_ACCESS_TOKEN = tokenFile
  ? readSecretFile(tokenFile)
  : req("MATRIX_ACCESS_TOKEN")

export const ALLOWED_SENDERS: Set<string> = new Set(
  (process.env.ALLOWED_SENDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

export const ALLOWED_ROOMS: Set<string> = new Set(
  (process.env.ALLOWED_ROOMS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

export const ADMIN_ROOM_ID = process.env.ADMIN_ROOM_ID ?? ""

export const LOG_FILE = process.env.LOG_FILE ?? path.join(PROJECT_ROOT, "matrix-channel.log")
