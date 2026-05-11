import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { MatrixClient } from "matrix-bot-sdk"
import { logger } from "./logger.js"

const MEDIA_DIR = "/tmp/matrix-channel"
mkdirSync(MEDIA_DIR, { recursive: true })

const AUDIO_BRIDGE = process.env.AUDIO_BRIDGE_URL ?? "http://10.0.0.1:8889"

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
}

function safeName(eventId: string, ext: string): string {
  const safe = eventId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-32)
  return `${Date.now()}_${safe}.${ext}`
}

function extFromMime(mime: string | undefined, fallback: string): string {
  if (!mime) return fallback
  return EXT_BY_MIME[mime.toLowerCase()] ?? fallback
}

export async function saveMxcMedia(
  client: MatrixClient,
  mxcUrl: string,
  eventId: string,
  fallbackExt: string,
): Promise<{ path: string; size: number; mime: string } | null> {
  try {
    const r: any = await (client as any).downloadContent(mxcUrl)
    const data: Buffer = r.data ?? r
    const mime: string = r.contentType ?? r.content_type ?? "application/octet-stream"
    const ext = extFromMime(mime, fallbackExt)
    const filePath = path.join(MEDIA_DIR, safeName(eventId, ext))
    writeFileSync(filePath, data)
    return { path: filePath, size: data.length, mime }
  } catch (err) {
    logger.warn("saveMxcMedia failed", { mxcUrl, err: String(err) })
    return null
  }
}

export async function transcribeAudio(filePath: string): Promise<string | null> {
  try {
    const fs = await import("node:fs")
    const buf = fs.readFileSync(filePath)
    const fileName = path.basename(filePath)
    const boundary = `----matrix-channel-${Date.now()}`
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([head, buf, tail])
    const url = `${AUDIO_BRIDGE}/v1/audio/transcriptions`
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => "")
      logger.warn("transcribeAudio HTTP", { status: r.status, body: t.slice(0, 200) })
      return null
    }
    const j: any = await r.json()
    return typeof j.text === "string" ? j.text : null
  } catch (err) {
    logger.warn("transcribeAudio failed", { err: String(err) })
    return null
  }
}

export type MediaSummary = {
  body: string
  filePath?: string
  mime?: string
  size?: number
  transcript?: string
}

export async function handleMedia(
  client: MatrixClient,
  ev: any,
): Promise<MediaSummary | null> {
  const c = ev.content || {}
  const msgtype = c.msgtype as string
  const url = c.url as string | undefined
  const filename = c.body || c.filename || "(unnamed)"
  const eventId = ev.event_id || `${Date.now()}`
  if (!url || !url.startsWith("mxc://")) {
    return { body: `[${msgtype} without mxc url] ${filename}` }
  }

  let fallbackExt = "bin"
  if (msgtype === "m.image") fallbackExt = "png"
  else if (msgtype === "m.video") fallbackExt = "mp4"
  else if (msgtype === "m.audio") fallbackExt = "ogg"
  else if (msgtype === "m.file") fallbackExt = "bin"

  const saved = await saveMxcMedia(client, url, eventId, fallbackExt)
  if (!saved) {
    return { body: `[${msgtype} download failed] ${filename}` }
  }

  if (msgtype === "m.image") {
    return {
      body:
        `[image attached] file: ${filename}\n` +
        `local path: ${saved.path}\n` +
        `mime: ${saved.mime}  size: ${saved.size} bytes\n` +
        `(use Read on the local path to view it)`,
      filePath: saved.path,
      mime: saved.mime,
      size: saved.size,
    }
  }

  if (msgtype === "m.audio") {
    const transcript = await transcribeAudio(saved.path)
    if (transcript) {
      return {
        body:
          `[voice transcribed]\n${transcript}\n\n` +
          `(audio file at ${saved.path}, ${saved.size} bytes)`,
        filePath: saved.path,
        mime: saved.mime,
        size: saved.size,
        transcript,
      }
    }
    return {
      body:
        `[audio attached, transcription failed]\n` +
        `file: ${filename}  path: ${saved.path}  mime: ${saved.mime}`,
      filePath: saved.path,
      mime: saved.mime,
      size: saved.size,
    }
  }

  if (msgtype === "m.video") {
    return {
      body:
        `[video attached] file: ${filename}\n` +
        `local path: ${saved.path}\n` +
        `mime: ${saved.mime}  size: ${saved.size} bytes`,
      filePath: saved.path,
      mime: saved.mime,
      size: saved.size,
    }
  }

  if (msgtype === "m.file") {
    return {
      body:
        `[file attached] ${filename}\n` +
        `local path: ${saved.path}\n` +
        `mime: ${saved.mime}  size: ${saved.size} bytes\n` +
        `(use Read on the local path)`,
      filePath: saved.path,
      mime: saved.mime,
      size: saved.size,
    }
  }

  return {
    body: `[${msgtype}] file: ${filename} path: ${saved.path}`,
    filePath: saved.path,
    mime: saved.mime,
    size: saved.size,
  }
}
