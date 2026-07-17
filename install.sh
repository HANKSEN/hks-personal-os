#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "Personal OS requires Node.js 20 or later. Install Node.js LTS, then retry." >&2
  exit 2
fi

MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$MAJOR" -lt 20 ]; then
  echo "Personal OS requires Node.js 20 or later. Current: $(node -v)" >&2
  exit 2
fi

exec node "$SCRIPT_DIR/scripts/install.mjs" "$@"

