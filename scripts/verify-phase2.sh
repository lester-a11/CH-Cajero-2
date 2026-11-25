#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run test:phase1
npm run test:phase2
python3 -m unittest discover -s tests -p 'test_*.py' -v
while IFS= read -r file; do node --check "$file"; done < <(find src scripts -type f \( -name '*.js' -o -name '*.mjs' \) -print | sort)
node --check vite.config.js
echo 'OK: Fases 1 y 2 verificadas localmente.'
