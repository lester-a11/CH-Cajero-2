# Fase 2 — Cobro mixto, pausa, cierre e historial

## Alcance

Implementa las secciones 3.3, 3.4 y 3.5 y el criterio de aceptación de Fase 2 del documento base. No introduce un servidor ni sincronización en línea.

## Cobros

La venta se expresa en USD y conserva la tasa y el recargo aplicables al momento de crearla. Se admiten pagos sucesivos en USD efectivo, CUP efectivo y transferencia.

- USD: equivalente USD = monto recibido.
- CUP: equivalente USD = monto CUP / tasa de la venta.
- Transferencia: monto CUP requerido = saldo USD × tasa × (1 + recargo/100). Equivalente USD acreditado = (CUP recibido / (1 + recargo/100)) / tasa.
- El recargo inicial es 20 %, según Anexo A.1. Solo afecta transferencias.
- La pantalla indica FALTA o LISTO. No permite finalizar con saldo positivo.
- El vuelto se calcula sobre el excedente y se elige en USD efectivo o CUP efectivo a la tasa de la venta.
- Los pagos guardan método, monto original, moneda, tasa aplicada, equivalente USD y fecha/hora.

## Vida de venta

- Una venta abierta puede pausarse.
- Una venta pausada puede retomarse si no hay otra venta activa.
- Los pagos ya registrados siguen ligados a la misma venta.
- La venta solo cambia a cerrada al cubrir el total; el cierre actualiza el stock local en la misma operación lógica.
- Los controles de exclusión y las condiciones de estado evitan registrar dos veces un pago o descontar dos veces el inventario por pulsaciones repetidas.

## Historial y anulaciones

El historial muestra las ventas de la jornada y permite revisar líneas, pagos, tasa y recargo históricos. Las anulaciones solicitan motivo y PIN del administrador, no borran registros y generan auditoría. Al anular una venta cerrada se repone solo el stock de las líneas que no estaban anuladas previamente.

## Decisiones respetadas

- La tasa se confirma al abrir el día y queda fija para el dependiente. La corrección de tasa requiere PIN de administrador, registro de auditoría y solo afecta ventas futuras.
- El recargo también requiere PIN de administrador y las ventas existentes conservan su recargo snapshot.
- Vuelto: el cajero elige USD o CUP efectivo, según Anexo A.10.
- La fórmula del recargo usa 1.20 cuando está configurado en 20 %, según Anexo A.1.

## Validación local

- 20 pruebas JavaScript dirigidas de Fase 1 y Fase 2: superadas.
- Sintaxis de los módulos JavaScript: verificada con `node --check`.
- Compilación Vite/Gradle y operación con pantalla táctil: requieren que GitHub Actions instale dependencias y genere el APK; la instalación/prueba en Redmi 14C sigue pendiente.

## Punto no definido en el documento

El documento exige registrar anulaciones, reponer stock y conservar el motivo, pero no especifica cómo se registra o entrega una devolución monetaria cuando se anula una venta que ya recibió pagos. Esta fase conserva los pagos históricos y el registro de anulación; no implementa un mecanismo de reembolso inventado.
