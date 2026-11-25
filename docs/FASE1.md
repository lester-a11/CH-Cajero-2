# Fase 1 — Caja, escáner, catálogo y carrito

## Alcance según la especificación

- Proyecto base Android offline.
- Captura del lector USB HID sin campo de texto enfocado.
- Tarjeta de producto con imagen cuando el catálogo incluye foto, nombre, código, precio USD y stock local.
- Control de cantidad con botones +/−, entrada numérica y botón Añadir.
- Carrito que acumula en la misma línea un código ya presente.
- Total USD visible y actualizado.
- Catálogo de demostración con tres productos de $1, $2 y $3.
- Hoja de etiquetas EAN-13 SVG lista para imprimir en papel mate al 100 % de escala.
- Tema blanco, azul oscuro y botones de cantidad negros.

## Implementación

- Capacitor 8 para empaquetado Android.
- Componente Java `MainActivity` que intercepta eventos HID antes de la WebView, solo cuando la pantalla Caja está activa y ningún campo editable tiene el foco.
- Búfer con fin de escaneo Enter, separación máxima de 100 ms entre caracteres, longitud mínima de cuatro caracteres y límite de 128 caracteres.
- El lector se desactiva al enfocar campos editables y vuelve a activarse al salir de ellos.
- `ScannerBridge.getStatus()` comprueba si Android informa un dispositivo físico de entrada tipo teclado.
- SQLite local para catálogo, ventas y líneas. Los códigos se guardan como texto, por lo que se conservan los ceros iniciales.

## Aceptación

La prueba descrita en la especificación es escanear tres productos reales sin que aparezca el teclado y verificar el total. El catálogo de demostración incluido suma $6.00 USD (1 + 2 + 3). Las etiquetas están en `examples/etiquetas_prueba_ean13.svg`; los pasos detallados están en la sección “Entrega de Fase 1” del README.

## Validación realizada en este entorno

- 4 pruebas del búfer de códigos: superadas.
- 3 pruebas del total/subtotal del carrito: superadas.
- 3 pruebas del importador Python existentes: superadas.
- Catálogo de demostración ZIP y SHA-256: verificados.
- Coincidencia entre los tres códigos del catálogo y las etiquetas EAN-13: verificada.
- Sintaxis JavaScript: validada con `node --check`.
- Compilación Vite/Gradle: no ejecutada porque este entorno no pudo acceder a `registry.npmjs.org` para descargar dependencias.
- Prueba en Redmi 14C y Netum L3: pendiente de hardware físico.

No se declara el APK compilado ni el lector físicamente probado.
