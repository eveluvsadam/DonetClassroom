#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# DonetClassroom launcher (macOS / Linux)
#   ./start.sh          -> install deps if needed, start the server, open browser
#   ./start.sh --no-open-> start without opening a browser
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

BLACK_BOLD="\033[1m"; DIM="\033[2m"; RESET="\033[0m"; GREEN="\033[32m"; YELLOW="\033[33m"

printf "${BLACK_BOLD}DonetClassroom${RESET} ${DIM}— starting up${RESET}\n"

# --- Node check ------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  printf "${YELLOW}Node.js is not installed.${RESET}\n"
  printf "Install it from https://nodejs.org (LTS) or with: brew install node\n"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  printf "${YELLOW}Node 18 or newer is required (found $(node -v)).${RESET}\n"
  exit 1
fi

# --- Dependencies ----------------------------------------------------------
if [ ! -d node_modules ]; then
  printf "${DIM}Installing dependencies (one time)...${RESET}\n"
  npm install --no-audit --no-fund
fi

# --- .env ------------------------------------------------------------------
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  printf "${DIM}Created .env from .env.example${RESET}\n"
fi

PORT="$(node -e 'try{const t=require("fs").readFileSync(".env","utf8").match(/^PORT=(\d+)/m);process.stdout.write(t?t[1]:"5173")}catch(e){process.stdout.write("5173")}')"

# --- Ollama hint -----------------------------------------------------------
if curl -s --max-time 1 "http://localhost:11434/api/tags" >/dev/null 2>&1; then
  printf "${GREEN}●${RESET} Ollama is running (local AI available)\n"
else
  printf "${YELLOW}●${RESET} Ollama not detected — local AI will show as offline.\n"
  printf "${DIM}   Install: brew install ollama   Start: ollama serve${RESET}\n"
fi

# --- Launch ----------------------------------------------------------------
if [ "${1:-}" != "--no-open" ]; then
  ( sleep 1.2; command -v open >/dev/null 2>&1 && open "http://localhost:${PORT}" || true ) &
fi

exec node backend/server.js
