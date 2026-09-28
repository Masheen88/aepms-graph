#!/usr/bin/env bash
set -euo pipefail

# Native iOS is optional. For team installs without Apple Developer Program
# membership or Developer Mode, use the HTTPS web/PWA build instead.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo
echo "==> Building Termite Fieldbook for iOS"
echo
pnpm exec vite build

if [[ ! -d ios ]]; then
  echo
  echo "==> Adding Capacitor iOS platform"
  pnpm exec cap add ios
fi

echo
echo "==> Syncing iOS"
pnpm exec cap sync ios

echo
echo "==> Opening Xcode"
pnpm exec cap open ios
