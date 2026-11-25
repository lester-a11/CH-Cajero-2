import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / 'pc' / 'pc_tool.py'
spec = importlib.util.spec_from_file_location('pc_tool', MODULE_PATH)
pc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pc)


class ClosureImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = self.root / 'test.db'
        self.conn = pc.sqlite3.connect(self.db)
        self.conn.row_factory = pc.sqlite3.Row
        pc.init_schema(self.conn)
        self.conn.execute(
            'INSERT INTO productos(codigo,nombre,precio_usd,stock,actualizado_en) VALUES(?,?,?,?,?)',
            ('A-01', 'Producto A', 2.0, 10, pc.now_iso())
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        self.temp.cleanup()

    def make_archive(self, name='cierre.zip', tamper=False):
        payload = {
            'tipo': 'cierre_ventas', 'version': 1, 'id_cierre': 'cierre-test-1',
            'tienda': 'CH', 'dispositivo': 'PHONE-1', 'fecha': '2026-11-18',
            'generado_en': '2026-11-18T20:00:00-05:00', 'tasa_cup': 500,
            'recargo_transferencia': 20,
            'ventas': [
                {
                    'id': 'sale-1', 'fecha_hora': '2026-11-18T19:00:00-05:00', 'dependiente': 'Cajero',
                    'estado': 'cerrada', 'total_usd': 4.0, 'tasa_cup': 500, 'recargo_transf': 20,
                    'lineas': [
                        {'id': 'line-1', 'codigo': 'A-01', 'nombre': 'Producto A', 'cant': 2, 'precio_usd': 2, 'anulada': False},
                        {'id': 'line-2', 'codigo': 'B-02', 'nombre': 'Producto B', 'cant': 1, 'precio_usd': 1, 'anulada': True}
                    ],
                    'pagos': [{'id': 'pay-1', 'metodo': 'USD', 'monto': 4, 'moneda': 'USD', 'tasa_aplicada': 1, 'equiv_usd': 4}],
                    'vuelto': {'moneda': None, 'monto': 0}
                },
                {
                    'id': 'sale-2', 'fecha_hora': '2026-11-18T19:30:00-05:00', 'dependiente': 'Cajero',
                    'estado': 'anulada', 'total_usd': 8.0, 'tasa_cup': 500, 'recargo_transf': 20,
                    'lineas': [{'id': 'line-3', 'codigo': 'A-01', 'nombre': 'Producto A', 'cant': 4, 'precio_usd': 2, 'anulada': True}],
                    'pagos': [], 'vuelto': {'moneda': None, 'monto': 0}
                }
            ],
            'productos_nuevos': [{'codigo': 'B-02', 'nombre': 'Producto B', 'precio_usd': 1.0, 'stock': 3, 'foto_base64': None}],
            'anulaciones': [], 'stock_final': [{'codigo': 'A-01', 'stock': 8}, {'codigo': 'B-02', 'stock': 3}],
            'resumen': {'n_ventas': 1, 'total_usd': 4}
        }
        payload = pc.add_hash(payload)
        if tamper:
            payload['resumen']['total_usd'] = 99
        path = self.root / name
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('cierre.json', pc.canonical_json(payload).encode('utf-8'))
        return path

    def test_stock_is_decremented_once_and_annulled_lines_are_ignored(self):
        path = self.make_archive()
        imported, summary = pc.import_closure(self.conn, path)
        self.assertTrue(imported)
        self.assertEqual(self.conn.execute('SELECT stock FROM productos WHERE codigo=?', ('A-01',)).fetchone()['stock'], 8)
        # El producto B inicia con stock final 3 + una unidad vendida; después se descuenta esa unidad.
        self.assertEqual(self.conn.execute('SELECT stock FROM productos WHERE codigo=?', ('B-02',)).fetchone()['stock'], 3)
        self.assertEqual(summary['unidades_descontadas'], 2)

    def test_duplicate_closure_is_not_applied_twice(self):
        path = self.make_archive()
        self.assertTrue(pc.import_closure(self.conn, path)[0])
        imported, summary = pc.import_closure(self.conn, path)
        self.assertFalse(imported)
        self.assertTrue(summary['duplicado'])
        self.assertEqual(self.conn.execute('SELECT stock FROM productos WHERE codigo=?', ('A-01',)).fetchone()['stock'], 8)

    def test_import_is_audited_and_duplicate_does_not_repeat_inventory_or_audit(self):
        path = self.make_archive()
        self.assertTrue(pc.import_closure(self.conn, path)[0])
        count_after_first = self.conn.execute('SELECT COUNT(*) FROM auditoria_pc').fetchone()[0]
        self.assertEqual(count_after_first, 1)
        imported, summary = pc.import_closure(self.conn, path)
        self.assertFalse(imported)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM auditoria_pc').fetchone()[0], 1)

    def test_tampered_hash_is_rejected(self):
        path = self.make_archive(tamper=True)
        with self.assertRaisesRegex(ValueError, 'HASH INCORRECTO'):
            pc.import_closure(self.conn, path)

    def make_v3_archive(self, name='cierre-v3.zip', *, sequence=1, previous_hash=None, tamper_audit=False):
        event = {
            'fecha_hora': '2026-11-24T18:00:00.000Z', 'usuario_id': 'user-1', 'usuario': 'Dependiente 1',
            'accion': 'entrada_inventario', 'detalle': '{"codigo":"A-01","cantidad":3}',
            'turno_id': 'turn-1', 'hash_anterior': None,
        }
        event_hash = pc.hashlib.sha256(pc.json.dumps(event, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()
        audit = [{
            'orden': 1, 'id': 'audit-1', **event, 'hash_evento': event_hash,
        }]
        if tamper_audit:
            audit[0]['detalle'] = '{"codigo":"A-01","cantidad":999}'
        payload = {
            'tipo': 'cierre_ventas', 'version': 3, 'id_cierre': 'cierre-v3-1',
            'secuencia': sequence, 'hash_anterior': previous_hash, 'tienda': 'CH', 'dispositivo': 'PHONE-1',
            'fecha': '2026-11-24', 'generado_en': '2026-11-24T20:00:00-05:00', 'tasa_cup': 500,
            'turnos': [{'id': 'turn-1', 'usuario_id': 'user-1', 'usuario': 'Dependiente 1', 'inicio': '08:00', 'fin': '20:00'}],
            'ventas': [{
                'id': 'sale-v3-1', 'fecha_hora': '2026-11-24T10:00:00-05:00', 'dependiente': 'Dependiente 1',
                'dependiente_id': 'user-1', 'turno_id': 'turn-1', 'estado': 'cerrada', 'total_usd': 4,
                'tasa_cup': 500, 'recargo_transf': 20,
                'lineas': [{'id': 'line-v3-1', 'codigo': 'A-01', 'nombre': 'Producto A', 'cant': 2, 'precio_usd': 2, 'anulada': False}],
                'pagos': [
                    {'id': 'pay-v3-1', 'metodo': 'USD', 'monto': 4, 'moneda': 'USD', 'tasa_aplicada': 1, 'equiv_usd': 4, 'estado': 'activo'},
                    {'id': 'pay-v3-2', 'metodo': 'USD', 'monto': 1, 'moneda': 'USD', 'tasa_aplicada': 1, 'equiv_usd': 1, 'estado': 'anulado'},
                ], 'vuelto': {'moneda': None, 'monto': 0}
            }],
            'ventas_canceladas': [{
                'id': 'sale-v3-cancelled', 'fecha_hora': '2026-11-24T11:00:00-05:00', 'dependiente': 'Dependiente 1',
                'dependiente_id': 'user-1', 'turno_id': 'turn-1', 'estado': 'cancelada', 'total_usd': 2,
                'tasa_cup': 500, 'recargo_transf': 20,
                'lineas': [{'id': 'line-v3-cancelled', 'codigo': 'A-01', 'nombre': 'Producto A', 'cant': 1, 'precio_usd': 2}],
                'pagos': [{'id': 'pay-v3-cancelled', 'metodo': 'USD', 'monto': 2, 'moneda': 'USD', 'tasa_aplicada': 1, 'equiv_usd': 2, 'estado': 'anulado'}],
                'vuelto': {'moneda': None, 'monto': 0}
            }],
            'inventario': {
                'entradas': [{'id': 'entry-1', 'hora': '12:00', 'usuario': 'Dependiente 1', 'codigo': 'A-01', 'cant': 3, 'estado': 'pendiente_confirmacion', 'nota': 'Factura'}],
                'salidas': [{'id': 'exit-1', 'hora': '13:00', 'usuario': 'Administrador', 'codigo': 'A-01', 'cant': 1, 'motivo': 'merma', 'nota': ''}],
                'conteos': [{'id': 'count-1', 'inicio': '14:00', 'fin': '15:00', 'usuario': 'Dependiente 1', 'estado': 'confirmado',
                             'detalle': [{'codigo': 'A-01', 'esperado': 10, 'conteo_1': 8, 'hora_1': '14:10', 'conteo_2': 8, 'hora_2': '14:20', 'resultado': 'pendiente_verificar', 'decision_admin': None, 'motivo': None, 'visible_para': 'administrador'}]}],
                'ajustes_aprobados': [{'id': 'adjust-1', 'codigo': 'A-01', 'delta': 1, 'de': 10, 'a': 11, 'motivo': 'error de conteo', 'aprobado_por': 'Administrador'}],
            },
            'arqueo': {'esperado_usd': 4, 'contado_usd': 3, 'diferencia_usd': -1, 'esperado_cup': 0, 'contado_cup': 0, 'diferencia_cup': 0},
            'anulaciones': [], 'auditoria': audit,
            'productos_nuevos': [{'codigo': 'B-02', 'nombre': 'Producto B', 'precio_usd': 1, 'stock_inicial': 2, 'foto_base64': None}],
            'resumen': {'n_ventas': 1, 'total_usd': 4, 'n_ventas_canceladas': 1, 'n_pagos_anulados': 2},
            'stock_final': [{'codigo': 'A-01', 'stock': 11}, {'codigo': 'B-02', 'stock': 2}],
        }
        payload = pc.add_hash(payload)
        path = self.root / name
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('cierre.json', pc.canonical_json(payload).encode('utf-8'))
        return path, payload

    def test_v2_accepts_cancelled_sales_and_annulled_payment_without_stock_discount(self):
        payload = {
            'tipo': 'cierre_ventas', 'version': 2, 'id_cierre': 'cierre-v2-cancelled',
            'fecha': '2026-11-23', 'generado_en': '2026-11-23T20:00:00-05:00', 'tasa_cup': 500,
            'ventas': [{
                'id': 'sale-v2-cancelled', 'fecha_hora': '2026-11-23T19:00:00-05:00', 'dependiente': 'Dependiente 1',
                'estado': 'cancelada', 'total_usd': 2, 'tasa_cup': 500, 'recargo_transf': 20,
                'lineas': [{'id': 'line-v2-cancelled', 'codigo': 'A-01', 'nombre': 'Producto A', 'cant': 1, 'precio_usd': 2}],
                'pagos': [{'id': 'pay-v2-cancelled', 'metodo': 'USD', 'monto': 2, 'moneda': 'USD', 'tasa_aplicada': 1, 'equiv_usd': 2, 'estado': 'anulado'}],
            }],
            'productos_nuevos': [], 'anulaciones': [], 'stock_final': [{'codigo': 'A-01', 'stock': 10}],
            'resumen': {'n_ventas': 0, 'total_usd': 0, 'n_ventas_canceladas': 1, 'n_pagos_anulados': 1},
        }
        path = self.root / 'cierre-v2-cancelled.zip'
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('cierre.json', pc.canonical_json(pc.add_hash(payload)).encode('utf-8'))
        imported, summary = pc.import_closure(self.conn, path, self.root / 'photos')
        self.assertTrue(imported)
        self.assertEqual(summary['ventas_canceladas'], 1)
        self.assertEqual(self.conn.execute('SELECT stock FROM productos WHERE codigo=?', ('A-01',)).fetchone()['stock'], 10)
        self.assertEqual(self.conn.execute("SELECT estado FROM pagos WHERE id='pay-v2-cancelled'").fetchone()['estado'], 'anulado')

    def test_v3_imports_cancellations_inventory_and_audit_chain(self):
        path, _ = self.make_v3_archive()
        imported, summary = pc.import_closure(self.conn, path, self.root / 'photos')
        self.assertTrue(imported)
        self.assertEqual(summary['version'], 3)
        self.assertEqual(summary['ventas_canceladas'], 1)
        # 10 iniciales - 2 venta cerrada + 3 entrada - 1 salida + 1 ajuste = 11.
        self.assertEqual(self.conn.execute('SELECT stock FROM productos WHERE codigo=?', ('A-01',)).fetchone()['stock'], 11)
        # La venta cancelada no descuenta y el pago anulado no se conserva como activo.
        self.assertEqual(self.conn.execute("SELECT estado FROM ventas WHERE id='sale-v3-cancelled'").fetchone()['estado'], 'cancelada')
        self.assertEqual(self.conn.execute("SELECT estado FROM pagos WHERE id='pay-v3-2'").fetchone()['estado'], 'anulado')
        self.assertEqual(self.conn.execute('SELECT stock FROM productos WHERE codigo=?', ('B-02',)).fetchone()['stock'], 2)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM auditoria_dispositivo').fetchone()[0], 1)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM alertas_pc WHERE tipo='ENTRADA_PENDIENTE'").fetchone()[0], 1)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM alertas_pc WHERE tipo='DIFERENCIA_ARQUEO'").fetchone()[0], 1)

    def test_v3_rejects_audit_chain_tampering(self):
        path, _ = self.make_v3_archive(tamper_audit=True)
        with self.assertRaisesRegex(ValueError, 'CADENA DE AUDITORÍA ROTA'):
            pc.import_closure(self.conn, path, self.root / 'photos')

    def test_v3_rejects_sequence_gap(self):
        path, _ = self.make_v3_archive(sequence=2)
        with self.assertRaisesRegex(ValueError, 'SECUENCIA DE CIERRE INCORRECTA'):
            pc.import_closure(self.conn, path, self.root / 'photos')

    def test_v3_rejects_previous_hash_mismatch(self):
        path, _ = self.make_v3_archive(previous_hash='sha256-not-the-previous-closure')
        with self.assertRaisesRegex(ValueError, 'HASH ANTERIOR INCORRECTO'):
            pc.import_closure(self.conn, path, self.root / 'photos')


if __name__ == '__main__':
    unittest.main()
