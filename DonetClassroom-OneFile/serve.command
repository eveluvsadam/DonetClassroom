#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Tiny local server for the one-file build of DonetClassroom.
#
# Some browser features are restricted on file:// pages (screen capture, and
# talking to Ollama, which refuses requests from a "null" origin). Serving the
# file over http://localhost fixes both.
#
# Double-click this file in Finder, or run:  ./serve.command
# Stop it with Ctrl+C.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8777}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 was not found. On macOS, install the Xcode command line tools:"
  echo "  xcode-select --install"
  echo
  echo "Alternatively, with Node.js installed, run:  npx serve ."
  exit 1
fi

echo ""
echo "  DonetClassroom (one-file build)"
echo "  http://localhost:${PORT}/DonetClassroom.html"
echo ""
echo "  Local AI note: if Ollama refuses the connection, restart it with"
echo "    OLLAMA_ORIGINS=\"http://localhost:${PORT}\" ollama serve"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

( sleep 1; command -v open >/dev/null 2>&1 && open "http://localhost:${PORT}/DonetClassroom.html" || true ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
