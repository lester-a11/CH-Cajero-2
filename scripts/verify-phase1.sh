#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo '== Pruebas de Fase 1 =='
npm run test:phase1

echo
echo '== Pruebas de Fase 2 =='
npm run test:phase2

echo
echo '== Pruebas Python del proyecto =='
python3 -m unittest discover -s tests -p 'test_*.py' -v

echo
echo '== Sintaxis JavaScript =='
while IFS= read -r file; do
  node --check "$file"
done < <(find src scripts -type f \( -name '*.js' -o -name '*.mjs' \) -print | sort)
node --check vite.config.js

echo
echo '== Catálogo demo y SHA-256 =='
python3 - <<'PY'
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('pc_tool', 'pc/pc_tool.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
payload, _ = module.load_archive(Path('examples/catalogo_prueba_fase1.zip'))
if payload.get('tipo') != 'catalogo' or not module.verify_hash(payload):
    raise SystemExit('ERROR: catálogo inválido o hash incorrecto')
products = payload.get('productos') or []
if len(products) != 3:
    raise SystemExit(f'ERROR: se esperaban 3 productos y hay {len(products)}')
expected = ['6971449709288', '2000000000015', '2000000000022']
if [str(p.get('codigo')) for p in products] != expected:
    raise SystemExit('ERROR: los códigos del catálogo no coinciden con las etiquetas EAN-13')
total = sum(float(p['precio_usd']) for p in products)
if round(total, 2) != 6.00:
    raise SystemExit(f'ERROR: total de demostración inesperado: {total}')
print(f"OK: {len(products)} productos, total ${total:.2f} USD, hash correcto")
PY

echo
echo 'OK: verificaciones locales de Fases 1 y 2 terminadas.'
