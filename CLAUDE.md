# CLAUDE.md — guía para trabajar en este repositorio

Plataforma de lealtad multi-negocio (nombre provisional "Chavarín & Said"). Interfaz en **español de México**, clara y sin tecnicismos. Socios: Chavarín y Said; ambos programan y venden.

## Arquitectura

- Node 22 + TypeScript (ESM, `NodeNext`) + **Fastify 5**. Validación con **zod**. Base **PostgreSQL 16** con `pg`.
- Navegador: HTML + CSS + JS de módulos en `public/`, sin framework ni compilación. Utilidades comunes en `public/js/app.js`.
- Lógica de negocio en `src/services/loyalty.ts`. Las rutas solo validan entrada, autentican y llaman servicios.
- Sesiones en la tabla `sessions` (token aleatorio, se guarda solo su hash). Cookies `cs_staff` y `cs_cliente`.
- Adaptadores: `src/lib/messaging.ts` y `src/services/wallet.ts`. **Solo existen los simulados.**

## Comandos

```bash
docker compose up -d && npm install
npm run db:migrate && npm run db:seed && npm run dev   # http://localhost:3000
npm run typecheck
npm test            # base TEST_DATABASE_URL (se borra) + Chromium para pruebas de navegador
npm run screens     # maquetas
npm run docs        # SITUACIONES.md y PDF
```

## Invariantes (no romper nunca)

1. **El saldo vive en el servidor.** Wallet, papel y pantalla solo lo muestran.
2. **Solo una compra confirmada por personal suma puntos.** Leer o escanear una tarjeta nunca escribe.
3. **Toda operación que cambia saldo** va en `tx()`, bloquea la tarjeta con `FOR UPDATE`, escribe en `ledger_entries` con `balance_after`, actualiza `cards.balance`, encola Wallet y escribe en `audit_log`.
4. **Idempotencia**: compras y canjes requieren `idempotencyKey`; el mismo ticket no se repite por sucursal. Ante resultado incierto se consulta `/api/staff/operations/:key`, nunca se genera otra clave.
5. **Historial inmutable**: `ledger_entries` y `audit_log` no admiten UPDATE/DELETE (disparadores). Las correcciones son movimientos nuevos con motivo.
6. **Aislamiento por empresa** en cada consulta del servidor (`company_id` del contexto de sesión). Un recurso de otra empresa responde 404 sin revelar datos.
7. **Permisos** con `requireStaff(req, { roles, operate })`. `operate: true` para todo lo que registra compras o canjes (bloquea negocios no aprobados o suspendidos).
8. **Wallet nunca suma**: la cola copia el saldo vigente.
9. **Nada de secretos** en código, repositorio, registros ni respuestas. Variables en `.env` (excluido de git) o en el proveedor.
10. **Simulaciones etiquetadas**: todo botón o pantalla que no haga la acción real usa la clase `.sim`/`.btn-sim` o `tag-sim` y dice "simulación".
11. **Datos personales mínimos**; el personal ve contactos enmascarados; administración no ve contactos.
12. **Fechas**: guardar en UTC (`timestamptz`); mostrar y calcular "día" en `America/Mexico_City`.

## Permisos por rol

`employee` opera (compras, canjes, entrega, contingencia, tarjeta impresa) en su sucursal si tiene `branch_id`. `manager` además corrige (ajustes, devoluciones, disputas, fusiones, reposiciones, contingencia) y da de alta/baja empleados. `owner` además cambia reglas, premios, sucursales, perfil y encargados. `is_platform_admin` administra negocios, categorías, pagos, incidentes e integraciones, sin ver contactos de clientes.

## Cambios en la base

Nuevo archivo `migrations/00N_descripcion.sql`. No editar migraciones aplicadas. Si agregas tablas que deban vaciarse en `db:reset`, `resetAndSeed` ya trunca todas las tablas públicas.

## Criterios de terminado

Un cambio está terminado cuando:

- [ ] `npm run typecheck` y `npm test` pasan; las pruebas nuevas cubren el caso feliz y al menos un error.
- [ ] Si toca saldos: prueba de concurrencia o idempotencia correspondiente.
- [ ] La pantalla tiene estados de carga, vacío, error y éxito, y funciona en celular (360 px) y computadora, con teclado.
- [ ] Los textos son en español claro; los errores dicen qué pasó y qué hacer.
- [ ] Se actualizaron `docs/FUNCIONES.md` y, si aplica, `scripts/situaciones-src.py` (luego `python3 scripts/situaciones-src.py && npm run docs`).
- [ ] No se afirma en documentos ni pantallas nada que no esté verificado.
- [ ] Revisión y aprobación del otro socio en el PR.

## Lo que no se hace

- No prometer más ventas, usuarios ilimitados ni funciones futuras como existentes.
- No inventar porcentajes de sociedad ni acuerdos económicos.
- No usar marcas reales como si fueran clientes; la demo usa negocios ficticios.
- No hacer que la operación dependa de IA.
