# Chavarín & Said — plataforma de lealtad para pequeños negocios

Nombre provisional. Tarjetas de puntos o sellos para comida, tiendas y servicios: directorio con categorías, registro por QR de mostrador, tarjeta web e impresa, paneles de cliente, empleado, dueño y administración.

> **Estado: demostración funcional y base para pilotos. NO está lista para negocios reales** hasta contratar el envío real de mensajes, pasar a una base con respaldos y ensayar la restauración, configurar monitoreo y revisar el aviso de privacidad con un abogado. Ver [`docs/FUNCIONES.md`](docs/FUNCIONES.md).

## Arranque local (5 minutos)

Requisitos: **Node.js 22+** y **PostgreSQL 16** (lo más fácil: Docker Desktop).

```bash
cp .env.example .env          # variables de ejemplo, sin secretos
docker compose up -d          # PostgreSQL en localhost:5432 (crea también la base de pruebas)
npm install
npm run db:migrate            # crea las tablas
npm run db:seed               # carga negocios y personas FICTICIOS
npm run dev                   # http://localhost:3000
```

En Windows usa la terminal de WSL (Ubuntu) con Docker Desktop. Para probar en el celular dentro de la misma red Wi-Fi abre `http://<IP-de-tu-laptop>:3000`; la cámara del lector de QR solo funciona en `https` o `localhost`, así que en esa modalidad se escribe el número de tarjeta.

### Cuentas de demostración

Contraseña de todas: `demo-12345` (también aparecen como botones en `/entrar`).

| Rol | Correo |
|---|---|
| Empleado, Tacos del Centro — Sucursal Centro | `empleado.centro@example.com` |
| Empleada, Tacos del Centro — Sucursal Norte | `empleado.norte@example.com` |
| Encargada, Tacos del Centro | `encargada.tacos@example.com` |
| Dueño, Tacos del Centro | `dueno.tacos@example.com` |
| Empleado, Café Aurora (pide código al canjear) | `barista.cafe@example.com` |
| Dueño, Música Allegro | `dueno.allegro@example.com` |
| Administración de la plataforma | `admin@example.com` |

Clientes de prueba: entra a `/mis-tarjetas` con `ana.martinez@example.com` (correo) y lee el código en `/buzon-demo`. Tarjetas útiles: `C-104` (30 puntos), `C-105` (50), `C-106` (impresa, sin titular), `C-AUR01` (Café Aurora), `C-ALG01` (Música Allegro).

### Recorrido sugerido

1. `/directorio` → abrir *Comida y bebidas › Comida rápida* → buscar "domingo".
2. `/imprimir/qr/tacos-del-centro-centro` → escanear con el celular → registro de esa sucursal.
3. `/entrar` como empleado → tarjeta `C-104` → compra con ticket `T-208` → repetir ticket (se rechaza).
4. `/entrar` como dueño → Resumen, Tarjetas y ajustes, Empleados (revocar).
5. `/entrar` como administración → Categorías (agregar una), Integraciones (simular falla de Wallet).
6. `/situaciones` → qué pasa cuando algo sale mal.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática |
| `npm run build` / `npm start` | Compila a `dist/` / aplica migraciones y arranca (producción) |
| `npm run db:migrate` | Aplica migraciones pendientes |
| `npm run db:seed` | Carga datos ficticios si la base está vacía |
| `npm run db:reset` | **Borra todo** y recarga los datos ficticios |
| `npm run typecheck` | Verificación de tipos |
| `npm test` | Todas las pruebas (usa `TEST_DATABASE_URL`, que se borra en cada corrida) |
| `npm run screens` | Regenera las maquetas (capturas) en `docs/maquetas/` |
| `npm run docs` | Regenera `docs/SITUACIONES.md` y los PDF |

Las pruebas de navegador necesitan Chromium: `npx playwright install chromium` (o define `CHROMIUM_PATH`).

## Estructura

```
migrations/        SQL numerado (nunca editar uno ya aplicado)
src/
  server.ts        Fastify: seguridad, rutas, páginas
  routes/          public · customer · staff · owner · admin
  services/        loyalty (compras, canjes, correcciones) · otp · wallet
  lib/             auth (sesiones) · security · audit · messaging · mask
  seed.ts          datos ficticios
public/            HTML + CSS + JS del navegador (sin framework)
  data/situaciones.json   fuente del centro de situaciones
tests/             pruebas con base real y navegador real
docs/              reglas, situaciones, funciones, pruebas, guion, Wallet, Render, privacidad
render.yaml        Blueprint de Render (demo gratis)
.github/workflows  pruebas en cada PR y despertador para Render gratis
```

## Documentos

- [Reglas operativas](docs/REGLAS_OPERATIVAS.md) (también en PDF)
- [Situaciones y soluciones](docs/SITUACIONES.md) (también en PDF y en `/situaciones`)
- [Funciones implementadas, simuladas y pendientes](docs/FUNCIONES.md)
- [Resultados de pruebas](docs/RESULTADOS_PRUEBAS.md)
- [Guion de presentación y capacitación](docs/GUION_PRESENTACION.md)
- [Arquitectura, consumo y costos](docs/ARQUITECTURA_COSTOS.md)
- [Google Wallet y Apple Wallet](docs/WALLET.md)
- [Despliegue en Render](docs/DESPLIEGUE_RENDER.md)
- [Privacidad: propuesta y procedimiento](docs/PRIVACIDAD.md)
- [Maquetas](docs/maquetas/)

## Trabajo entre socios

- Repositorio compartido en GitHub; `main` siempre funciona.
- Una rama por cambio: `tipo/descripcion-corta` (por ejemplo `feat/exportar-datos`, `fix/ticket-mayusculas`).
- Pull Request con la plantilla; **lo revisa y aprueba el otro socio** antes de integrar. Las pruebas corren solas en cada PR.
- Cada tarea tiene responsable (Chavarín o Said) en el PR o en el tablero.
- Este repositorio no define porcentajes de sociedad ni acuerdos económicos.

La operación del producto **no depende de IA**. Claude se usó como apoyo para desarrollarlo; ver [`CLAUDE.md`](CLAUDE.md).
