# Funciones: implementadas, simuladas y pendientes

Estado al 1 de octubre de 2026. "Probado" significa que hay una prueba automática que pasó en `npm test` (ver `RESULTADOS_PRUEBAS.md`).

## Implementado

| Área | Función | Verificación |
|---|---|---|
| Directorio | Categorías y subcategorías en base de datos, desplegables con clic, teclado y mouse | Probado (T01, navegador) |
| Directorio | Agregar, renombrar, ordenar y desactivar categorías desde Administración, sin código | Probado (T01) |
| Directorio | Búsqueda por nombre, sucursal, calle, colonia y ciudad, sin acentos | Probado (T01, navegador) |
| Directorio | Solo negocios aprobados; resultados con negocio, categoría, sucursal, dirección y "Ver negocio" | Probado (T01) |
| Negocios | Empresa → sucursales → programa; varias sucursales con sus direcciones | Probado (T18) |
| Negocios | Programa común entre sucursales o programas separados; nunca entre empresas | Probado (T04, T18) |
| Negocios | Solicitud de alta del negocio (dueño, sucursal, categoría, programa, premio, plan), queda pendiente | Revisión manual en navegador |
| Negocios | Aprobación, rechazo y suspensión por Administración | Probado (T01, T26) |
| Cliente | QR de mostrador que abre el registro de su sucursal | Probado (T02, decodificando el QR en navegador) |
| Cliente | Registro con código, tarjeta con 0 puntos, sin duplicar tarjeta | Probado (T16) |
| Cliente | Tarjeta web con QR + número; "Mis tarjetas" con saldo, movimientos, premios, reglas, vencimiento | Revisión manual |
| Cliente | Recuperación de acceso con código al contacto (SMS, WhatsApp o correo) | Probado (T11 usa el acceso por código) |
| Cliente | Permiso de publicidad por negocio, separado de la tarjeta | Probado (T29) |
| Cliente | Solicitudes de datos con folio | Revisión manual |
| Empleado | Cuenta individual, sucursal asignada | Probado (T04) |
| Empleado | Escanear QR con cámara (jsQR) o escribir el número | Captura manual probada; cámara no probada con hardware |
| Empleado | Confirmar compra con ticket, importe y regla vigente | Probado (T05) |
| Empleado | Confirmar canje atómico y marcar entregado | Probado (T05, T08) |
| Empleado | Estados de éxito, pendiente, error y "resultado incierto" con consulta por clave | Probado (T30, navegador) |
| Empleado | Cambio de turno: canjes sin entregar, compras recientes, contingencia | Revisión manual |
| Empleado | Hoja de contingencia imprimible y captura posterior | Probado (T15) |
| Empleado | Tarjeta impresa para clientes sin celular | Revisión manual |
| Dueño | Resumen: compras registradas, recurrencia, canjes, puntos vigentes, por sucursal y por semana | Revisión manual |
| Dueño | Alertas simples de posible abuso | Revisión manual |
| Dueño | Ajustes con motivo e historial; devoluciones; disputas; fusiones; reposiciones | Probado (T09, T13, T22, T23) |
| Dueño | Empleados: alta, revocación inmediata, contraseña temporal | Probado (T10) |
| Dueño | Reglas versionadas con fecha; aviso de 14 días al subir costo de premio | Probado (T20) |
| Dueño | Premios con existencias; premio agotado no descuenta | Probado (T12) |
| Dueño | Sucursales y QR de mostrador imprimible; perfil y color de tarjeta | Revisión manual |
| Dueño | Bitácora del negocio y solicitudes de soporte | Revisión manual |
| Admin | Negocios, pilotos, categorías, suscripciones y pagos manuales, incidentes, privacidad, bitácora | Revisión manual |
| Servidor | Idempotencia por clave y ticket único por sucursal | Probado (T07, incluso simultáneo) |
| Servidor | Canje atómico con bloqueo; 10 canjes simultáneos → 1 | Probado (T08) |
| Servidor | Saldo nunca negativo (restricción en base de datos) | Probado (T06, T09) |
| Servidor | Historial y bitácora que no se pueden editar ni borrar | Probado (T09) |
| Servidor | Límite diario de compras por tarjeta | Probado (T19) |
| Servidor | Vencimiento de puntos por inactividad | Probado (T21) |
| Servidor | Verificación del titular con código al canjear (configurable) | Probado (T24) |
| Servidor | Persistencia tras reinicio abrupto | Probado (T03) |
| Seguridad | Sesiones revocables en base de datos, cookies httpOnly, protección por origen y JSON | Probado (T10, T27) |
| Seguridad | Bloqueo temporal tras 5 contraseñas incorrectas | Probado (T28) |
| Seguridad | Encabezados de seguridad (CSP, HSTS en https) | Configurado; no auditado externamente |
| Operación | Despertador interno para Render gratis (`KEEPALIVE_URL`) | Configurado; no probado en Render |

## Simulado (etiquetado como tal en pantalla)

| Función | Qué hace hoy | Qué falta |
|---|---|---|
| Envío de códigos por SMS, WhatsApp y correo | Guarda el mensaje en la base y lo muestra en el **buzón de la demo** (`/buzon-demo`) | Contratar proveedor(es), plantillas aprobadas (WhatsApp), costos por mensaje, adaptador real |
| "Añadir a Google Wallet" | Registra un pase **de prueba** y su cola de actualización; no aparece en ningún teléfono | Cuenta de emisor de Google Wallet, aprobación de publicación, credenciales y adaptador real |
| Falla del proveedor de Wallet | Interruptor en Administración para probar la contingencia | — |

## Pendiente

| Función | Nota |
|---|---|
| Google Wallet real | Primero, si el piloto lo justifica (ver `WALLET.md`) |
| Apple Wallet | Fase posterior según demanda; requiere Apple Developer Program |
| Proveedor real de mensajes | Necesario antes de operar con clientes reales (registro y recuperación dependen de él) |
| Promociones y avisos a clientes | Posterior al MVP; depende de permisos y límites reales |
| Aviso previo de vencimiento y de cambio de reglas | Depende de mensajería real |
| Ejecución automática del vencimiento | Hoy es un botón en Administración |
| Cobro automático de mensualidades | Hoy los pagos se registran a mano |
| Subida de archivo de logotipo | Hoy se usa una URL |
| Exportación de datos de un negocio que cancela | Hoy requiere consulta directa a la base |
| Cambio de contacto verificado del cliente | Sin flujo; procedimiento manual |
| Vincular contacto a una tarjeta impresa ya emitida | Sin flujo |
| Recuperación de contraseña del personal por correo | Hoy la asigna el encargado |
| QR dinámico que cambie cada minuto | Reduciría el riesgo de QR copiado |
| Monitoreo externo con alertas y guardia | Necesario para el piloto |
| Respaldos y ensayo de restauración | La base gratis de Render no tiene respaldos |
| Revisión legal del aviso de privacidad | Borrador |
| Modo fuera de línea | No se planea; la contingencia es por hoja |
| Pruebas de carga y auditoría de seguridad externa | No realizadas |
