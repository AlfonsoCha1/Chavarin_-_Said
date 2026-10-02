# Arquitectura, consumo, costos y mantenimiento

## Arquitectura elegida

```
Celular / computadora (HTML + JavaScript del navegador, sin framework)
        │  HTTPS, cookies de sesión
        ▼
Servidor Node.js 22 + TypeScript (Fastify)
  ├─ Rutas públicas: directorio, sucursal, registro por QR
  ├─ Cliente: Mis tarjetas, recuperación, privacidad
  ├─ Empleado: compras, canjes, contingencia, turno
  ├─ Dueño/encargado: correcciones, empleados, programa, métricas
  ├─ Administración: negocios, categorías, pagos, incidentes, integraciones
  └─ Adaptadores: mensajería (simulado) · Wallet (simulado, con cola)
        │  SQL con transacciones
        ▼
PostgreSQL 16 (fuente única de verdad: saldos, historial, bitácora)
```

**Por qué así**

- **Un solo servidor y una sola base**: es lo más fácil de operar entre dos personas. No hay microservicios, colas externas ni caché que mantener.
- **TypeScript**: el mismo lenguaje en servidor y navegador; el compilador detecta errores antes de publicar. Para quien viene de Java, los tipos se sienten familiares.
- **PostgreSQL**: transacciones reales, bloqueos por fila y restricciones (saldo no negativo, ticket único, historial que no se puede editar). Esas garantías son las que evitan dobles canjes y compras duplicadas; no dependen de que el código "se acuerde".
- **HTML simple**: páginas ligeras que cargan rápido en celulares modestos, sin paso de compilación del lado del cliente.
- **Sin IA en la operación**: el producto no depende de ningún modelo de IA para funcionar. Claude se usó solo para desarrollarlo.

**Dónde vive cada regla crítica**

| Regla | Dónde se hace cumplir |
|---|---|
| Saldo nunca negativo | `CHECK (balance >= 0)` en `cards` |
| Ticket no se repite | índice único `(branch_id, lower(ticket_ref))` |
| Operación no se repite | `idempotency_key UNIQUE` en compras y canjes |
| Dos canjes no gastan el mismo saldo | `SELECT … FOR UPDATE` sobre la tarjeta dentro de la transacción |
| Historial intocable | disparadores que impiden `UPDATE`/`DELETE` en `ledger_entries` y `audit_log` |
| Sin mezclar empresas | consultas filtradas por empresa en el servidor + disparador en `program_branches` |
| Revocación inmediata | la membresía se revisa en cada petición |

## Consumo estimado

Para un piloto de 5 a 10 negocios con unos cientos de clientes:

- **Servidor**: cada operación es una o dos consultas SQL pequeñas. Un proceso Node con 512 MB de RAM es suficiente. No se midió con pruebas de carga.
- **Base de datos**: cada compra genera ~3 filas (compra, movimiento, bitácora). 10,000 compras ocupan del orden de pocos megabytes. 1 GB alcanza para mucho más que un piloto.
- **Navegador**: páginas de decenas de KB; la librería del lector de QR (≈250 KB) solo se carga en el panel del empleado.

## Costos (precios consultados en las páginas oficiales el 1 de octubre de 2026; pueden cambiar)

| Concepto | Demo (gratis) | Piloto recomendado |
|---|---|---|
| Render servicio web | Free: se duerme tras 15 min sin tráfico, ~1 min en despertar, 750 h/mes **compartidas** por todos los servicios gratis del espacio de trabajo (despierto de 8:00 a 22:00 ≈ 434 h) | Starter: 7 USD/mes, 512 MB, no se duerme |
| Render PostgreSQL | Free: 1 GB, **se borra a los 30 días** (+14 de gracia), **sin respaldos** | Desde 6 USD/mes (256 MB RAM) + 0.30 USD por GB; incluye respaldo lógico y recuperación a un punto en el tiempo (3 días en el plan Hobby) |
| Render espacio de trabajo | Hobby: 0 USD | Hobby: 0 USD (Pro: 25 USD/mes si se necesitan más miembros/funciones) |
| GitHub Actions (repo privado) | Incluido en GitHub Free (cuota mensual de minutos); despertador ≈ 870 min/mes | No necesario si el servicio es de pago |
| Mensajes SMS / WhatsApp / correo | Simulado: 0 | **Por cotizar.** Costo por mensaje según proveedor y país; WhatsApp requiere plantillas aprobadas |
| Google Wallet API | — | La documentación revisada no menciona tarifas; requiere cuenta de emisor y aprobación |
| Apple Wallet | — | Requiere Apple Developer Program (cuota anual; verificar precio vigente en la página de Apple) |
| Dominio propio | Opcional | ~1 dominio .mx o .com al año (por cotizar) |

**Total técnico mínimo del piloto**: ≈ 13 USD/mes (Render Starter + Postgres básico), más mensajes. Esto no incluye el tiempo de soporte de ustedes, que en la práctica es el costo mayor.

Fuentes: [Render — Deploy for Free](https://render.com/docs/free), [Render — Pricing](https://render.com/pricing).

## Mantenimiento

| Tarea | Frecuencia | Responsable |
|---|---|---|
| Revisar incidentes y solicitudes de soporte | Diario en horario publicado | Por asignar (Chavarín / Said) |
| Registrar pagos y revisar mensualidades vencidas | Semanal | Por asignar |
| Aprobar negocios nuevos y ordenar categorías | Al llegar solicitudes | Por asignar |
| Ejecutar vencimiento de puntos (hasta automatizarlo) | Semanal | Por asignar |
| Actualizar dependencias (`npm outdated`, `npm audit`) | Mensual | Por asignar |
| Ensayar restauración de respaldo | Antes del piloto y luego trimestral | Por asignar |
| Revisar alertas de abuso con cada negocio | Semanal durante el piloto | Por asignar |

## Cambios en la base de datos

Las migraciones son archivos SQL numerados en `migrations/`. Se aplican solas al arrancar (`npm start`) o con `npm run db:migrate`. **Nunca se edita una migración ya aplicada**: se agrega una nueva (`002_….sql`).
