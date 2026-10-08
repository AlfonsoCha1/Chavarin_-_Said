# Resultados de pruebas

- Fecha de ejecución: 2026-10-08T17:27:02.549Z (UTC)
- Node.js v22.22.0 · psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
- Comando: `npm test` (equivalente a `node --import tsx --test --test-concurrency=1 tests/*.test.ts`)
- Código de salida: **0** (todas pasaron)

Estas pruebas usan una base PostgreSQL real (`TEST_DATABASE_URL`) que se borra y recarga con datos ficticios, el servidor real (incluido un proceso aparte que se mata y reinicia) y un navegador Chromium real.

## Resumen

```
ℹ tests 33
ℹ suites 23
ℹ pass 33
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 25255.9896
```

## Verificaciones pedidas en el brief

| Verificación | Prueba |
|---|---|
| Categorías y búsqueda | T01 (API) y "directorio: categorías desplegables con teclado…" (navegador) |
| QR que abre la sucursal correcta | T02 (decodifica el QR impreso en el navegador y sigue la URL) |
| Persistencia tras reiniciar | T03 (mata el servidor con SIGKILL y lo vuelve a arrancar) |
| Separación entre empresas | T04 |
| Compra y canje normales | T05 |
| Saldo insuficiente | T06 |
| Compra duplicada | T07 (incluye 6 envíos simultáneos) |
| Canjes concurrentes | T08 (10 simultáneos desde dos cuentas → 1) |
| Ajustes auditados | T09 (incluye intento de UPDATE/DELETE del historial) |
| Revocación de empleados | T10 |
| Fallo de actualización de Wallet sin pérdida de compra | T11 (falla simulada del adaptador) |

Qué **no** cubren: cámara real del celular, proveedores reales de mensajes o Wallet (no existen aún), carga alta, despliegue en Render y auditoría de seguridad externa.

## Salida completa

```
▶ T02 QR que abre la sucursal correcta
  ✔ el QR impreso de cada sucursal lleva a SU registro y el registro crea la tarjeta con 0 puntos (3500.060435ms)
✔ T02 QR que abre la sucursal correcta (5636.844456ms)
▶ Flujos de pantalla
  ✔ directorio: categorías desplegables con teclado y búsqueda por dirección (1204.067409ms)
  ✔ mostrador: el empleado identifica la tarjeta, confirma compra y el ticket repetido se rechaza (1018.342391ms)
✔ Flujos de pantalla (2222.844116ms)
▶ T01 categorías y búsqueda
  ✔ árbol de categorías, búsqueda sin acentos, filtro y solo negocios aprobados (600.984694ms)
  ✔ una categoría nueva aparece sin tocar código y la aprobación publica al negocio (124.311865ms)
✔ T01 categorías y búsqueda (1339.802584ms)
▶ T04 separación entre empresas
  ✔ un empleado no ve ni opera tarjetas, compras ni sucursales de otro negocio (695.779859ms)
  ✔ la base de datos impide unir una sucursal a un programa de otra empresa (5.771042ms)
✔ T04 separación entre empresas (701.94566ms)
▶ T05 compra y canje normales · T17 identificar no suma · T30 estado de operación
  ✔ compra +10, canje −50, entrega y estados consultables (616.262456ms)
✔ T05 compra y canje normales · T17 identificar no suma · T30 estado de operación (616.758658ms)
▶ T06 saldo insuficiente
  ✔ rechaza sin descontar nada (528.209767ms)
✔ T06 saldo insuficiente (528.618894ms)
▶ T07 compra duplicada
  ✔ mismo ticket con otra clave no suma; envíos simultáneos solo registran una vez (590.132342ms)
✔ T07 compra duplicada (590.43315ms)
▶ T08 canjes concurrentes
  ✔ 10 canjes simultáneos desde dos empleados sobre 50 puntos: solo uno se confirma (580.596867ms)
  ✔ con 100 puntos y premio de 30, exactamente 3 de 8 canjes simultáneos pasan (132.753034ms)
✔ T08 canjes concurrentes (713.664323ms)
▶ T09 ajustes auditados
  ✔ solo encargado o dueño ajustan, con motivo; el historial original no se modifica (634.401359ms)
  ✔ entrega disputada: reponer puntos con registro y sin crear otro canje (180.161776ms)
✔ T09 ajustes auditados (814.915504ms)
▶ T10 revocación de empleados
  ✔ al revocar, la sesión abierta deja de funcionar y no puede volver a entrar; su historial se conserva (590.761943ms)
✔ T10 revocación de empleados (591.007943ms)
▶ T11 fallo de Wallet sin pérdida de compra
  ✔ la compra se guarda aunque Wallet falle; el reintento copia el saldo sin sumar otra vez (508.944883ms)
✔ T11 fallo de Wallet sin pérdida de compra (509.156237ms)
▶ T12 premio agotado
  ✔ no descuenta puntos si no hay existencias; con existencias las reduce (424.087886ms)
✔ T12 premio agotado (424.378333ms)
▶ T13 devolución
  ✔ revierte puntos; si ya se gastaron, revierte lo posible y abre un caso (546.062103ms)
✔ T13 devolución (546.300505ms)
▶ T15 contingencia sin internet
  ✔ comprobantes capturados después se aplican una sola vez y detectan tickets ya registrados (573.554718ms)
✔ T15 contingencia sin internet (573.793824ms)
▶ T16 registro con código · T29 publicidad separada
  ✔ QR del mostrador → registro verificado con 0 puntos; repetir no crea otra tarjeta (512.132408ms)
  ✔ un QR de sucursal inexistente o no aprobada no permite registrarse (2.914434ms)
✔ T16 registro con código · T29 publicidad separada (515.265508ms)
▶ T18 otra sucursal
  ✔ programa común sí; programas separados no (518.358732ms)
✔ T18 otra sucursal (518.59215ms)
▶ T19 límite diario
  ✔ después del máximo de compras del día por tarjeta, rechaza (482.1124ms)
✔ T19 límite diario (482.307019ms)
▶ T20 cambio de reglas
  ✔ nueva versión aplica a compras nuevas, no recalcula saldos; subir costo de premio se programa (588.857059ms)
✔ T20 cambio de reglas (589.041021ms)
▶ T21 vencimiento
  ✔ vence el saldo tras los días configurados sin compras y deja registro (429.819469ms)
✔ T21 vencimiento (429.995016ms)
▶ T22 fusión · T23 reposición · T24 verificación al canjear
  ✔ une dos tarjetas con verificación del titular y sin sumar dos veces (483.356771ms)
  ✔ repone una tarjeta perdida solo con código al titular; la anterior deja de funcionar (76.784243ms)
  ✔ programa con verificación: sin el código del titular no hay canje (104.295659ms)
✔ T22 fusión · T23 reposición · T24 verificación al canjear (664.761318ms)
▶ T26 negocio suspendido · T27 protección de origen · T28 bloqueo de acceso
  ✔ suspender bloquea operaciones nuevas, conserva saldos y retira del directorio (505.694223ms)
  ✔ rechaza peticiones que no son JSON o vienen de otro sitio (51.789529ms)
  ✔ bloquea temporalmente tras 5 contraseñas incorrectas (261.452653ms)
✔ T26 negocio suspendido · T27 protección de origen · T28 bloqueo de acceso (819.256143ms)
▶ T31 tarjeta de sellos en Cuernavaca (Tapioca Colibrí)
  ✔ la caja suma un sello; el premio de 9 sellos no se canjea antes de tiempo (536.476038ms)
✔ T31 tarjeta de sellos en Cuernavaca (Tapioca Colibrí) (536.735723ms)
▶ T03 persistencia tras reiniciar
  ✔ una compra confirmada sigue ahí después de matar y volver a arrancar el servidor (1936.238205ms)
✔ T03 persistencia tras reiniciar (2958.264574ms)
ℹ tests 33
ℹ suites 23
ℹ pass 33
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 25255.9896
```
