# claude-code-matrix-channel

> A **Matrix [Channel](https://code.claude.com/docs/en/channels.md) MCP server** for Claude Code.
> Talk to Claude Code from any Matrix client (Element, Cinny, FluffyChat...) on any device, text, voice, images, files. Replies stream back into Matrix natively.

```
Element / FluffyChat / Cinny  ←──────  YOU
   ↓ message
Matrix homeserver  (yours, self-hosted)
   ↓ /sync
matrix-channel MCP server  (this project)
   ↓ notifications/claude/channel
Claude Code session  ← <channel source="matrix" sender="..." room_id="...">message</channel>
   ↓ reply tool
matrix-channel MCP server
   ↓ sendMessage
Matrix homeserver → Element  ──────→  YOU (sees Claude's reply)
```

The message arrives **as a native input** in your active Claude Code session, not via a separate bot process. Claude can reply, run tools, and ask for permission, all surfaced inside the Matrix room.

---

## Why use this

- **Talk to Claude Code from your phone.** Reply on the train, validate a tool call from the bathroom, see a `git push` confirm itself. Element supports notifications natively.
- **Pilot many machines from one place.** One sub-space per server, one room per chat, see your fleet as a list of channels.
- **Voice-first.** Audio messages get transcribed (Whisper) and arrive as text. You can dictate prompts to Claude.
- **Backup at home.** Every word of every conversation lives in your Matrix room history, on **your** server. Not Anthropic's, not anyone else's.
- **Approve risky tools from your phone.** Claude wants to `rm -rf` something? You see the request in Matrix, click ✅ or ❌, done.
- **Vendor-neutral by design.** This is just an MCP server, same architecture would work with any LLM that supports MCP channels.

---

## Requirements

- **Node.js 20+** (22 LTS recommended)
- **A Matrix homeserver** you can administer (Synapse, Conduit, Dendrite). Public homeservers like matrix.org will not let you create dedicated bot users, self-hosted is strongly recommended.
- **A Matrix client** (Element, Cinny, FluffyChat, anything that speaks Matrix client-server v1.x).
- **Claude Code** CLI v2.1.80+ (the `--dangerously-load-development-channels` flag is required because Channels are a research preview).
- *(Optional)* **Tailscale** if your Matrix homeserver lives on another machine and you want to run the MCP server remotely instead of locally.
- *(Optional)* **An audio-bridge** (any service exposing OpenAI-compatible `POST /v1/audio/transcriptions`) if you want voice messages transcribed. The default is `http://10.0.0.1:8889` which is the convention for Maxime's setup, override via `AUDIO_BRIDGE_URL`.

---

## Quick start (5 minutes)

### 1. Clone the repo on the machine that will run the MCP server

```bash
git clone https://github.com/maximeoliv/claude-code-matrix-channel.git ~/claude-code-matrix-channel
cd ~/claude-code-matrix-channel
bash install.sh
```

The installer checks Node, runs `npm install` and `npm run build`, then prints the JSON snippet to add to your `~/.claude.json` and the launch command.

### 2. Create a Matrix bot user on your homeserver

The bot is a Matrix user account that the MCP server will log in as. Create one however your homeserver lets you.

**Synapse (typical self-hosted setup) :**

```bash
docker exec <synapse-container> register_new_matrix_user \
  -u claudebot \
  --no-admin \
  -c /data/homeserver.yaml \
  http://localhost:8008
```

Then log in once via the HTTP client API to obtain a long-lived access token, and write the token to a file (so it never lands in shell history):

```bash
read -rs PASS              # password just typed, not echoed
curl -sS -X POST http://your-synapse:8008/_matrix/client/v3/login \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"claudebot\"},\"password\":\"$PASS\"}" \
  | jq -r '.access_token' > ~/claude-code-matrix-channel/.token
chmod 600 ~/claude-code-matrix-channel/.token
unset PASS
```

### 3. Configure `.env`

```bash
cd ~/claude-code-matrix-channel
cp .env.example .env
nano .env
```

Required:

```bash
MATRIX_HOMESERVER_URL=https://matrix.example.com   # or https://yourbox:8448 if you're tailneting
MATRIX_USER_ID=@claudebot:example.com
MATRIX_ACCESS_TOKEN_FILE=/absolute/path/to/.token
ALLOWED_SENDERS=@you:example.com                   # CRITICAL: gates against prompt injection
```

Optional:

```bash
ALLOWED_ROOMS=                                      # leave empty for all rooms; or comma-separated room IDs
ADMIN_ROOM_ID=                                      # if set, Claude's tool-permission requests are mirrored here
AUDIO_BRIDGE_URL=http://10.0.0.1:8889               # for voice transcription
LOG_LEVEL=info
```

### 4. Invite the bot in your Matrix client

In Element, create or open a room (or DM) and invite `@claudebot:your-homeserver`. The bot autojoins. Once it's in, **any message you send from `ALLOWED_SENDERS` will be forwarded to your active Claude Code session.**

### 5. Register the MCP and start Claude

Add to `~/.claude.json` on the machine that runs **Claude Code** (which may be the same as the MCP machine, or different, see below):

```json
{
  "mcpServers": {
    "claude-code-matrix-channel": {
      "command": "node",
      "args": ["/absolute/path/to/claude-code-matrix-channel/dist/index.js"]
    }
  }
}
```

Then launch:

```bash
claude --dangerously-load-development-channels server:claude-code-matrix-channel
```

You should see the MCP server logs appear in `~/claude-code-matrix-channel/matrix-channel.log` and "matrix sync running" within a couple seconds.

**To resume an existing session with channels enabled** (e.g. you were already chatting with Claude in the terminal and now want Matrix attached too):

```bash
claude -r --dangerously-load-development-channels server:claude-code-matrix-channel
```

Pick the session you want to continue.

---

## Where to run the MCP server (3 deployment patterns)

### Pattern A: Same machine as Claude Code (simplest)

You install Claude Code and the MCP server on the same machine. The MCP server runs as a sub-process spawned by Claude Code via stdio.

```json
{
  "mcpServers": {
    "claude-code-matrix-channel": {
      "command": "node",
      "args": ["/home/you/claude-code-matrix-channel/dist/index.js"]
    }
  }
}
```

This is the default install.sh behavior.

### Pattern B: Remote machine via Tailscale SSH

Useful when your Matrix homeserver lives on a server (e.g. `panels`) and you run Claude Code on a laptop. The MCP server lives on the server (close to Synapse, low latency), and your laptop launches it via SSH.

```json
{
  "mcpServers": {
    "claude-code-matrix-channel": {
      "command": "tailscale",
      "args": [
        "ssh",
        "root@your-server.tail-xxxx.ts.net",
        "node",
        "/root/claude-code-matrix-channel/dist/index.js"
      ]
    }
  }
}
```

stdin/stdout of the SSH session = stdio of the MCP server. Only `tailscale` CLI is required on the laptop, no Node, no project files.

### Pattern C: Standard SSH

Same idea but with OpenSSH instead of Tailscale:

```json
{
  "mcpServers": {
    "claude-code-matrix-channel": {
      "command": "ssh",
      "args": ["-i", "/home/you/.ssh/id_ed25519", "root@your.server", "node", "/root/claude-code-matrix-channel/dist/index.js"]
    }
  }
}
```

---

## Usage

### Sending a message

In Element, just type. Claude's session receives:

```
<channel source="matrix-channel"
         sender="@you:example.com"
         room_id="!abc:example.com"
         event_id="$ev..."
         thread_root=""
         timestamp="2026-05-10T19:25:32Z">
your message body here
</channel>
```

### Receiving a reply

Claude calls the `reply` tool internally with the `room_id` from the tag. The reply lands in the same room, markdown, code blocks, lists, and tables render correctly because the MCP server converts them to Matrix HTML before sending.

### Media

| Matrix message type | What Claude sees |
|---|---|
| `m.text` / `m.notice` | The text body directly |
| `m.image` | `[image attached] local path: /tmp/matrix-channel/...`, Claude `Read`s the file to view it |
| `m.audio` | `[voice transcribed] <text>` via Whisper through `AUDIO_BRIDGE_URL` |
| `m.video` | `[video attached] local path: ...` (no frame extraction yet) |
| `m.file` (PDF, doc, etc.) | `[file attached] local path: ...`, Claude can `Read` |

### Permission relay (optional but recommended)

Set `ADMIN_ROOM_ID` in `.env` to a room you're in. Now every time Claude wants to use a sensitive tool (Bash, Edit, Write, etc.), a message arrives in that room:

```
🔐 Claude wants to run Bash: list root directory

```
ls /root
```

**Click ✅ to allow / ❌ to deny** (or reply `yes abcde` / `no abcde`)
```

The MCP server auto-posts ✅ and ❌ as Matrix reactions on the message, you click one, the verdict goes back to Claude. Standby fallback: type `yes <id>` or `no <id>` (the 5-letter ID from the message).

---

## Security model

- **Sender allowlist is critical.** Without it, any room member could inject prompts into your Claude session. Always set `ALLOWED_SENDERS` to a tight list (just yourself, ideally).
- **Gate on sender, not on room.** A malicious user invited to a shared room would bypass room-only gating. Always gate on `sender` first, optionally narrow further with `ALLOWED_ROOMS`.
- **Bot token in a file with `chmod 600`.** Never put it in the shell environment of a multi-user box, never commit it to git, never paste it in a chat.
- **Permission relay** is the second line of defense. With `ADMIN_ROOM_ID` set, every destructive tool call requires explicit approval, you can stop Claude from doing something dumb even when you're away from the keyboard.
- **The 5-letter request ID** in permission prompts expires after ~30 seconds (limit replay) and uses an unambiguous alphabet (no `l`, no `I`).

---

## Troubleshooting

```bash
# MCP server logs
tail -F ~/claude-code-matrix-channel/matrix-channel.log
```

**"matrix-channel: server not found" in Claude Code**
- Wrong path in `~/.claude.json`. Use the absolute path printed by `install.sh`.
- Forgot `npm run build` after a `git pull`.

**No messages reaching Claude**
- Sender not in `ALLOWED_SENDERS` (most common). Check the spelling, including the homeserver suffix `:example.com`.
- Bot not in the room. Re-invite from Element, it should auto-join.
- Bot received the message but Claude didn't see the `<channel>` tag: confirm Claude was launched with `--dangerously-load-development-channels server:claude-code-matrix-channel`.

**Permission relay silent**
- `ADMIN_ROOM_ID` not set, or set to a room the bot isn't in. Invite the bot first.
- The bot is the *sender* of the permission_request message, it can't react to its own messages, so the auto-posted ✅ ❌ are seeded but only count when you (in `ALLOWED_SENDERS`) click them.

**Voice messages not transcribed**
- `AUDIO_BRIDGE_URL` unreachable or not OpenAI-compatible. Test with `curl <url>/v1/models`.
- File downloaded but Whisper returned empty transcript: check `matrix-channel.log` for the "transcribeAudio HTTP" line.

**Sync timeouts (`ESOCKETTIMEDOUT`)**
- Common when going through Tailscale Serve (the proxy timeout can be tighter than Matrix's `/sync?timeout=30000`). The MCP server retries automatically; it's just noisy. Acceptable in practice. If you want to silence: lower `syncingTimeout` to 20000ms via a code patch.

---

## FAQ

**Q: Does this require Anthropic to support anything special?**
A: Yes, the `--dangerously-load-development-channels` flag is a research preview as of Claude Code v2.1.80. Custom channels (like this one) need that flag. When/if Channels stabilizes, the flag may go away.

**Q: Can I use this with a public Matrix homeserver like matrix.org?**
A: Theoretically yes if you can create a dedicated bot user there. In practice, public homeservers throttle bot accounts, self-hosted is strongly recommended.

**Q: Does the bot ever post the conversation outside of the Matrix room?**
A: No. The MCP server only talks to your Matrix homeserver and your Claude Code session. No external API calls except the Whisper audio-bridge (if you opt into voice).

**Q: Can multiple users share one Claude Code session through Matrix?**
A: Yes, add multiple Matrix IDs to `ALLOWED_SENDERS`. They'll all be able to send prompts to the same session. The session itself is single-threaded though, concurrent prompts will queue up.

**Q: E2E encryption?**
A: Not yet. The bot uses unencrypted rooms. If you need E2EE, use a tailnet for transport security and a dedicated unencrypted room for the bot. PR welcome to add `matrix-rust-sdk-crypto` integration.

**Q: Why MCP and not a custom bot?**
A: Because MCP channels are **native**, your message arrives as a `<channel>` input in the running Claude Code session, not in a separate forked process. The conversation context is preserved, the same Claude that you've been chatting with answers, not a fresh one.

---

## Roadmap

- [ ] Sub-agent threading (use Matrix threads when Claude spawns a Task tool)
- [ ] E2EE rooms via `@turt2live/matrix-sdk-crypto-nodejs`
- [ ] TTS replies (Claude speaks back through `AUDIO_BRIDGE_URL`)
- [ ] Image generation routed back as `m.image` (when Claude generates one via a tool)
- [ ] Video frame extraction for `m.video` (currently just stores the file)

---

## Contributing

PRs welcome. The code is intentionally small (~600 LOC TypeScript, single repo, no monorepo gymnastics) so it's easy to read and modify. The interesting files:

- `src/mcp.ts`, MCP server, channel notifications, permission relay
- `src/matrix.ts`, Matrix client wrapper, message + reaction listeners
- `src/media.ts`, image/audio/video/file download + Whisper integration

If you ship a feature that requires new env vars, add them to `.env.example` with a short comment.

---

## License

MIT. See [LICENSE](./LICENSE).

---

## Credits

Built by [Maxime Olivier](https://github.com/maximeoliv) on top of:

- [Anthropic Claude Code](https://code.claude.com) and the [Channels research preview](https://code.claude.com/docs/en/channels.md)
- [matrix-bot-sdk](https://github.com/turt2live/matrix-bot-sdk) by Travis Ralston
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) by Anthropic
- [markdown-it](https://github.com/markdown-it/markdown-it) for the Matrix HTML rendering

---

> *"The right interface for an AI agent is not a chat window in a tab. It's wherever you already are. For me, that's Matrix."*
