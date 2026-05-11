import {
  MatrixClient,
  SimpleFsStorageProvider,
  AutojoinRoomsMixin,
} from "matrix-bot-sdk"
import path from "node:path"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import MarkdownIt from "markdown-it"
import {
  MATRIX_HOMESERVER_URL,
  MATRIX_ACCESS_TOKEN,
  MATRIX_USER_ID,
} from "./config.js"
import { logger } from "./logger.js"
import { handleMedia } from "./media.js"

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

function renderMarkdown(text: string): string {
  return md.render(text).replace(/<hr\s*\/?>/g, "").trim()
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORE_DIR = path.resolve(__dirname, "..", "store")
mkdirSync(STORE_DIR, { recursive: true })

const storage = new SimpleFsStorageProvider(path.join(STORE_DIR, "bot.json"))

export const client = new MatrixClient(
  MATRIX_HOMESERVER_URL,
  MATRIX_ACCESS_TOKEN,
  storage,
)

AutojoinRoomsMixin.setupOnClient(client)

export type IncomingMessage = {
  roomId: string
  sender: string
  body: string
  ts: number
  threadRoot?: string
  eventId: string
}

const MEDIA_MSGTYPES = new Set(["m.image", "m.audio", "m.video", "m.file"])

export function onMessage(handler: (msg: IncomingMessage) => void) {
  client.on("room.message", async (roomId: string, ev: any) => {
    try {
      if (!ev?.content) return
      if (ev.sender === MATRIX_USER_ID) return
      const msgtype = ev.content.msgtype
      const rel = ev.content["m.relates_to"]
      const threadRoot = rel?.rel_type === "m.thread" ? rel.event_id : undefined
      let body: string

      if (msgtype === "m.text" || msgtype === "m.notice") {
        body = String(ev.content.body ?? "")
      } else if (MEDIA_MSGTYPES.has(msgtype)) {
        const summary = await handleMedia(client, ev)
        if (!summary) return
        body = summary.body
      } else {
        return
      }

      if (!body) return

      handler({
        roomId,
        sender: ev.sender,
        body,
        ts: ev.origin_server_ts ?? Date.now(),
        threadRoot,
        eventId: ev.event_id,
      })
    } catch (err) {
      logger.error("onMessage handler crashed", { err: String(err) })
    }
  })
}

export function onReaction(
  handler: (info: { roomId: string; sender: string; targetEventId: string; key: string }) => void,
) {
  client.on("room.event", (roomId: string, ev: any) => {
    try {
      if (ev?.type !== "m.reaction") return
      if (ev.sender === MATRIX_USER_ID) return
      const rel = ev.content?.["m.relates_to"]
      if (!rel || rel.rel_type !== "m.annotation") return
      handler({
        roomId,
        sender: ev.sender,
        targetEventId: rel.event_id,
        key: rel.key,
      })
    } catch (err) {
      logger.error("onReaction handler crashed", { err: String(err) })
    }
  })
}

export async function sendReaction(roomId: string, targetEventId: string, key: string) {
  return await client.sendEvent(roomId, "m.reaction", {
    "m.relates_to": { rel_type: "m.annotation", event_id: targetEventId, key },
  })
}

export async function sendReply(roomId: string, text: string, threadRoot?: string) {
  const content: any = {
    msgtype: "m.text",
    body: text,
    format: "org.matrix.custom.html",
    formatted_body: renderMarkdown(text),
  }
  if (threadRoot) {
    content["m.relates_to"] = {
      rel_type: "m.thread",
      event_id: threadRoot,
      is_falling_back: true,
      "m.in_reply_to": { event_id: threadRoot },
    }
  }
  return await client.sendMessage(roomId, content)
}

export async function startMatrix() {
  const w = await client.getWhoAmI()
  logger.info("matrix logged in", { user: w.user_id, device: w.device_id })
  await client.start()
  logger.info("matrix sync running")
}
