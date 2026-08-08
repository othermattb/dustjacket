#!/bin/zsh
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if curl -sS -o /dev/null http://localhost:3000/ 2>/dev/null; then
  echo "Server already running at http://localhost:3000 — opening browser."
  open http://localhost:3000/
  exit 0
fi

echo "Starting Book Recommendations server..."
( sleep 1; open http://localhost:3000/ ) &

node server.js
