import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { ALLOWED_SENDERS, ALLOWED_ROOMS } from "./config.js"
import { logger } from "./logger.js"
import {
  sendReply,
  sendReaction,
  onMessage,
  onReaction,
  startMatrix,
  type IncomingMessage,
} from "./matrix.js"

const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

const server = new Server(
  { name: "matrix-channel", version: "0.1.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
      tools: {},
    },
    instructions: [
      "Messages from Matrix arrive as <channel source=\"matrix\" sender=\"...\" room_id=\"...\"> tags.",
      "To reply, use the `reply` tool and pass the room_id from the tag (and thread_root if present).",
      "Senders are gated by an allowlist; only authorised users can push messages here.",
    ].join(" "),
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a message back to a Matrix room. Use the room_id from the latest <channel> tag (and the thread_root if the original message was inside a thread).",
      inputSchema: {
        type: "object",
        properties: {
          room_id: {
            type: "string",
            description: "Matrix room ID, e.g. !abc123:example.com",
          },
          text: { type: "string", description: "Message body (markdown allowed)" },
          thread_root: {
            type: "string",
            description: "Event ID to thread under (optional)",
          },
        },
        required: ["room_id", "text"],
        additionalProperties: false,
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "reply") {
    throw new Error(`unknown tool: ${req.params.name}`)
  }
  const args = req.params.arguments as {
    room_id: string
    text: string
    thread_root?: string
  }
  if (!args?.room_id || !args?.text) {
    return {
      isError: true,
      content: [{ type: "text", text: "room_id and text are required" }],
    }
  }
  try {
    const eventId = await sendReply(args.room_id, args.text, args.thread_root)
    logger.info("reply sent", { roomId: args.room_id, eventId })
    return { content: [{ type: "text", text: `sent: ${eventId}` }] }
  } catch (err: any) {
    logger.error("reply failed", { err: String(err?.message ?? err) })
    return {
      isError: true,
      content: [{ type: "text", text: `failed: ${err?.message ?? err}` }],
    }
  }
})

const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

type PendingApproval = { request_id: string; expires: number }
const pendingApprovals = new Map<string, PendingApproval>()

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of pendingApprovals) {
    if (v.expires < now) pendingApprovals.delete(k)
  }
}, 30_000).unref?.()

server.setNotificationHandler(PermissionRequestSchema as any, async (raw: any) => {
  const params = raw.params
  const adminRoom = process.env.ADMIN_ROOM_ID
  if (!adminRoom) return
  const text =
    `🔐 Claude wants to run ${params.tool_name}: ${params.description}\n\n` +
    "```\n" +
    params.input_preview +
    "\n```\n\n" +
    `**Click ✅ to allow / ❌ to deny** (or reply \`yes ${params.request_id}\` / \`no ${params.request_id}\`)`
  try {
    const eventId = await sendReply(adminRoom, text)
    pendingApprovals.set(eventId, {
      request_id: params.request_id,
      expires: Date.now() + 5 * 60 * 1000,
    })
    for (const emoji of ["✅", "❌"]) {
      await sendReaction(adminRoom, eventId, emoji).catch((err) =>
        logger.warn("seed reaction failed", { emoji, err: String(err) }),
      )
    }
    logger.info("permission relay sent", { request_id: params.request_id, eventId })
  } catch (err) {
    logger.warn("permission relay send failed", { err: String(err) })
  }
})

function isAuthorised(msg: IncomingMessage): boolean {
  if (ALLOWED_SENDERS.size > 0 && !ALLOWED_SENDERS.has(msg.sender)) return false
  if (ALLOWED_ROOMS.size > 0 && !ALLOWED_ROOMS.has(msg.roomId)) return false
  return true
}

async function relayPermissionVerdict(msg: IncomingMessage): Promise<boolean> {
  const m = PERMISSION_REPLY_RE.exec(msg.body)
  if (!m) return false
  await server.notification({
    method: "notifications/claude/channel/permission",
    params: {
      request_id: m[2]!.toLowerCase(),
      behavior: m[1]!.toLowerCase().startsWith("y") ? "allow" : "deny",
    },
  } as any)
  logger.info("permission verdict relayed", { request_id: m[2], verdict: m[1] })
  return true
}

async function forwardToChannel(msg: IncomingMessage) {
  await server.notification({
    method: "notifications/claude/channel",
    params: {
      content: msg.body,
      meta: {
        sender: msg.sender,
        room_id: msg.roomId,
        event_id: msg.eventId,
        thread_root: msg.threadRoot ?? "",
        timestamp: new Date(msg.ts).toISOString(),
      },
    },
  } as any)
}

export async function start() {
  await startMatrix()

  onMessage(async (msg) => {
    if (!isAuthorised(msg)) {
      logger.warn("dropped (not authorised)", { sender: msg.sender, room: msg.roomId })
      return
    }
    if (await relayPermissionVerdict(msg)) return
    await forwardToChannel(msg)
    logger.info("forwarded to channel", { sender: msg.sender, room: msg.roomId })
  })

  onReaction(async ({ roomId, sender, targetEventId, key }) => {
    if (ALLOWED_SENDERS.size > 0 && !ALLOWED_SENDERS.has(sender)) return
    if (ALLOWED_ROOMS.size > 0 && !ALLOWED_ROOMS.has(roomId)) return
    const pending = pendingApprovals.get(targetEventId)
    if (!pending) return
    let behavior: "allow" | "deny" | null = null
    if (key === "✅" || key === "👍" || key === "👍🏻") behavior = "allow"
    else if (key === "❌" || key === "👎" || key === "👎🏻") behavior = "deny"
    if (!behavior) return
    pendingApprovals.delete(targetEventId)
    try {
      await server.notification({
        method: "notifications/claude/channel/permission",
        params: { request_id: pending.request_id, behavior },
      } as any)
      logger.info("permission verdict via reaction", {
        request_id: pending.request_id,
        key,
        behavior,
        sender,
      })
      await sendReply(
        roomId,
        behavior === "allow" ? `✅ approved` : `❌ denied`,
      ).catch(() => {})
    } catch (err) {
      logger.warn("verdict notification failed", { err: String(err) })
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info("MCP server connected (stdio)")
}
