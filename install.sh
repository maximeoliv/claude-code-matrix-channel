#!/usr/bin/env bash
# Interactive installer for matrix-channel.
# Run from the project root after `git clone`.
#
#   bash install.sh
#
# Installs deps, builds, helps create the .env, optionally creates the bot
# user on a local Synapse, prints the snippet to paste in ~/.claude.json.

set -euo pipefail

cd "$(dirname "$0")"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
blue()   { printf "\033[34m%s\033[0m\n" "$*"; }

green "==> matrix-channel installer"
echo

# --- Node.js check ---
if ! command -v node >/dev/null 2>&1; then
  red "node not found. Install Node.js 20+ first (https://nodejs.org/)."
  exit 2
fi
NODE_MAJ=$(node -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJ" -lt 20 ]]; then
  red "node $NODE_MAJ found; matrix-channel needs Node 20+."
  exit 2
fi
green "  node $(node -v) OK"

# --- npm install ---
yellow "==> installing dependencies"
npm install --no-fund --no-audit >/dev/null
green "  done"

# --- build ---
yellow "==> building"
npm run build >/dev/null
green "  done"

# --- .env ---
if [[ ! -f .env ]]; then
  cp .env.example .env
  yellow "==> created .env from .env.example"
  echo
  echo "Edit it now:"
  echo "  nano $PWD/.env"
  echo
  echo "Required vars:"
  echo "  MATRIX_HOMESERVER_URL   (e.g. https://matrix.example.com)"
  echo "  MATRIX_USER_ID          (e.g. @claudebot:example.com)"
  echo "  MATRIX_ACCESS_TOKEN_FILE or MATRIX_ACCESS_TOKEN"
  echo "  ALLOWED_SENDERS         (comma-separated Matrix IDs)"
  echo
  read -rp "press enter once .env is filled..."
fi
chmod 600 .env

# --- summary + ~/.claude.json snippet ---
ABS_DIST="$(cd "$(dirname "$PWD")" && pwd)/$(basename "$PWD")/dist/index.js"
ABS_DIST="$PWD/dist/index.js"

green "==> install complete"
echo
echo "Add this to ~/.claude.json (merge with any existing mcpServers):"
echo
cat <<JSON
{
  "mcpServers": {
    "matrix-channel": {
      "command": "node",
      "args": ["$ABS_DIST"]
    }
  }
}
JSON
echo
echo "Then launch Claude Code with channels enabled:"
echo
blue "  claude --dangerously-load-development-channels server:matrix-channel"
echo
echo "(or with --resume <sessionId> to attach to an existing session)"
echo
echo "Logs: tail -F $PWD/matrix-channel.log"
