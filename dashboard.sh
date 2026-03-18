#!/usr/bin/env bash
# ブラウザ起動。tmux モードのときだけ tmux を自動起動する（API モードでは不要）。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
SETTINGS="$DIR/app-settings.json"

if [[ -f "$SETTINGS" ]] && grep -qE '"providerMode"[[:space:]]*:[[:space:]]*"tmux"' "$SETTINGS" 2>/dev/null; then
  if ! tmux has-session -t one-person-company-ops 2>/dev/null; then
    echo ""
    echo ">>> tmux モード: セッション「one-person-company-ops」を起動します…"
    echo ""
    bash "$DIR/start-agents.sh" --background "$DIR"
  fi
fi

export OPEN_CHROME=1
exec node "$DIR/server.js"
