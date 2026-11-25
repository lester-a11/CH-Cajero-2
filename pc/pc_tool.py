#!/usr/bin/env python3
"""Inventario maestro CH Cajero para Ubuntu. Offline y con SQLite local."""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import math
import re
import shutil
import sqlite3
import sys
import uuid
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
PHOTO_DIR = ROOT / "fotos"
DEFAULT_DB = DATA_DIR / "inventario_ch.db"
MAX_IMPORT_BYTES = 50 * 1024 * 1024
VALID_SALE_STATES = {"cerrada", "anulada", "cancelada"}
VALID_PAYMENT_METHODS = {"USD", "CUP", "TRANSFER"}


def now_iso() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def photo_dir_for_db(db_path: Path) -> Path:
    """Fotos junto a la base por defecto; en bases personalizadas, junto al archivo DB."""
    resolved = db_path.expanduser().resolve()
    if resolved == DEFAULT_DB.resolve():
        return PHOTO_DIR
    return resolved.parent / "fotos"


def normalise_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: normalise_json(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [normalise_json(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("JSON contiene un número no finito")
        if value == 0 or value.is_integer():
            return int(value)
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(normalise_json(value), ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False)


def add_hash(payload: dict[str, Any]) -> dict[str, Any]:
    unsigned = dict(payload)
    unsigned.pop("hash", None)
    digest = hashlib.sha256(canonical_json(unsigned).encode("utf-8")).hexdigest()
    return {**unsigned, "hash": f"sha256-{digest}"}


def verify_hash(payload: dict[str, Any]) -> bool:
    claimed = str(payload.get("hash", ""))
    if not claimed.startswith("sha256-"):
        return False
    return claimed == add_hash(payload)["hash"]


def connect(db_path: Path = DEFAULT_DB) -> sqlite3.Connection:
    db_path = db_path.expanduser().resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    photo_dir_for_db(db_path).mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS productos (
            codigo TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            precio_usd REAL NOT NULL DEFAULT 0 CHECK(precio_usd >= 0),
            stock INTEGER NOT NULL DEFAULT 0,
            foto TEXT,
            actualizado_en TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cierres (
            id TEXT PRIMARY KEY,
            fecha TEXT NOT NULL,
            archivo TEXT NOT NULL,
            hash TEXT NOT NULL,
            importado_en TEXT NOT NULL,
            secuencia INTEGER,
            hash_anterior TEXT,
            tienda TEXT,
            dispositivo TEXT,
            version INTEGER
        );
        CREATE TABLE IF NOT EXISTS ventas (
            id TEXT PRIMARY KEY,
            cierre_id TEXT NOT NULL,
            fecha_hora TEXT NOT NULL,
            dependiente TEXT NOT NULL,
            estado TEXT NOT NULL,
            total_usd REAL NOT NULL,
            tasa_cup REAL NOT NULL,
            recargo_transf REAL NOT NULL,
            motivo_anulacion TEXT,
            vuelto_moneda TEXT,
            vuelto_monto REAL NOT NULL DEFAULT 0,
            dependiente_id TEXT,
            turno_id TEXT,
            FOREIGN KEY(cierre_id) REFERENCES cierres(id)
        );
        CREATE TABLE IF NOT EXISTS lineas_venta (
            id TEXT PRIMARY KEY,
            venta_id TEXT NOT NULL,
            codigo TEXT NOT NULL,
            nombre TEXT NOT NULL,
            precio_usd REAL NOT NULL,
            cantidad INTEGER NOT NULL,
            anulada INTEGER NOT NULL DEFAULT 0,
            motivo_anulacion TEXT,
            FOREIGN KEY(venta_id) REFERENCES ventas(id)
        );
        CREATE TABLE IF NOT EXISTS pagos (
            id TEXT PRIMARY KEY,
            venta_id TEXT NOT NULL,
            metodo TEXT NOT NULL,
            monto REAL NOT NULL,
            moneda TEXT NOT NULL,
            tasa_aplicada REAL NOT NULL,
            equivalente_usd REAL NOT NULL,
            estado TEXT NOT NULL DEFAULT 'activo',
            anulado_por TEXT,
            anulado_en TEXT,
            FOREIGN KEY(venta_id) REFERENCES ventas(id)
        );
        CREATE TABLE IF NOT EXISTS movimientos_inventario (
            id TEXT PRIMARY KEY,
            fecha_hora TEXT NOT NULL,
            codigo TEXT NOT NULL,
            tipo TEXT NOT NULL,
            cantidad INTEGER NOT NULL,
            referencia_tipo TEXT,
            referencia_id TEXT,
            detalle TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS auditoria_pc (
            id TEXT PRIMARY KEY,
            fecha_hora TEXT NOT NULL,
            actor TEXT NOT NULL,
            accion TEXT NOT NULL,
            detalle TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS auditoria_dispositivo (
            id TEXT PRIMARY KEY, cierre_id TEXT NOT NULL, fecha_hora TEXT NOT NULL,
            usuario_id TEXT, usuario TEXT NOT NULL, accion TEXT NOT NULL, detalle TEXT NOT NULL,
            turno_id TEXT, hash_anterior TEXT, hash_evento TEXT NOT NULL,
            FOREIGN KEY(cierre_id) REFERENCES cierres(id)
        );
        CREATE TABLE IF NOT EXISTS turnos_pc (
            id TEXT PRIMARY KEY, cierre_id TEXT NOT NULL, usuario_id TEXT,
            usuario TEXT NOT NULL, inicio TEXT NOT NULL, fin TEXT,
            FOREIGN KEY(cierre_id) REFERENCES cierres(id)
        );
        CREATE TABLE IF NOT EXISTS conteos_pc (
            id TEXT PRIMARY KEY, cierre_id TEXT NOT NULL, inicio TEXT NOT NULL,
            fin TEXT, usuario TEXT NOT NULL, estado TEXT NOT NULL,
            FOREIGN KEY(cierre_id) REFERENCES cierres(id)
        );
        CREATE TABLE IF NOT EXISTS conteo_detalle_pc (
            id INTEGER PRIMARY KEY AUTOINCREMENT, conteo_id TEXT NOT NULL, codigo TEXT NOT NULL,
            esperado INTEGER NOT NULL, conteo_1 INTEGER, hora_1 TEXT,
            conteo_2 INTEGER, hora_2 TEXT, resultado TEXT NOT NULL,
            decision_admin TEXT, motivo TEXT, visible_para TEXT
        );
        CREATE TABLE IF NOT EXISTS arqueos_pc (
            id TEXT PRIMARY KEY, cierre_id TEXT NOT NULL,
            esperado_usd REAL NOT NULL, contado_usd REAL NOT NULL, diferencia_usd REAL NOT NULL,
            esperado_cup REAL NOT NULL, contado_cup REAL NOT NULL, diferencia_cup REAL NOT NULL,
            FOREIGN KEY(cierre_id) REFERENCES cierres(id)
        );
        CREATE TABLE IF NOT EXISTS alertas_pc (
            id INTEGER PRIMARY KEY AUTOINCREMENT, cierre_id TEXT NOT NULL,
            tipo TEXT NOT NULL, codigo TEXT, detalle TEXT NOT NULL,
            fecha_hora TEXT NOT NULL, resuelta INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_pc_ventas_fecha ON ventas(fecha_hora);
        CREATE INDEX IF NOT EXISTS idx_pc_lineas_codigo ON lineas_venta(codigo);
        CREATE INDEX IF NOT EXISTS idx_movimientos_codigo_fecha ON movimientos_inventario(codigo,fecha_hora);
        CREATE INDEX IF NOT EXISTS idx_auditoria_pc_fecha ON auditoria_pc(fecha_hora);
        """
    )
    # Migraciones aditivas: conservan las bases maestras de versiones anteriores.
    migrations = {
        "cierres": {
            "secuencia": "INTEGER", "hash_anterior": "TEXT", "tienda": "TEXT",
            "dispositivo": "TEXT", "version": "INTEGER",
        },
        "ventas": {"dependiente_id": "TEXT", "turno_id": "TEXT"},
        "pagos": {"estado": "TEXT NOT NULL DEFAULT 'activo'", "anulado_por": "TEXT", "anulado_en": "TEXT"},
    }
    for table, columns in migrations.items():
        present = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for column, definition in columns.items():
            if column not in present:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_cierres_dispositivo_secuencia ON cierres(tienda,dispositivo,secuencia) WHERE secuencia IS NOT NULL")
    conn.commit()


def audit_pc(conn: sqlite3.Connection, action: str, detail: Any, actor: str = "Propietario") -> None:
    conn.execute(
        "INSERT INTO auditoria_pc(id,fecha_hora,actor,accion,detalle) VALUES(?,?,?,?,?)",
        (str(uuid.uuid4()), now_iso(), actor, action, json.dumps(detail, ensure_ascii=False, sort_keys=True)),
    )


def record_movement(conn: sqlite3.Connection, code: str, kind: str, quantity: int,
                    reference_type: str | None, reference_id: str | None, detail: Any) -> None:
    conn.execute(
        """INSERT INTO movimientos_inventario
           (id,fecha_hora,codigo,tipo,cantidad,referencia_tipo,referencia_id,detalle)
           VALUES(?,?,?,?,?,?,?,?)""",
        (str(uuid.uuid4()), now_iso(), code, kind, int(quantity), reference_type, reference_id,
         json.dumps(detail, ensure_ascii=False, sort_keys=True)),
    )


def finite_number(value: Any, label: str, *, minimum: float | None = None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label}: número no válido")
    if not math.isfinite(number) or (minimum is not None and number < minimum):
        raise ValueError(f"{label}: valor fuera de rango")
    return number


def _validate_sales(sales: list[Any], label: str, allowed_states: set[str], seen_sales: set[str], payload: dict[str, Any]) -> None:
    for index, sale in enumerate(sales, start=1):
        if not isinstance(sale, dict):
            raise ValueError(f"{label} {index}: registro no válido")
        sale_id = str(sale.get("id", "")).strip()
        if not sale_id or sale_id in seen_sales:
            raise ValueError(f"{label} {index}: identificador vacío o repetido")
        seen_sales.add(sale_id)
        if sale.get("estado") not in allowed_states:
            raise ValueError(f"{label} {sale_id}: estado no permitido")
        finite_number(sale.get("total_usd"), f"Venta {sale_id} total_usd", minimum=0)
        finite_number(sale.get("tasa_cup", payload.get("tasa_cup", 0)), f"Venta {sale_id} tasa_cup", minimum=0.000001)
        lines = sale.get("lineas", [])
        payments = sale.get("pagos", [])
        if not isinstance(lines, list) or not isinstance(payments, list):
            raise ValueError(f"Venta {sale_id}: lineas y pagos deben ser listas")
        for line_index, line in enumerate(lines, start=1):
            if not isinstance(line, dict) or not str(line.get("codigo", "")).strip():
                raise ValueError(f"Venta {sale_id}, línea {line_index}: código no válido")
            qty = line.get("cant")
            if isinstance(qty, bool) or not isinstance(qty, int) or qty < 1:
                raise ValueError(f"Venta {sale_id}, línea {line_index}: cantidad debe ser entero positivo")
            finite_number(line.get("precio_usd"), f"Venta {sale_id}, línea {line_index} precio", minimum=0)
        for payment_index, payment in enumerate(payments, start=1):
            if not isinstance(payment, dict) or payment.get("metodo") not in VALID_PAYMENT_METHODS:
                raise ValueError(f"Venta {sale_id}, pago {payment_index}: método no válido")
            if payment.get("estado", "activo") not in {"activo", "anulado"}:
                raise ValueError(f"Venta {sale_id}, pago {payment_index}: estado no válido")
            finite_number(payment.get("monto"), f"Venta {sale_id}, pago {payment_index} monto", minimum=0)
            finite_number(payment.get("tasa_aplicada", 1), f"Venta {sale_id}, pago {payment_index} tasa", minimum=0.000001)
            finite_number(payment.get("equiv_usd"), f"Venta {sale_id}, pago {payment_index} equivalente", minimum=0)


def validate_closure(payload: dict[str, Any]) -> None:
    if payload.get("tipo") != "cierre_ventas":
        raise ValueError("El archivo no es un cierre de ventas CH Cajero")
    version = int(payload.get("version", 0))
    if version not in {1, 2, 3}:
        raise ValueError("Versión de cierre no compatible (se admiten V1, V2 y V3)")
    if not str(payload.get("id_cierre", "")).strip():
        raise ValueError("El cierre no contiene id_cierre")
    if not isinstance(payload.get("ventas"), list):
        raise ValueError("El cierre no contiene una lista de ventas")
    for key in ("productos_nuevos", "stock_final", "anulaciones"):
        if not isinstance(payload.get(key, []), list):
            raise ValueError(f"{key} debe ser una lista")
    seen_sales: set[str] = set()
    if version == 1:
        _validate_sales(payload["ventas"], "Venta", {"cerrada", "anulada"}, seen_sales, payload)
    elif version == 2:
        # V2 incorpora cancelaciones y estado de pagos; el formato legado puede
        # llevar las ventas canceladas dentro de ventas o en su lista separada.
        _validate_sales(payload["ventas"], "Venta", VALID_SALE_STATES, seen_sales, payload)
        cancelled = payload.get("ventas_canceladas", [])
        if not isinstance(cancelled, list):
            raise ValueError("ventas_canceladas debe ser una lista")
        _validate_sales(cancelled, "Venta cancelada", {"cancelada"}, seen_sales, payload)
    else:
        _validate_sales(payload["ventas"], "Venta", {"cerrada", "anulada"}, seen_sales, payload)
        cancelled = payload.get("ventas_canceladas", [])
        if not isinstance(cancelled, list):
            raise ValueError("ventas_canceladas debe ser una lista")
        _validate_sales(cancelled, "Venta cancelada", {"cancelada"}, seen_sales, payload)
        sequence = payload.get("secuencia")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise ValueError("El cierre V3 debe contener una secuencia positiva")
        if not str(payload.get("tienda", "")).strip() or not str(payload.get("dispositivo", "")).strip():
            raise ValueError("El cierre V3 debe identificar tienda y dispositivo")
        inventory = payload.get("inventario")
        if not isinstance(inventory, dict):
            raise ValueError("El cierre V3 no contiene inventario")
        for key in ("entradas", "salidas", "conteos", "ajustes_aprobados"):
            if not isinstance(inventory.get(key), list):
                raise ValueError(f"inventario.{key} debe ser una lista")
        for kind in ("entradas", "salidas"):
            for index, movement in enumerate(inventory[kind], 1):
                if not isinstance(movement, dict) or not str(movement.get("codigo", "")).strip():
                    raise ValueError(f"{kind} {index}: movimiento no válido")
                quantity = movement.get("cant")
                if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 1:
                    raise ValueError(f"{kind} {index}: cantidad debe ser entero positivo")
        for index, adjustment in enumerate(inventory["ajustes_aprobados"], 1):
            if not isinstance(adjustment, dict) or not str(adjustment.get("codigo", "")).strip():
                raise ValueError(f"Ajuste {index}: movimiento no válido")
            delta = adjustment.get("delta")
            if isinstance(delta, bool) or not isinstance(delta, int):
                raise ValueError(f"Ajuste {index}: delta debe ser entero")
        for index, count in enumerate(inventory["conteos"], 1):
            if not isinstance(count, dict) or not isinstance(count.get("detalle", []), list):
                raise ValueError(f"Conteo {index}: registro no válido")
        if not isinstance(payload.get("auditoria", []), list):
            raise ValueError("auditoria debe ser una lista")
        drawer = payload.get("arqueo")
        if not isinstance(drawer, dict):
            raise ValueError("El cierre V3 no contiene arqueo de caja")
        for key in ("esperado_usd", "contado_usd", "diferencia_usd", "esperado_cup", "contado_cup", "diferencia_cup"):
            finite_number(drawer.get(key), f"arqueo.{key}")

    for index, product in enumerate(payload.get("productos_nuevos", []), start=1):
        if not isinstance(product, dict) or not str(product.get("codigo", "")).strip():
            raise ValueError(f"Producto nuevo {index}: código no válido")
        if not str(product.get("nombre", "")).strip():
            raise ValueError(f"Producto nuevo {index}: nombre no válido")
        finite_number(product.get("precio_usd"), f"Producto nuevo {index} precio", minimum=0)
        stock_key = "stock_inicial" if version >= 3 else "stock"
        stock = product.get(stock_key, product.get("stock", 0))
        if isinstance(stock, bool) or not isinstance(stock, int) or stock < 0:
            raise ValueError(f"Producto nuevo {index}: {stock_key} debe ser entero no negativo")


def verify_device_audit_chain(rows: list[dict[str, Any]]) -> int:
    """Verifica la misma serialización JSON que usa audit() en la APK."""
    previous = None
    verified = 0
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise ValueError(f"Auditoría {index}: registro no válido")
        claimed = row.get("hash_evento")
        if not claimed:
            continue  # eventos anteriores a la cadena hash
        linked = row.get("hash_anterior")
        if linked != previous:
            raise ValueError(f"CADENA DE AUDITORÍA ROTA en el evento {index}: hash anterior inesperado")
        event = {
            "fecha_hora": row.get("fecha_hora"),
            "usuario_id": row.get("usuario_id"),
            "usuario": row.get("usuario"),
            "accion": row.get("accion"),
            "detalle": row.get("detalle"),
            "turno_id": row.get("turno_id"),
            "hash_anterior": linked,
        }
        encoded = json.dumps(event, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        calculated = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        if calculated != claimed:
            raise ValueError(f"CADENA DE AUDITORÍA ROTA en el evento {index}: hash del evento incorrecto")
        previous = claimed
        verified += 1
    return verified


def verify_closure_sequence(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    """No acepta saltos ni bifurcaciones en el historial de un dispositivo."""
    if int(payload.get("version", 0)) != 3:
        return
    store, device = str(payload["tienda"]), str(payload["dispositivo"])
    sequence, previous_hash = int(payload["secuencia"]), payload.get("hash_anterior")
    last_v3 = conn.execute(
        "SELECT secuencia,hash FROM cierres WHERE tienda=? AND dispositivo=? AND secuencia IS NOT NULL ORDER BY secuencia DESC LIMIT 1",
        (store, device),
    ).fetchone()
    if last_v3:
        expected_sequence = int(last_v3["secuencia"]) + 1
        expected_hash = last_v3["hash"]
    else:
        # Puente desde cierres V1/V2 anteriores: se conserva el orden ya importado.
        legacy = conn.execute("SELECT hash FROM cierres WHERE secuencia IS NULL ORDER BY importado_en,id").fetchall()
        expected_sequence = len(legacy) + 1
        expected_hash = legacy[-1]["hash"] if legacy else None
    if sequence != expected_sequence:
        raise ValueError(f"SECUENCIA DE CIERRE INCORRECTA: se esperaba {expected_sequence} y llegó {sequence}. Puede faltar un día.")
    if previous_hash != expected_hash:
        raise ValueError("HASH ANTERIOR INCORRECTO: el cierre no enlaza con el último archivo importado.")


def load_archive(path: Path) -> tuple[dict[str, Any], str]:
    path = path.expanduser()
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"No existe el archivo: {path}")
    if path.stat().st_size > MAX_IMPORT_BYTES:
        raise ValueError("El archivo supera el límite de 50 MB")
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path, "r") as archive:
            matches = [info for info in archive.infolist() if Path(info.filename).name == "cierre.json" and not info.is_dir()]
            if len(matches) != 1:
                raise ValueError("El ZIP debe contener exactamente un archivo cierre.json")
            if matches[0].file_size > MAX_IMPORT_BYTES:
                raise ValueError("cierre.json supera el límite de 50 MB")
            with archive.open(matches[0]) as stream:
                raw = stream.read(MAX_IMPORT_BYTES + 1)
            if len(raw) > MAX_IMPORT_BYTES:
                raise ValueError("cierre.json supera el límite de 50 MB")
            payload = json.loads(raw.decode("utf-8"))
    else:
        payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("El contenido JSON no es un objeto")
    return payload, path.name


def save_base64_photo(code: str, data: str | None, photo_dir: Path = PHOTO_DIR) -> str | None:
    if not data:
        return None
    if not isinstance(data, str) or len(data) > 8 * 1024 * 1024:
        raise ValueError("La fotografía del producto tiene formato o tamaño no permitido")
    try:
        decoded = base64.b64decode(data, validate=True)
    except Exception as error:
        raise ValueError("La fotografía del producto no contiene Base64 válido") from error
    if len(decoded) > 6 * 1024 * 1024:
        raise ValueError("La fotografía supera el límite de 6 MB")
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", code)[:60] or "producto"
    photo_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{safe}.jpg"
    path = photo_dir / filename
    path.write_bytes(decoded)
    return f"fotos/{filename}"


def import_closure(conn: sqlite3.Connection, path: Path, photo_dir: Path = PHOTO_DIR) -> tuple[bool, dict[str, Any]]:
    payload, filename = load_archive(path)
    if not verify_hash(payload):
        raise ValueError("HASH INCORRECTO: el archivo fue alterado o está dañado. No se importó.")
    validate_closure(payload)
    closure_id = str(payload["id_cierre"])
    if conn.execute("SELECT 1 FROM cierres WHERE id=?", (closure_id,)).fetchone():
        return False, {"duplicado": True, "id_cierre": closure_id, "archivo": filename}
    version = int(payload.get("version", 1))
    if version == 3:
        audit_verified = verify_device_audit_chain(payload.get("auditoria", []))
        verify_closure_sequence(conn, payload)
    else:
        audit_verified = 0

    sales = list(payload.get("ventas") or [])
    cancelled_sales = list(payload.get("ventas_canceladas") or []) if version >= 2 else []
    all_sales = sales + cancelled_sales
    products_new = payload.get("productos_nuevos") or []
    sold_by_code: dict[str, int] = {}
    for sale in sales:
        if sale.get("estado") != "cerrada":
            continue
        for line in sale.get("lineas") or []:
            if not line.get("anulada"):
                code = str(line["codigo"])
                sold_by_code[code] = sold_by_code.get(code, 0) + int(line["cant"])

    inventory = payload.get("inventario") or {}
    entries = inventory.get("entradas") or []
    exits = inventory.get("salidas") or []
    adjustments = inventory.get("ajustes_aprobados") or []
    counts = inventory.get("conteos") or []

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """INSERT INTO cierres(id,fecha,archivo,hash,importado_en,secuencia,hash_anterior,tienda,dispositivo,version)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (closure_id, str(payload.get("fecha", "")), filename, payload["hash"], now_iso(),
             payload.get("secuencia"), payload.get("hash_anterior"), payload.get("tienda"),
             payload.get("dispositivo"), version),
        )

        # Los productos nuevos comienzan en stock_inicial; los cierres antiguos solo informan stock final.
        for product in products_new:
            code = str(product["codigo"]).strip()
            if version >= 3:
                initial_stock = int(product.get("stock_inicial", 0))
            else:
                current_stock = int(product.get("stock", 0))
                initial_stock = current_stock + sold_by_code.get(code, 0)
            photo_path = save_base64_photo(code, product.get("foto_base64"), photo_dir)
            inserted = conn.execute(
                "INSERT OR IGNORE INTO productos(codigo,nombre,precio_usd,stock,foto,actualizado_en) VALUES(?,?,?,?,?,?)",
                (code, str(product["nombre"]), float(product["precio_usd"]), initial_stock, photo_path, now_iso()),
            )
            if inserted.rowcount == 1:
                record_movement(conn, code, "ALTA_DESDE_CELULAR", initial_stock, "cierre", closure_id,
                                {"stock_inicial": initial_stock, "version_cierre": version})

        inserted_sales = 0
        deducted_units = 0
        cancelled_count = 0
        negative_stock: list[dict[str, Any]] = []
        for sale in all_sales:
            sale_id = str(sale["id"])
            conn.execute(
                """INSERT INTO ventas(id,cierre_id,fecha_hora,dependiente,estado,total_usd,tasa_cup,
                   recargo_transf,motivo_anulacion,vuelto_moneda,vuelto_monto,dependiente_id,turno_id)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (sale_id, closure_id, str(sale.get("fecha_hora", payload.get("generado_en", ""))),
                 str(sale.get("dependiente", "")), str(sale["estado"]), float(sale["total_usd"]),
                 float(sale.get("tasa_cup", payload.get("tasa_cup", 0))),
                 float(sale.get("recargo_transf", payload.get("recargo_transferencia", 20))),
                 sale.get("motivo_anulacion"), (sale.get("vuelto") or {}).get("moneda"),
                 float((sale.get("vuelto") or {}).get("monto", 0)), sale.get("dependiente_id"), sale.get("turno_id")),
            )
            inserted_sales += 1
            if sale["estado"] == "cancelada":
                cancelled_count += 1
            for index, line in enumerate(sale.get("lineas") or []):
                code = str(line["codigo"])
                qty = int(line["cant"])
                is_void = bool(line.get("anulada")) or sale["estado"] in {"anulada", "cancelada"}
                line_id = str(line.get("id") or f"{sale_id}-line-{index+1}")
                conn.execute(
                    """INSERT INTO lineas_venta(id,venta_id,codigo,nombre,precio_usd,cantidad,anulada,motivo_anulacion)
                       VALUES(?,?,?,?,?,?,?,?)""",
                    (line_id, sale_id, code, str(line.get("nombre", "")), float(line["precio_usd"]), qty,
                     1 if is_void else 0, line.get("motivo_anulacion")),
                )
                if sale["estado"] == "cerrada" and not is_void:
                    updated = conn.execute("UPDATE productos SET stock=stock-?,actualizado_en=? WHERE codigo=?", (qty, now_iso(), code))
                    if updated.rowcount == 0:
                        conn.execute(
                            "INSERT INTO productos(codigo,nombre,precio_usd,stock,foto,actualizado_en) VALUES(?,?,?,?,NULL,?)",
                            (code, str(line.get("nombre", code)), float(line["precio_usd"]), -qty, now_iso()),
                        )
                    new_stock = int(conn.execute("SELECT stock FROM productos WHERE codigo=?", (code,)).fetchone()["stock"])
                    if new_stock < 0:
                        negative_stock.append({"codigo": code, "stock": new_stock})
                    record_movement(conn, code, "VENTA_CERRADA", -qty, "venta", sale_id,
                                    {"linea_id": line_id, "cantidad": qty, "precio_usd": float(line["precio_usd"])})
                    deducted_units += qty
            for index, payment in enumerate(sale.get("pagos") or []):
                conn.execute(
                    """INSERT INTO pagos(id,venta_id,metodo,monto,moneda,tasa_aplicada,equivalente_usd,estado,anulado_por,anulado_en)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""",
                    (str(payment.get("id") or f"{sale_id}-pay-{index+1}"), sale_id, str(payment["metodo"]),
                     float(payment["monto"]), str(payment.get("moneda", "")),
                     float(payment.get("tasa_aplicada", 1)), float(payment["equiv_usd"]),
                     payment.get("estado", "activo"), payment.get("anulado_por"), payment.get("anulado_en")),
                )

        # Los movimientos se aplican una sola vez, dentro de la misma transacción.
        movement_count = 0
        for entry in entries:
            code, qty = str(entry["codigo"]), int(entry["cant"])
            current = conn.execute("SELECT stock FROM productos WHERE codigo=?", (code,)).fetchone()
            if not current:
                raise ValueError(f"Entrada de inventario: el producto {code} no existe en el catálogo maestro")
            conn.execute("UPDATE productos SET stock=stock+?,actualizado_en=? WHERE codigo=?", (qty, now_iso(), code))
            record_movement(conn, code, "ENTRADA", qty, "movimiento", str(entry.get("id") or ""),
                            {"usuario": entry.get("usuario"), "estado": entry.get("estado", "pendiente_confirmacion"), "nota": entry.get("nota", "")})
            if entry.get("estado", "pendiente_confirmacion") == "pendiente_confirmacion":
                conn.execute("INSERT INTO alertas_pc(cierre_id,tipo,codigo,detalle,fecha_hora) VALUES(?,?,?,?,?)",
                             (closure_id, "ENTRADA_PENDIENTE", code, json.dumps(entry, ensure_ascii=False), now_iso()))
            movement_count += 1

        for exit_row in exits:
            code, qty = str(exit_row["codigo"]), int(exit_row["cant"])
            current = conn.execute("SELECT stock FROM productos WHERE codigo=?", (code,)).fetchone()
            if not current:
                raise ValueError(f"Salida de inventario: el producto {code} no existe en el catálogo maestro")
            after = int(current["stock"]) - qty
            conn.execute("UPDATE productos SET stock=?,actualizado_en=? WHERE codigo=?", (after, now_iso(), code))
            if after < 0:
                negative_stock.append({"codigo": code, "stock": after, "origen": "salida"})
            record_movement(conn, code, "SALIDA", -qty, "movimiento", str(exit_row.get("id") or ""),
                            {"usuario": exit_row.get("usuario"), "motivo": exit_row.get("motivo"), "nota": exit_row.get("nota", "")})
            movement_count += 1

        for adjustment in adjustments:
            code, delta = str(adjustment["codigo"]), int(adjustment["delta"])
            current = conn.execute("SELECT stock FROM productos WHERE codigo=?", (code,)).fetchone()
            if not current:
                raise ValueError(f"Ajuste de conteo: el producto {code} no existe en el catálogo maestro")
            after = int(current["stock"]) + delta
            if after < 0:
                raise ValueError(f"El ajuste aprobado de {code} produciría stock negativo")
            conn.execute("UPDATE productos SET stock=?,actualizado_en=? WHERE codigo=?", (after, now_iso(), code))
            record_movement(conn, code, "AJUSTE_CONTEO", delta, "conteo", str(adjustment.get("movimiento_origen") or adjustment.get("id") or ""),
                            {"motivo": adjustment.get("motivo"), "aprobado_por": adjustment.get("aprobado_por"), "de": adjustment.get("de"), "a": adjustment.get("a")})
            movement_count += 1

        for count in counts:
            count_id = str(count.get("id") or uuid.uuid4())
            conn.execute("INSERT INTO conteos_pc(id,cierre_id,inicio,fin,usuario,estado) VALUES(?,?,?,?,?,?)",
                         (count_id, closure_id, str(count.get("inicio", "")), count.get("fin"), str(count.get("usuario", "")), str(count.get("estado", ""))))
            for detail in count.get("detalle", []):
                conn.execute("""INSERT INTO conteo_detalle_pc(conteo_id,codigo,esperado,conteo_1,hora_1,conteo_2,hora_2,
                               resultado,decision_admin,motivo,visible_para) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                             (count_id, str(detail.get("codigo", "")), int(detail.get("esperado", 0)), detail.get("conteo_1"),
                              detail.get("hora_1"), detail.get("conteo_2"), detail.get("hora_2"), str(detail.get("resultado", "")),
                              detail.get("decision_admin"), detail.get("motivo"), detail.get("visible_para")))
                if detail.get("resultado") == "pendiente_verificar":
                    conn.execute("INSERT INTO alertas_pc(cierre_id,tipo,codigo,detalle,fecha_hora) VALUES(?,?,?,?,?)",
                                 (closure_id, "CONTEO_PENDIENTE_VERIFICAR", detail.get("codigo"), json.dumps(detail, ensure_ascii=False), now_iso()))

        for turn in payload.get("turnos", []):
            conn.execute("INSERT OR IGNORE INTO turnos_pc(id,cierre_id,usuario_id,usuario,inicio,fin) VALUES(?,?,?,?,?,?)",
                         (str(turn.get("id") or uuid.uuid4()), closure_id, turn.get("usuario_id"), str(turn.get("usuario", "")),
                          str(turn.get("inicio", "")), turn.get("fin")))

        for event in payload.get("auditoria", []):
            if event.get("hash_evento"):
                conn.execute("""INSERT INTO auditoria_dispositivo(id,cierre_id,fecha_hora,usuario_id,usuario,accion,detalle,
                               turno_id,hash_anterior,hash_evento) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                             (str(event.get("id") or uuid.uuid4()), closure_id, str(event.get("fecha_hora", "")), event.get("usuario_id"),
                              str(event.get("usuario", "")), str(event.get("accion", "")), str(event.get("detalle", "")),
                              event.get("turno_id"), event.get("hash_anterior"), str(event["hash_evento"])))

        if version >= 3:
            drawer = payload["arqueo"]
            conn.execute("""INSERT INTO arqueos_pc(id,cierre_id,esperado_usd,contado_usd,diferencia_usd,
                           esperado_cup,contado_cup,diferencia_cup) VALUES(?,?,?,?,?,?,?,?)""",
                         (str(uuid.uuid4()), closure_id, float(drawer["esperado_usd"]), float(drawer["contado_usd"]),
                          float(drawer["diferencia_usd"]), float(drawer["esperado_cup"]), float(drawer["contado_cup"]), float(drawer["diferencia_cup"])))
            if float(drawer["diferencia_usd"]) != 0 or float(drawer["diferencia_cup"]) != 0:
                conn.execute("INSERT INTO alertas_pc(cierre_id,tipo,codigo,detalle,fecha_hora) VALUES(?,?,?,?,?)",
                             (closure_id, "DIFERENCIA_ARQUEO", None, json.dumps(drawer, ensure_ascii=False), now_iso()))

        # Se registra el stock final observado, pero nunca se sobrescribe el stock maestro silenciosamente.
        stock_discrepancies = []
        for item in payload.get("stock_final", []):
            code = str(item.get("codigo", ""))
            current = conn.execute("SELECT stock FROM productos WHERE codigo=?", (code,)).fetchone()
            expected = int(item.get("stock", 0))
            if current and int(current["stock"]) != expected:
                difference = int(current["stock"]) - expected
                discrepancy = {"codigo": code, "stock_pc": int(current["stock"]), "stock_celular": expected, "diferencia": difference}
                stock_discrepancies.append(discrepancy)
                conn.execute("INSERT INTO alertas_pc(cierre_id,tipo,codigo,detalle,fecha_hora) VALUES(?,?,?,?,?)",
                             (closure_id, "DIFERENCIA_STOCK", code, json.dumps(discrepancy, ensure_ascii=False), now_iso()))

        audit_pc(conn, "IMPORTAR_CIERRE", {
            "id_cierre": closure_id, "archivo": filename, "hash": payload["hash"], "version": version,
            "ventas": inserted_sales, "ventas_canceladas": cancelled_count, "unidades_descontadas": deducted_units,
            "movimientos_inventario": movement_count, "productos_nuevos": len(products_new),
            "auditoria_verificada": audit_verified, "stock_negativo": negative_stock,
            "diferencias_stock": stock_discrepancies,
        })
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    summary = {
        "duplicado": False, "id_cierre": closure_id, "fecha": payload.get("fecha"), "version": version,
        "ventas": inserted_sales, "ventas_canceladas": cancelled_count,
        "total_usd": (payload.get("resumen") or {}).get("total_usd", (payload.get("resumen") or {}).get("total_usd", 0)),
        "unidades_descontadas": deducted_units, "movimientos_inventario": movement_count,
        "productos_nuevos": len(products_new), "stock_negativo": negative_stock,
        "diferencias_stock": stock_discrepancies, "auditoria_verificada": audit_verified, "hash": payload["hash"],
    }
    return True, summary


def set_product(conn: sqlite3.Connection, code: str, name: str, price: float, stock: int,
                photo: str | None, photo_dir: Path = PHOTO_DIR, actor: str = "Propietario") -> None:
    price = finite_number(price, "Precio USD", minimum=0)
    if not code.strip() or not name.strip() or isinstance(stock, bool) or not isinstance(stock, int) or stock < 0:
        raise ValueError("Código, nombre o stock no válidos")
    photo_path = None
    if photo:
        source = Path(photo).expanduser().resolve()
        if not source.is_file():
            raise FileNotFoundError(f"No existe la foto: {source}")
        photo_dir.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9_-]", "_", code)[:60]
        suffix = source.suffix.lower() if source.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"
        dest = photo_dir / f"{safe}{suffix}"
        shutil.copy2(source, dest)
        photo_path = f"fotos/{dest.name}"
    old = conn.execute("SELECT stock FROM productos WHERE codigo=?", (code.strip(),)).fetchone()
    previous_stock = int(old["stock"]) if old else 0
    conn.execute(
        """INSERT INTO productos(codigo,nombre,precio_usd,stock,foto,actualizado_en) VALUES(?,?,?,?,?,?)
           ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre,precio_usd=excluded.precio_usd,
           stock=excluded.stock,foto=COALESCE(excluded.foto,productos.foto),actualizado_en=excluded.actualizado_en""",
        (code.strip(), name.strip(), round(price, 2), stock, photo_path, now_iso()),
    )
    delta = stock - previous_stock
    if delta:
        record_movement(conn, code.strip(), "AJUSTE_MANUAL", delta, "producto", code.strip(),
                        {"stock_anterior": previous_stock, "stock_nuevo": stock})
    audit_pc(conn, "GUARDAR_PRODUCTO", {"codigo": code.strip(), "nombre": name.strip(), "precio_usd": round(price, 2),
                                           "stock_anterior": previous_stock, "stock_nuevo": stock}, actor)
    conn.commit()


def export_catalog(conn: sqlite3.Connection, output: Path, inventory_corrected: bool,
                   photo_dir: Path = PHOTO_DIR, actor: str = "Propietario") -> None:
    rows = conn.execute("SELECT codigo,nombre,precio_usd,stock,foto FROM productos ORDER BY codigo").fetchall()
    products = []
    archive_items: dict[str, bytes] = {}
    for row in rows:
        photo_name = None
        if row["foto"]:
            photo_path = photo_dir / Path(row["foto"]).name
            if photo_path.is_file():
                photo_name = f"fotos/{photo_path.name}"
                archive_items[photo_name] = photo_path.read_bytes()
        products.append({"codigo": row["codigo"], "nombre": row["nombre"], "precio_usd": float(row["precio_usd"]),
                         "stock": int(row["stock"]), "foto": photo_name})
    payload = add_hash({
        "tipo": "catalogo", "version": 1, "generado_en": now_iso(), "modo": "reemplazar",
        "inventario_corregido": bool(inventory_corrected), "tasa_cup_sugerida": None, "productos": products,
    })
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("catalogo.json", canonical_json(payload).encode("utf-8"))
        for name, content in archive_items.items():
            archive.writestr(name, content)
    audit_pc(conn, "EXPORTAR_CATALOGO", {"archivo": str(output), "productos": len(products),
                                         "inventario_corregido": bool(inventory_corrected), "hash": payload["hash"]}, actor)
    conn.commit()
    print(f"OK: catálogo exportado: {output}")
    print(f"Productos: {len(products)} | Inventario corregido: {'SÍ' if inventory_corrected else 'NO'}")
    print(f"SHA-256: {payload['hash']}")


def list_products(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT codigo,nombre,precio_usd,stock,foto FROM productos ORDER BY nombre COLLATE NOCASE").fetchall()
    if not rows:
        print("No hay productos. Añade productos con el comando producto.")
        return
    print(f"{'CÓDIGO':<20} {'NOMBRE':<36} {'USD':>10} {'STOCK':>8}")
    print("-" * 80)
    for row in rows:
        print(f"{row['codigo'][:20]:<20} {row['nombre'][:36]:<36} {row['precio_usd']:>10.2f} {row['stock']:>8}")


def report(conn: sqlite3.Connection, start: str | None, end: str | None) -> None:
    today = dt.date.today()
    monday = today - dt.timedelta(days=today.weekday())
    from_date, to_date = start or monday.isoformat(), end or today.isoformat()
    try:
        from_day, to_day = dt.date.fromisoformat(from_date), dt.date.fromisoformat(to_date)
    except ValueError as error:
        raise ValueError("Las fechas deben tener formato YYYY-MM-DD") from error
    if from_day > to_day:
        raise ValueError("La fecha inicial no puede ser posterior a la fecha final")
    sales = conn.execute(
        "SELECT COUNT(*) AS n,COALESCE(SUM(total_usd),0) AS total FROM ventas WHERE estado='cerrada' AND date(fecha_hora) BETWEEN ? AND ?",
        (from_date, to_date),
    ).fetchone()
    lines = conn.execute(
        """SELECT l.codigo,l.nombre,SUM(l.cantidad) AS unidades,
           SUM(l.cantidad*l.precio_usd) AS importe
           FROM lineas_venta l JOIN ventas v ON v.id=l.venta_id
           WHERE v.estado='cerrada' AND l.anulada=0 AND date(v.fecha_hora) BETWEEN ? AND ?
           GROUP BY l.codigo,l.nombre ORDER BY unidades DESC,importe DESC""",
        (from_date, to_date),
    ).fetchall()
    print(f"INFORME {from_date} → {to_date}")
    print(f"Ventas cerradas: {sales['n']} | Total: ${sales['total']:.2f} USD")
    print("Productos vendidos (más a menos):")
    for row in lines:
        print(f"  {row['unidades']:>5} u. | ${row['importe']:>10.2f} | {row['codigo']} | {row['nombre']}")
    if not lines:
        print("  No hay unidades vendidas en ese período.")
    alerts = conn.execute(
        "SELECT tipo,codigo,detalle,fecha_hora FROM alertas_pc WHERE date(fecha_hora) BETWEEN ? AND ? AND resuelta=0 ORDER BY fecha_hora DESC",
        (from_date, to_date),
    ).fetchall()
    print(f"Alertas de inventario/caja pendientes: {len(alerts)}")
    for alert in alerts:
        label = f" · {alert['codigo']}" if alert['codigo'] else ""
        print(f"  [{alert['tipo']}{label}] {alert['fecha_hora']} · {alert['detalle']}")


def show_audit(conn: sqlite3.Connection, limit: int) -> None:
    rows = conn.execute("SELECT fecha_hora,actor,accion,detalle FROM auditoria_pc ORDER BY fecha_hora DESC LIMIT ?", (limit,)).fetchall()
    if not rows:
        print("Todavía no hay eventos de auditoría en la PC.")
        return
    for row in rows:
        print(f"{row['fecha_hora']} | {row['actor']} | {row['accion']} | {row['detalle']}")


def verify_closure_file(path: Path) -> dict[str, Any]:
    payload, filename = load_archive(path)
    if not verify_hash(payload):
        raise ValueError("HASH INCORRECTO: archivo alterado o dañado")
    validate_closure(payload)
    audit_verified = verify_device_audit_chain(payload.get("auditoria", [])) if int(payload.get("version", 0)) == 3 else 0
    return {"archivo": filename, "id_cierre": payload["id_cierre"], "fecha": payload.get("fecha"),
            "version": int(payload.get("version", 1)), "ventas": len(payload["ventas"]),
            "ventas_canceladas": len(payload.get("ventas_canceladas", [])) + sum(1 for sale in payload.get("ventas", []) if sale.get("estado") == "cancelada"),
            "auditoria_verificada": audit_verified, "hash": payload["hash"], "valido": True}


def cmd_import(args: argparse.Namespace) -> int:
    db_path = Path(args.db).expanduser()
    with connect(db_path) as conn:
        success, summary = import_closure(conn, Path(args.file).expanduser(), photo_dir_for_db(db_path))
        if not success:
            print(f"DUPLICADO: el cierre {summary['id_cierre']} ya fue importado. No se descontó inventario otra vez.")
            return 2
        print("CIERRE IMPORTADO CORRECTAMENTE")
        for key, value in summary.items():
            print(f"{key}: {value}")
        print("Inventario maestro y libro de movimientos actualizados.")
        if summary["stock_negativo"]:
            print("ADVERTENCIA: hay productos con stock negativo. Revisa la sincronización del catálogo.")
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Herramienta de inventario CH Cajero (offline)")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Ruta a la base SQLite del inventario maestro")
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("importar-cierre", help="Verifica e importa un ZIP/JSON de cierre")
    imp.add_argument("file", help="Ruta al archivo recibido del teléfono")
    imp.set_defaults(func=cmd_import)
    verify = sub.add_parser("verificar-cierre", help="Comprueba hash y estructura sin importar ni descontar stock")
    verify.add_argument("file", help="Ruta al cierre ZIP/JSON")
    verify.set_defaults(func=lambda args: (print(json.dumps(verify_closure_file(Path(args.file)), ensure_ascii=False, indent=2)) or 0))
    exp = sub.add_parser("exportar-catalogo", help="Crea el ZIP de catálogo para importar en el teléfono")
    exp.add_argument("--salida", default=f"catalogo_{dt.date.today().isoformat()}.zip")
    exp.add_argument("--inventario-corregido", action="store_true", help="Permite reemplazar stock local al importar en el teléfono")
    exp.set_defaults(func=lambda args: (export_catalog(connect(Path(args.db)), Path(args.salida), args.inventario_corregido,
                                                       photo_dir_for_db(Path(args.db))) or 0))
    prod = sub.add_parser("producto", help="Crear o actualizar un producto del catálogo maestro")
    prod.add_argument("--codigo", required=True)
    prod.add_argument("--nombre", required=True)
    prod.add_argument("--precio-usd", type=float, required=True)
    prod.add_argument("--stock", type=int, required=True)
    prod.add_argument("--foto", help="Ruta opcional a una fotografía")
    prod.set_defaults(func=lambda args: (set_product(connect(Path(args.db)), args.codigo, args.nombre, args.precio_usd,
                                                      args.stock, args.foto, photo_dir_for_db(Path(args.db))) or print("Producto guardado.") or 0))
    ls = sub.add_parser("productos", help="Lista el inventario maestro")
    ls.set_defaults(func=lambda args: (list_products(connect(Path(args.db))) or 0))
    rep = sub.add_parser("informe", help="Resumen de ventas y ranking de productos")
    rep.add_argument("--desde", help="Fecha inicial YYYY-MM-DD; por defecto, lunes de esta semana")
    rep.add_argument("--hasta", help="Fecha final YYYY-MM-DD; por defecto, hoy")
    rep.set_defaults(func=lambda args: (report(connect(Path(args.db)), args.desde, args.hasta) or 0))
    audit = sub.add_parser("auditoria", help="Consulta operaciones registradas en la PC")
    audit.add_argument("--limite", type=int, default=30)
    audit.set_defaults(func=lambda args: (show_audit(connect(Path(args.db)), max(1, min(args.limite, 500))) or 0))
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
