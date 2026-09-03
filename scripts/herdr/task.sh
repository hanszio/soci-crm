#!/usr/bin/env bash
# Lanza una tarea del PLAN.md en un worktree propio con herdr.
# Uso: scripts/herdr/task.sh <ID> <kind: claude|codex> <modelo> <fase>
# Ej.:  scripts/herdr/task.sh T1.1 claude claude-opus-5 1
set -euo pipefail
ID="$1"; KIND="$2"; MODEL="$3"; PHASE="$4"
BRIEF="docs/tasks/$ID.md"
[ -f "$BRIEF" ] || { echo "falta $BRIEF"; exit 1; }
SLUG=$(grep -m1 '^slug:' "$BRIEF" | awk '{print $2}')
BRANCH="phase/$PHASE/$ID-$SLUG"
WT="../soci-$ID"
NAME=$(echo "$ID" | tr '.' '-' | tr 'A-Z' 'a-z')

git fetch -q origin
git worktree add -B "$BRANCH" "$WT" "origin/phase/$PHASE"
[ -f .env ] && cp .env "$WT/.env"
(cd "$WT" && pnpm install --frozen-lockfile >/dev/null)

created=$(herdr workspace create --cwd "$WT" --label "$ID" --no-focus)
pane=$(printf '%s\n' "$created" | jq -r '.result.root_pane.pane_id')
ws=$(printf '%s\n' "$created" | jq -r '.result.workspace_id')

if [ "$KIND" = "claude" ]; then
  herdr agent start "$NAME" --kind claude --pane "$pane" -- --model "$MODEL" --permission-mode acceptEdits
else
  herdr agent start "$NAME" --kind codex --pane "$pane" -- -m "$MODEL" --full-auto
fi

herdr agent prompt "$NAME" "Lee $BRIEF y ejecútalo completo. Rama actual: $BRANCH (worktree $WT). Al terminar escribe DONE y el número de PR; si te bloqueas escribe BLOCKED y el motivo." --wait --timeout 300000 || true

until herdr agent wait "$NAME" --until done --until idle --until blocked --timeout 300000 >/dev/null 2>&1; do :; done
herdr agent read "$NAME" --source recent-unwrapped --lines 60
echo "$ws" > ".herdr-$ID.ws"
echo "Cerrar tras aprobar: herdr workspace close $ws && git worktree remove $WT && rm .herdr-$ID.ws"
