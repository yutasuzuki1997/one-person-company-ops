#!/bin/bash
SESSION="one-person-company-ops"
GRID_WINDOW="0"
TOTAL_PANES=6

broadcast() {
  local message="$1"
  if [ -z "$message" ]; then
    echo "使い方: broadcast \"メッセージ\""
    return 1
  fi
  echo "📡 全エージェントに送信中: $message"
  for i in $(seq 0 $((TOTAL_PANES - 1))); do
    tmux send-keys -t "$SESSION:$GRID_WINDOW.$i" "$message" Enter 2>/dev/null && echo "  ✓ ペイン $i"
  done
  echo "✅ 送信完了"
}

if [ -n "$1" ]; then broadcast "$@"; fi
