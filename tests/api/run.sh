#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV="$ROOT/tests/api/.venv"

if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi

if [ "$#" -eq 0 ]; then
  set -- tests/api
fi

"$VENV/bin/python" -m pip install -q -r "$ROOT/tests/api/requirements.txt"
cd "$ROOT"
"$VENV/bin/python" -m pytest "$@"
