#!/usr/bin/env python3
"""Regenera el catálogo de demostración usado en la aceptación de Fase 1."""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "catalogo_prueba_fase1.zip"


def normalize(value):
    if isinstance(value, dict):
        return {key: normalize(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def canonical_json(value):
    return json.dumps(normalize(value), ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False)


def ean13(base12: str) -> str:
    if len(base12) != 12 or not base12.isdigit():
        raise ValueError("Se requieren 12 dígitos base")
    weighted = sum(int(digit) * (1 if index % 2 == 0 else 3) for index, digit in enumerate(base12))
    check = (10 - weighted % 10) % 10
    return base12 + str(check)


products = [
    {"codigo": "6971449709288", "nombre": "Producto DEMO 01", "precio_usd": 1.0, "stock": 30, "foto": None},
    {"codigo": ean13("200000000001"), "nombre": "Producto DEMO 02", "precio_usd": 2.0, "stock": 30, "foto": None},
    {"codigo": ean13("200000000002"), "nombre": "Producto DEMO 03", "precio_usd": 3.0, "stock": 30, "foto": None},
]

payload = {
    "tipo": "catalogo",
    "version": 1,
    "generado_en": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    "modo": "reemplazar",
    "inventario_corregido": False,
    "tasa_cup_sugerida": None,
    "productos": products,
}
payload["hash"] = "sha256-" + hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    archive.writestr("catalogo.json", canonical_json(payload).encode("utf-8"))
print(f"Catálogo creado: {OUTPUT}")
print(f"SHA-256: {payload['hash']}")
for product in products:
    print(f"{product['codigo']} | {product['nombre']} | ${product['precio_usd']:.2f} | stock {product['stock']}")
