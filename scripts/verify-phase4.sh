#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
printf '\n== Pruebas JavaScript (Fases 1–4) ==\n'
if node -e "import('fflate')" >/dev/null 2>&1; then
  npm test
else
  echo "AVISO: fflate no está instalado; se ejecutan las pruebas JS independientes de esa dependencia."
  echo "Para completar la suite integral: npm install && npm test"
  node --test \
    tests/backup-validation.test.js \
    tests/barcode-buffer.test.js \
    tests/cart.test.js \
    tests/catalog-import.test.js \
    tests/closure.test.js \
    tests/money.test.js \
    tests/sale-rules.test.js \
    tests/security.test.js
fi
printf '\n== Pruebas Python del importador PC ==\n'
python3 -m unittest discover -s tests -p 'test_*.py' -v
printf '\n== Sintaxis JavaScript ==\n'
while IFS= read -r file; do node --check "$file"; done < <(find src scripts -type f \( -name '*.js' -o -name '*.mjs' \) -print | sort)
node --check vite.config.js
printf '\n== Sintaxis Python ==\n'
python3 -m py_compile pc/pc_tool.py
printf '\nOK: pruebas disponibles y comprobaciones sintácticas completadas.\n'
