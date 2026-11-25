#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
npm run test:phase1
npm run test:phase2
npm run test:phase3
python3 -m unittest discover -s tests -p 'test_*.py' -v
while IFS= read -r file; do node --check "$file"; done < <(find src scripts -type f \( -name '*.js' -o -name '*.mjs' \) -print | sort)
node --check vite.config.js
python3 -m py_compile pc/pc_tool.py
printf '\nOK: Fases 1, 2 y 3 verificadas localmente.\n'
