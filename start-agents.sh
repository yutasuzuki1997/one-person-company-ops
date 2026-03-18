#!/bin/bash
SESSION="one-person-company-ops"
BACKGROUND=0
if [[ "$1" == "--background" ]]; then
  BACKGROUND=1
  shift
fi
PROJECT_ROOT="${1:-$(cd "$(dirname "$0")" && pwd)}"

tmux kill-session -t "$SESSION" 2>/dev/null
tmux new-session -d -s "$SESSION" -x 220 -y 60

# 3x2グリッド作成
tmux split-window -h -t "$SESSION:0"
tmux split-window -h -t "$SESSION:0"
tmux select-layout -t "$SESSION:0" even-horizontal
tmux split-window -v -t "$SESSION:0.0"
tmux split-window -v -t "$SESSION:0.2"
tmux split-window -v -t "$SESSION:0.4"
tmux select-layout -t "$SESSION:0" tiled

declare -a AGENTS=(
  "dev:蒼井涼:エンジニア"
  "pm:春香:PM"
  "legal:廉:法務"
  "data:美亜:データ"
  "hr:雪:人事"
  "strategy:健司:戦略"
)

PANE=0
for agent in "${AGENTS[@]}"; do
  IFS=':' read -r id name role <<< "$agent"
  tmux send-keys -t "$SESSION:0.$PANE" "unset CLAUDECODE && cd '$PROJECT_ROOT' && clear && echo '=== $name / $role ===' && claude --dangerously-skip-permissions" Enter
  PANE=$((PANE + 1))
done

# 一斉送信ウィンドウ
tmux new-window -t "$SESSION" -n "broadcast"
tmux send-keys -t "$SESSION:1" "source '$PROJECT_ROOT/broadcast.sh' && echo '✅ broadcast関数ready。使い方: broadcast \"指示\"'" Enter

tmux select-window -t "$SESSION:0"
echo "✅ 起動完了。接続: tmux attach -t $SESSION"
if [[ "$BACKGROUND" == "1" ]]; then
  echo ""
  echo "tmux は裏で動いています。ブラウザで開く:"
  echo "  cd '$PROJECT_ROOT' && npm start"
  exit 0
fi
tmux attach -t "$SESSION"
