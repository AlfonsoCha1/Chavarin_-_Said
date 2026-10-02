# Despliegue en Render (demo en internet)

## Antes de empezar: lo que hay que saber

Según la documentación oficial de Render (consultada el 1 de octubre de 2026):

- El servicio web **gratis se duerme tras 15 minutos sin visitas** y tarda **alrededor de 1 minuto** en despertar.
- Render da **750 horas gratis al mes por espacio de trabajo**. Un servicio despierto todo el mes usa casi todas: **solo alcanza para un servicio gratis siempre despierto**.
- La **PostgreSQL gratis se borra 30 días después de crearse** (hay 14 días de gracia para pasarla a pago) y **no tiene respaldos**.
- Render indica no usar el plan gratis para aplicaciones de producción.

Por eso: **gratis para la demo de ventas; de pago para el piloto con negocios reales.** El "despertador" no da seguridad: la protección real está en el código (permisos, separación de negocios, validaciones). Render aporta HTTPS y guarda las variables secretas fuera del código.

## El despertador (dos capas)

1. **Interno**: con `KEEPALIVE_ENABLED=true`, el servidor visita su propio `/api/health` cada 10 minutos (usa la variable `RENDER_EXTERNAL_URL` que Render define sola), **solo dentro de `KEEPALIVE_HOURS`** (por defecto `8-22`, hora CDMX). Fuera de ese horario se deja dormir.
2. **Externo de respaldo**: `.github/workflows/keepalive.yml` visita `/api/health` cada 30 minutos de 8:00 a 22:00 (hora CDMX). Si el servicio se durmió (por ejemplo, durante la noche o tras un reinicio de Render), lo despierta. Consume ≈ 870 minutos de GitHub Actions al mes en un repositorio privado.

**Por qué no las 24 horas**: tu espacio de trabajo de Render ya tiene otros servicios gratis (sophya-backend y Smuckys_By_Chavamon) y las 750 horas gratis se comparten. Despierto 24 h este servicio gastaría ≈ 744 h y, al agotarse las horas, Render suspende **todos** los servicios gratis hasta el mes siguiente. De 8:00 a 22:00 son ≈ 434 h al mes. Fuera de horario, la primera visita tarda ~1 minuto.

Con plan de pago (Starter) ninguna de las dos capas hace falta: se pone `KEEPALIVE_ENABLED=false` y se desactiva el flujo de GitHub.

## Pasos

> Estado actual (1 oct 2026): servicio `chavarin-said-lealtad` (free, Ohio) y base `chavarin-said-db` (free, vence el 31 oct 2026) creados en el espacio de trabajo de Render. Se crearon con la herramienta de Render, no con el Blueprint; `DATABASE_URL` se pega a mano desde la base.

1. **GitHub**: crear el repositorio privado vacío `chavarin-said-lealtad` y subir el código (rama `main`).
2. **Render**: entrar con la cuenta de GitHub y dar permiso a Render sobre ese repositorio.
3. Render → **New → Blueprint** → elegir el repositorio. Render lee `render.yaml` y crea:
   - el servicio web `chavarin-said-lealtad` (Node, plan free, región Ohio),
   - la base `chavarin-said-db` (PostgreSQL, plan free).
4. Esperar el primer despliegue. Al arrancar, el servidor aplica las migraciones y, si la base está vacía, carga los negocios ficticios (`SEED_DEMO_ON_EMPTY=true`).
5. Abrir `https://<servicio>.onrender.com/api/health` → debe responder `{"ok":true,"db":true,...}`.
6. El despertador de GitHub ya apunta a `https://chavarin-said-lealtad.onrender.com/api/health`. Si cambia el nombre del servicio, crear la variable `RENDER_HEALTH_URL` en GitHub → Settings → Secrets and variables → Actions → Variables.
7. Probar el recorrido completo desde un celular (el lector de QR con cámara solo funciona en HTTPS, que Render ya da).

## Variables de entorno (ninguna es secreta en la demo)

| Variable | Valor demo | Nota |
|---|---|---|
| `DATABASE_URL` | la pone Render desde la base | Es secreta: nunca copiarla al repositorio |
| `DATABASE_SSL` | `false` | Conexión interna de Render |
| `DEMO_MODE` | `true` | Muestra aviso, cuentas demo, buzón simulado y reinicio |
| `SEED_DEMO_ON_EMPTY` | `true` | Carga datos ficticios si la base está vacía |
| `KEEPALIVE_ENABLED` | `true` | Despertador interno |
| `KEEPALIVE_HOURS` | `8-22` | Horario (CDMX) en que se mantiene despierto |
| `PUBLIC_BASE_URL` | (vacío) | Si se usa dominio propio, poner aquí `https://dominio` para que los QR apunten a él |
| `MESSAGING_PROVIDER`, `WALLET_PROVIDER` | `simulated` | Únicos adaptadores existentes |

## Advertencias de la demo pública

- Las cuentas demo y su contraseña están publicadas en la pantalla de entrada: **cualquiera puede modificar los datos**. Antes de una visita, entrar como administración y usar **"Reiniciar demostración"**.
- El buzón simulado muestra los códigos de verificación: **no capturar datos reales** en la demo.

## Para el piloto (cambios obligatorios)

1. En `render.yaml`: `plan: starter` en el servicio y un plan de pago en la base. Volver a sincronizar el Blueprint.
2. `DEMO_MODE=false`, `SEED_DEMO_ON_EMPTY=false`, `KEEPALIVE_ENABLED=false`.
3. Crear la cuenta de administración real directamente en la base (no usar las cuentas demo).
4. Contratar proveedor de mensajes e implementar su adaptador (hoy solo existe el simulado; con `DEMO_MODE=false` y mensajes simulados **nadie recibiría su código**).
5. Ensayar una restauración de respaldo.
6. Configurar monitoreo externo con alertas y un responsable de guardia.

Hasta completar esos puntos **no está listo para negocios reales**.
