import { start } from "./mcp.js"
import { logger } from "./logger.js"

process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason: String(reason) })
})
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { err: String(err) })
  process.exit(1)
})

await start()
