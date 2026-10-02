# Resultados de pruebas

- Fecha de ejecución: 2026-10-01T20:28:09.076Z (UTC)
- Node.js v22.22.0 · psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
- Comando: `npm test` (equivalente a `node --import tsx --test --test-concurrency=1 tests/*.test.ts`)
- Código de salida: **0** (todas pasaron)

Estas pruebas usan una base PostgreSQL real (`TEST_DATABASE_URL`) que se borra y recarga con datos ficticios, el servidor real (incluido un proceso aparte que se mata y reinicia) y un navegador Chromium real.

## Resumen

```
ℹ tests 32
ℹ suites 22
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 22510.393143
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
  ✔ el QR impreso de cada sucursal lleva a SU registro y el registro crea la tarjeta con 0 puntos (3840.230239ms)
✔ T02 QR que abre la sucursal correcta (7322.364444ms)
▶ Flujos de pantalla
  ✔ directorio: categorías desplegables con teclado y búsqueda por dirección (1074.572368ms)
  ✔ mostrador: el empleado identifica la tarjeta, confirma compra y el ticket repetido se rechaza (1000.376745ms)
✔ Flujos de pantalla (2075.373715ms)
▶ T01 categorías y búsqueda
  ✔ árbol de categorías, búsqueda sin acentos, filtro y solo negocios aprobados (415.750238ms)
  ✔ una categoría nueva aparece sin tocar código y la aprobación publica al negocio (98.689347ms)
✔ T01 categorías y búsqueda (963.248321ms)
▶ T04 separación entre empresas
  ✔ un empleado no ve ni opera tarjetas, compras ni sucursales de otro negocio (494.589298ms)
  ✔ la base de datos impide unir una sucursal a un programa de otra empresa (3.716414ms)
✔ T04 separación entre empresas (498.652523ms)
▶ T05 compra y canje normales · T17 identificar no suma · T30 estado de operación
  ✔ compra +10, canje −50, entrega y estados consultables (514.034435ms)
✔ T05 compra y canje normales · T17 identificar no suma · T30 estado de operación (514.473297ms)
▶ T06 saldo insuficiente
  ✔ rechaza sin descontar nada (305.027017ms)
✔ T06 saldo insuficiente (305.335712ms)
▶ T07 compra duplicada
  ✔ mismo ticket con otra clave no suma; envíos simultáneos solo registran una vez (586.088044ms)
✔ T07 compra duplicada (586.285947ms)
▶ T08 canjes concurrentes
  ✔ 10 canjes simultáneos desde dos empleados sobre 50 puntos: solo uno se confirma (422.483735ms)
  ✔ con 100 puntos y premio de 30, exactamente 3 de 8 canjes simultáneos pasan (96.413095ms)
✔ T08 canjes concurrentes (519.15747ms)
▶ T09 ajustes auditados
  ✔ solo encargado o dueño ajustan, con motivo; el historial original no se modifica (424.608869ms)
  ✔ entrega disputada: reponer puntos con registro y sin crear otro canje (141.73745ms)
✔ T09 ajustes auditados (566.58031ms)
▶ T10 revocación de empleados
  ✔ al revocar, la sesión abierta deja de funcionar y no puede volver a entrar; su historial se conserva (463.30965ms)
✔ T10 revocación de empleados (463.514504ms)
▶ T11 fallo de Wallet sin pérdida de compra
  ✔ la compra se guarda aunque Wallet falle; el reintento copia el saldo sin sumar otra vez (346.416536ms)
✔ T11 fallo de Wallet sin pérdida de compra (346.670891ms)
▶ T12 premio agotado
  ✔ no descuenta puntos si no hay existencias; con existencias las reduce (331.019778ms)
✔ T12 premio agotado (331.206634ms)
▶ T13 devolución
  ✔ revierte puntos; si ya se gastaron, revierte lo posible y abre un caso (348.612625ms)
✔ T13 devolución (348.75405ms)
▶ T15 contingencia sin internet
  ✔ comprobantes capturados después se aplican una sola vez y detectan tickets ya registrados (372.388825ms)
✔ T15 contingencia sin internet (372.538984ms)
▶ T16 registro con código · T29 publicidad separada
  ✔ QR del mostrador → registro verificado con 0 puntos; repetir no crea otra tarjeta (309.296512ms)
  ✔ un QR de sucursal inexistente o no aprobada no permite registrarse (2.209855ms)
✔ T16 registro con código · T29 publicidad separada (311.680387ms)
▶ T18 otra sucursal
  ✔ programa común sí; programas separados no (354.292648ms)
✔ T18 otra sucursal (354.43696ms)
▶ T19 límite diario
  ✔ después del máximo de compras del día por tarjeta, rechaza (316.54749ms)
✔ T19 límite diario (316.761844ms)
▶ T20 cambio de reglas
  ✔ nueva versión aplica a compras nuevas, no recalcula saldos; subir costo de premio se programa (417.316322ms)
✔ T20 cambio de reglas (417.484607ms)
▶ T21 vencimiento
  ✔ vence el saldo tras los días configurados sin compras y deja registro (311.658839ms)
✔ T21 vencimiento (311.845392ms)
▶ T22 fusión · T23 reposición · T24 verificación al canjear
  ✔ une dos tarjetas con verificación del titular y sin sumar dos veces (380.940578ms)
  ✔ repone una tarjeta perdida solo con código al titular; la anterior deja de funcionar (66.625776ms)
  ✔ programa con verificación: sin el código del titular no hay canje (89.602948ms)
✔ T22 fusión · T23 reposición · T24 verificación al canjear (537.436709ms)
▶ T26 negocio suspendido · T27 protección de origen · T28 bloqueo de acceso
  ✔ suspender bloquea operaciones nuevas, conserva saldos y retira del directorio (336.213259ms)
  ✔ rechaza peticiones que no son JSON o vienen de otro sitio (47.468259ms)
  ✔ bloquea temporalmente tras 5 contraseñas incorrectas (222.099412ms)
✔ T26 negocio suspendido · T27 protección de origen · T28 bloqueo de acceso (606.03031ms)
▶ T03 persistencia tras reiniciar
  ✔ una compra confirmada sigue ahí después de matar y volver a arrancar el servidor (1874.419609ms)
✔ T03 persistencia tras reiniciar (2634.814272ms)
ℹ tests 32
ℹ suites 22
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22510.393143
```
