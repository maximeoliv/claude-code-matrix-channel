import { appendFileSync } from "node:fs"
import { LOG_FILE } from "./config.js"

// stdio transport: stdout MUST be reserved for JSON-RPC. Log only to file/stderr.
function ts() {
  return new Date().toISOString()
}

function fmt(level: string, msg: string, extra?: unknown) {
  let line = `${ts()} [${level}] ${msg}`
  if (extra !== undefined) {
    try {
      line += " " + JSON.stringify(extra)
    } catch {
      line += " " + String(extra)
    }
  }
  return line + "\n"
}

function write(line: string) {
  try {
    appendFileSync(LOG_FILE, line)
  } catch {
    /* ignore */
  }
  process.stderr.write(line)
}

export const logger = {
  info: (msg: string, extra?: unknown) => write(fmt("info", msg, extra)),
  warn: (msg: string, extra?: unknown) => write(fmt("warn", msg, extra)),
  error: (msg: string, extra?: unknown) => write(fmt("error", msg, extra)),
  debug: (msg: string, extra?: unknown) => {
    if (process.env.LOG_LEVEL === "debug") write(fmt("debug", msg, extra))
  },
}
