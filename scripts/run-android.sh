#!/usr/bin/env bash
set -euo pipefail

# Apple's Termite Fieldbook - macOS/Linux Android launcher.
# This wrapper keeps first-run setup simple when the project is copied to a new
# Mac. It prefers an installed pnpm, then Corepack, then an npx pnpm fallback.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"
cd "${PROJECT_DIR}"

if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v npx >/dev/null 2>&1; then
  PNPM=(npx --yes pnpm@12.4.1)
else
  echo "Node.js/npm is required. Install Node.js 22+ and rerun this script." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo
  echo "==> Installing project dependencies"
  "${PNPM[@]}" install
fi

echo
echo "==> Building, syncing, and launching Android"
"${PNPM[@]}" android
