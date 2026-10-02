---
title: Situaciones y soluciones
subtitle: Plataforma de lealtad Chavarín & Said (nombre provisional)
date: Versión 2026-10-01
---

# Situaciones y soluciones

Qué hacer cuando algo sale distinto a lo normal. Cada caso indica situación, pantalla, respuesta, responsable, prevención y estado de implementación. No cubre todos los incidentes posibles ni promete resolverlos al instante.

Basado en la guía de 36 situaciones (diseño propuesto) y en la lista del brief; se agregaron 4 casos.

**Estados**: Implementado = el sistema lo hace cumplir · Parcial = parte implementada y parte simulada o pendiente · Simulado = existe solo como simulación etiquetada · Procedimiento = lo cumplen las personas · Pendiente = no existe.

| Estado | Casos |
|---|---|
| Implementado | 27 |
| Parcial | 5 |
| Simulado | 2 |
| Procedimiento | 4 |
| Pendiente | 2 |

## Índice

| # | Situación | Estado |
|---|---|---|
| 01 | Compra con QR | Implementado |
| 02 | Sin cámara o QR no se lee por cámara | Implementado |
| 03 | Cliente nuevo | Parcial |
| 04 | Cliente sin celular | Implementado |
| 05 | QR ilegible | Implementado |
| 06 | Tarjeta perdida o cambio de celular | Parcial |
| 07 | Solicitud de puntos sin compra | Implementado |
| 08 | QR compartido | Parcial |
| 09 | Compra duplicada | Implementado |
| 10 | Respuesta interrumpida | Implementado |
| 11 | Saldo de Wallet desactualizado | Simulado |
| 12 | Puntos incorrectos | Implementado |
| 13 | Devolución o reembolso | Implementado |
| 14 | Canje normal | Implementado |
| 15 | Doble canje | Implementado |
| 16 | Premio agotado | Implementado |
| 17 | Entrega dudosa | Implementado |
| 18 | Puntos vencidos | Parcial |
| 19 | Cambio de reglas | Implementado |
| 20 | Sin internet | Implementado |
| 21 | Servidor caído | Procedimiento |
| 22 | Wallet no disponible | Simulado |
| 23 | Contraseña olvidada (empleado) | Implementado |
| 24 | Empleado se retira | Implementado |
| 25 | Abuso de puntos | Implementado |
| 26 | Negocio equivocado | Implementado |
| 27 | Datos o publicidad | Parcial |
| 28 | Posible intrusión | Procedimiento |
| 29 | Mensualidad pendiente | Implementado |
| 30 | Negocio cancela o cierra | Procedimiento |
| 31 | Restauración de respaldo | Pendiente |
| 32 | Soporte saturado | Procedimiento |
| 33 | Cambio de turno | Implementado |
| 34 | Compra en otra sucursal | Implementado |
| 35 | Cuenta duplicada | Implementado |
| 36 | Negocio no percibe beneficio | Implementado |
| 37 | Saldo insuficiente | Implementado |
| 38 | Negocio pendiente de aprobación | Implementado |
| 39 | Cliente perdió acceso a su contacto | Pendiente |
| 40 | Intento de operación desde otro sitio web | Implementado |

## 01. Compra con QR

- **Situación:** El cliente muestra la tarjeta C-104 con 30 puntos y compra algo elegible.
- **Pantalla:** Panel del empleado › Mostrador: Identificar tarjeta → Confirmar compra.
- **Respuesta:** El empleado escanea o escribe el número, captura el ticket y confirma. Se registra +10 y el saldo queda en 40, con referencia de ticket, empleado, sucursal y versión de regla.
- **Responsable:** Empleado
- **Prevención:** Permisos validados en el servidor por negocio y sucursal; cada compra exige referencia de ticket y clave de operación única.
- **Estado:** Implementado y probado. Prueba: T05 compra y canje normales.

## 02. Sin cámara o QR no se lee por cámara

- **Situación:** El celular del mostrador no tiene cámara útil o el navegador no da permiso; el cliente muestra el número C-104.
- **Pantalla:** Panel del empleado › Mostrador: campo "Número de tarjeta".
- **Respuesta:** Captura manual del número. El sistema muestra la tarjeta encontrada; los puntos se suman solo al confirmar la compra.
- **Responsable:** Empleado
- **Prevención:** El número legible acompaña siempre al QR. La búsqueda es por número, no por datos personales. La cámara solo funciona en https; en http se avisa y se usa el número.
- **Estado:** Implementado. La lectura con cámara usa la librería jsQR y no se probó con hardware real en este entorno. Prueba: T17 identificar no suma.

## 03. Cliente nuevo

- **Situación:** El cliente pide su primera tarjeta en el mostrador.
- **Pantalla:** QR del mostrador → página /r/(código de la sucursal): nombre, contacto, aviso de privacidad, permiso de publicidad opcional, código de verificación.
- **Respuesta:** Se crea la tarjeta con 0 puntos tras verificar el código enviado al contacto. La compra se registra después, por separado, desde el panel del empleado.
- **Responsable:** Empleado (orienta) y cliente
- **Prevención:** Registrarse no equivale a comprar. La publicidad tiene su propia casilla, desmarcada por defecto. Si el contacto ya tenía tarjeta en ese programa, se muestra la misma y no se crea otra.
- **Estado:** Parcial. Registro y verificación implementados; el envío del código está SIMULADO (buzón demo) hasta contratar proveedor de SMS/WhatsApp/correo. Prueba: T16 registro con código.

## 04. Cliente sin celular

- **Situación:** El cliente presenta la tarjeta impresa C-106.
- **Pantalla:** Panel del empleado › Tarjeta impresa (emitir) y Mostrador (consultar con el número).
- **Respuesta:** Se lee el QR impreso o se escribe el número. El saldo se muestra en el panel; se registra la compra y se informa al cliente.
- **Responsable:** Empleado
- **Prevención:** El papel solo identifica; el saldo vive en el servidor. Al emitirla se avisa que, sin contacto registrado, funciona al portador y no se puede reponer.
- **Estado:** Implementado (emisión, impresión y uso). Vincular un contacto a una tarjeta impresa ya emitida queda pendiente. Prueba: T17 identificar no suma.

## 05. QR ilegible

- **Situación:** Pantalla dañada o impresión borrosa.
- **Pantalla:** Panel del empleado › Mostrador: captura manual.
- **Respuesta:** Usar el número de tarjeta. Si tampoco se puede, el cliente entra a "Mis tarjetas" con su código (recuperación) para ver el número. Nunca se crea otra tarjeta para improvisar un saldo.
- **Responsable:** Empleado
- **Prevención:** Número legible junto al QR; una tarjeta activa por cliente y programa (restricción en base de datos).
- **Estado:** Implementado.

## 06. Tarjeta perdida o cambio de celular

- **Situación:** El cliente cambió de celular o perdió el papel.
- **Pantalla:** Cliente: Mis tarjetas → entrar con código. Encargado: Panel del negocio › Tarjetas y ajustes › Reponer tarjeta.
- **Respuesta:** Si tiene tarjeta web, entra con un código a su contacto y la vuelve a ver (no hace falta reponer). Si se copió o se perdió el código impreso, el encargado envía un código al titular y repone con número nuevo; el anterior deja de funcionar y el saldo se transfiere con historial. Sin contacto verificable, se escala y no se repone.
- **Responsable:** Encargado
- **Prevención:** Recuperación definida antes del alta: contacto verificado al registrarse. El QR no acredita identidad.
- **Estado:** Parcial. Implementado; el envío del código está SIMULADO. Prueba: T23 reposición con código.

## 07. Solicitud de puntos sin compra

- **Situación:** El cliente pide puntos solo mostrando su QR.
- **Pantalla:** Panel del empleado › Mostrador.
- **Respuesta:** Saldo sin cambios. Se explica que mostrar el QR no genera puntos: solo una compra confirmada con ticket.
- **Responsable:** Empleado
- **Prevención:** Consultar tarjeta y registrar compra son acciones separadas; la consulta no escribe nada.
- **Estado:** Implementado y probado. Prueba: T17 identificar no suma.

## 08. QR compartido

- **Situación:** Dos personas presentan la misma tarjeta.
- **Pantalla:** Panel del empleado › Mostrador (titular abreviado) y ajustes del programa.
- **Respuesta:** La tarjeta es personal. Si el programa exige verificación al canjear, se envía un código al titular; sin el código no se canjea. Sumar compras con la misma tarjeta no se bloquea, pero cuenta para el límite diario y las alertas.
- **Responsable:** Encargado
- **Prevención:** Tarjeta personal por política. Un QR estático puede copiarse: por eso existe la verificación por código al canjear (configurable por programa) y el límite de compras por día.
- **Estado:** Parcial. Implementado; el código de verificación se envía de forma SIMULADA. Un QR dinámico que cambie cada minuto queda pendiente. Prueba: T24 verificación al canjear.

## 09. Compra duplicada

- **Situación:** El cliente o el empleado reintenta el mismo ticket T-208.
- **Pantalla:** Panel del empleado › Mostrador: mensaje "Ticket ya registrado".
- **Respuesta:** Se muestra la operación existente y no se suma nuevamente.
- **Responsable:** Sistema
- **Prevención:** Índice único por sucursal y referencia de ticket, y clave de operación única. Si el mismo ticket llega dos veces al mismo tiempo, la base de datos solo acepta una.
- **Estado:** Implementado y probado, incluso con envíos simultáneos. Prueba: T07 compra duplicada.

## 10. Respuesta interrumpida

- **Situación:** El botón quedó cargando después de confirmar; no se sabe si la compra se guardó.
- **Pantalla:** Panel del empleado › Mostrador: aviso "No sabemos si se guardó" con "Consultar estado" y "Reintentar (misma clave)".
- **Respuesta:** Consultar la referencia original antes de reintentar. Si existe, no se repite; si no existe, se reintenta con la MISMA clave. Nunca se genera una referencia nueva para el mismo intento.
- **Responsable:** Empleado y soporte
- **Prevención:** Operaciones idempotentes y estado consultable por clave. La clave pendiente se guarda en el navegador mientras la pestaña siga abierta.
- **Estado:** Implementado y probado (reenvío con la misma clave devuelve el resultado original). Prueba: T30 estado de operación.

## 11. Saldo de Wallet desactualizado

- **Situación:** Wallet muestra 30; el servidor registra 40.
- **Pantalla:** Mis tarjetas (saldo del servidor) y Administración › Integraciones (cola de Wallet).
- **Respuesta:** Vale el saldo confirmado del servidor. La cola reintenta copiar el saldo vigente al pase, sin volver a sumar puntos.
- **Responsable:** Soporte
- **Prevención:** Cola de actualizaciones: cada tarea copia el saldo actual, no suma. Tarjeta web siempre disponible.
- **Estado:** Simulado. La cola y su reintento están implementados y probados; el pase de Wallet es SIMULADO (no hay integración real con Google ni Apple). Prueba: T11 fallo de Wallet.

## 12. Puntos incorrectos

- **Situación:** Una compra recibió 100 en lugar de 10.
- **Pantalla:** Panel del negocio › Tarjetas y ajustes › Ajuste autorizado.
- **Respuesta:** El encargado registra un ajuste de −90 con motivo y referencia al movimiento original; la operación original se conserva.
- **Responsable:** Encargado
- **Prevención:** Solo encargado o dueño ajustan; motivo obligatorio; límite de ±1000 por ajuste; historial que no se puede editar ni borrar; alertas por muchos ajustes.
- **Estado:** Implementado y probado. Prueba: T09 ajustes auditados.

## 13. Devolución o reembolso

- **Situación:** El cliente devuelve una compra que dio puntos.
- **Pantalla:** Panel del negocio › Compras › Devolución.
- **Respuesta:** Se revierten los puntos de esa compra. Si ya se gastaron, se revierte lo que haya y se abre un caso con lo faltante para resolverlo con la política del negocio; no se improvisan cobros.
- **Responsable:** Encargado
- **Prevención:** Devolución enlazada a la compra original; el saldo nunca queda negativo.
- **Estado:** Implementado y probado. La política de qué hacer con puntos ya gastados la define cada negocio (procedimiento). Prueba: T13 devolución.

## 14. Canje normal

- **Situación:** Saldo 50; el premio cuesta 50.
- **Pantalla:** Panel del empleado › Mostrador › Canjear premio.
- **Respuesta:** Se crea un único canje y se descuentan 50 en una sola operación. El empleado entrega el premio y lo marca como entregado.
- **Responsable:** Empleado
- **Prevención:** Canje atómico en el servidor con bloqueo de la tarjeta; estado de entrega registrado.
- **Estado:** Implementado y probado. Prueba: T05 compra y canje normales.

## 15. Doble canje

- **Situación:** Dos empleados intentan gastar los mismos 50 puntos al mismo tiempo.
- **Pantalla:** Panel del empleado (dos dispositivos).
- **Respuesta:** Solo un canje se confirma. El segundo recibe "Saldo insuficiente" con el saldo actualizado y no entrega otro premio.
- **Responsable:** Sistema
- **Prevención:** Transacción con bloqueo de la fila de la tarjeta y restricción de saldo no negativo en la base de datos.
- **Estado:** Implementado y probado con 10 canjes simultáneos. Prueba: T08 canjes concurrentes.

## 16. Premio agotado

- **Situación:** No hay producto disponible para entregar.
- **Pantalla:** Panel del empleado › Canjear (botón "Agotado") y Panel del negocio › Programa (existencias).
- **Respuesta:** No se descuentan puntos. El encargado ofrece otro premio del catálogo o el cliente canjea después.
- **Responsable:** Encargado
- **Prevención:** Existencias por premio; el servidor rechaza el canje sin descontar si llegan a cero.
- **Estado:** Implementado y probado. Prueba: T12 premio agotado.

## 17. Entrega dudosa

- **Situación:** Se descontaron puntos pero el cliente dice que no recibió el premio.
- **Pantalla:** Panel del negocio › Canjes › Abrir revisión → "Sí se entregó" o "Reponer puntos".
- **Respuesta:** Se revisa con empleado y encargado. Si procede, se reponen los puntos con autorización y registro, sin generar un segundo canje automático.
- **Responsable:** Encargado
- **Prevención:** Estado de entrega, revisión y corrección auditada.
- **Estado:** Implementado y probado. Prueba: T09 ajustes auditados.

## 18. Puntos vencidos

- **Situación:** El cliente reclama un saldo que venció.
- **Pantalla:** Panel del negocio › Tarjetas y ajustes (historial con el movimiento "Vencimiento").
- **Respuesta:** Se explica con las reglas mostradas y las fechas del historial. Si hubo error o regla ambigua, se escala antes de negar y se puede reponer con ajuste autorizado.
- **Responsable:** Encargado
- **Prevención:** Reglas visibles en la página de la sucursal y en Mis tarjetas, con la fecha estimada de vencimiento.
- **Estado:** Parcial. Vencimiento implementado y probado; se ejecuta con un botón de Administración (falta programarlo automático). El aviso previo al cliente está PENDIENTE (depende de mensajería real). Prueba: T21 vencimiento.

## 19. Cambio de reglas

- **Situación:** Hay clientes con puntos y el dueño quiere subir el premio de 50 a 100.
- **Pantalla:** Panel del negocio › Programa y premios.
- **Respuesta:** Las reglas nuevas se programan con fecha; los saldos no se recalculan. Subir el costo de un premio aplica 14 días después y se muestra el aviso en la página de la sucursal.
- **Responsable:** Dueño
- **Prevención:** Reglas versionadas; cada compra guarda la versión aplicada; aviso visible antes de aplicar.
- **Estado:** Implementado y probado. Comunicar el cambio a los clientes por mensaje queda PENDIENTE. Prueba: T20 cambio de reglas.

## 20. Sin internet

- **Situación:** No se puede consultar saldo.
- **Pantalla:** Panel del empleado › Sin internet (hoja imprimible y captura posterior); Panel del negocio › Contingencia.
- **Respuesta:** Se atiende la venta y se anotan tarjeta, ticket, importe y hora en la hoja. Al reconectar se capturan; el encargado aplica o rechaza. Se suspenden los canjes que no puedan verificarse.
- **Responsable:** Empleado y encargado
- **Prevención:** Conciliación por ticket sin duplicados. No hay modo fuera de línea y no se promete.
- **Estado:** Implementado y probado (un ticket repetido no suma dos veces). Prueba: T15 contingencia.

## 21. Servidor caído

- **Situación:** Compras y canjes no se confirman; varios negocios no pueden entrar.
- **Pantalla:** Panel del empleado (aviso de resultado incierto); Administración › Incidentes; /api/health.
- **Respuesta:** Activar contingencia por hoja, abrir incidente y comunicar el estado. Restaurar y conciliar antes de declarar la recuperación.
- **Responsable:** Chavarín & Said
- **Prevención:** Punto de salud /api/health; procedimiento de incidentes; responsable de guardia.
- **Estado:** Procedimiento definido. El monitoreo externo y el responsable de guardia están PENDIENTES; en Render gratis no hay monitoreo con alertas incluido.

## 22. Wallet no disponible

- **Situación:** El cliente no puede añadir la tarjeta a Wallet.
- **Pantalla:** Mis tarjetas.
- **Respuesta:** Ofrecer la tarjeta web o la impresa. Registrar el fallo para soporte; el saldo no cambia por cambiar de formato.
- **Responsable:** Empleado y soporte
- **Prevención:** Mismo identificador y saldo en todas las alternativas; la tarjeta web siempre funciona.
- **Estado:** Simulado. El botón de Google Wallet es una SIMULACIÓN etiquetada; Apple Wallet está marcado como fase posterior.

## 23. Contraseña olvidada (empleado)

- **Situación:** Un empleado no recuerda su contraseña.
- **Pantalla:** Panel del negocio › Empleados › Contraseña temporal; pantalla Entrar.
- **Respuesta:** El encargado o dueño asigna una contraseña temporal que se entrega en persona y se cambia al entrar. Mientras tanto otro empleado autorizado atiende.
- **Responsable:** Empleado y encargado
- **Prevención:** Cuentas individuales; no se comparten ni se envían contraseñas por chat; bloqueo temporal tras 5 intentos fallidos. Si la cuenta también es de otro negocio, solo soporte puede recuperarla.
- **Estado:** Implementado. La recuperación por correo del propio empleado queda PENDIENTE. Prueba: T28 bloqueo de acceso.

## 24. Empleado se retira

- **Situación:** Un exempleado conserva acceso.
- **Pantalla:** Panel del negocio › Empleados › Revocar acceso.
- **Respuesta:** Se revoca la membresía y se cierran sus sesiones de inmediato. Se conserva la auditoría; si hay indicios de abuso, se revisa su actividad.
- **Responsable:** Encargado
- **Prevención:** Baja inmediata; el permiso se revisa en cada petición, no solo al entrar.
- **Estado:** Implementado y probado. Prueba: T10 revocación de empleados.

## 25. Abuso de puntos

- **Situación:** Un empleado genera compras ficticias.
- **Pantalla:** Panel del negocio › Resumen › Alertas; Bitácora.
- **Respuesta:** Revisar la evidencia (tickets, horarios, tarjetas). Restringir la cuenta si corresponde y corregir con autorización. Una alerta no es una acusación.
- **Responsable:** Dueño y soporte
- **Prevención:** Referencia de ticket obligatoria, límite diario por tarjeta, alertas por ráfagas de compras o ajustes, historial inmutable.
- **Estado:** Implementado (alertas simples basadas en reglas, sin aprendizaje automático). Prueba: T19 límite diario.

## 26. Negocio equivocado

- **Situación:** Un empleado intenta acceder a la tarjeta de otro negocio.
- **Pantalla:** Panel del empleado.
- **Respuesta:** Acceso rechazado sin revelar datos de otro negocio: responde igual que si la tarjeta no existiera.
- **Responsable:** Sistema
- **Prevención:** Aislamiento validado en el servidor en cada consulta y operación, no solo en pantalla. Una base de datos impide unir sucursales y programas de empresas distintas.
- **Estado:** Implementado y probado. Prueba: T04 separación entre empresas.

## 27. Datos o publicidad

- **Situación:** El cliente pide dejar de recibir promociones o gestionar sus datos.
- **Pantalla:** Mis tarjetas › Promociones de este negocio y Tus datos; Administración › Privacidad.
- **Respuesta:** La publicidad se desactiva por negocio sin afectar la tarjeta. Las solicitudes de datos se registran con folio y se canalizan al responsable.
- **Responsable:** Dueño y Chavarín & Said
- **Prevención:** Permisos de publicidad separados del uso de la tarjeta; proceso de solicitudes con folio.
- **Estado:** Parcial. Implementado el registro y el seguimiento. El aviso de privacidad es un BORRADOR sujeto a revisión legal y el envío de promociones no existe todavía. Prueba: T29 publicidad separada.

## 28. Posible intrusión

- **Situación:** Se observan accesos o movimientos sospechosos.
- **Pantalla:** Administración › Incidentes y Bitácora; Panel del negocio › Bitácora.
- **Respuesta:** Contener accesos (revocar sesiones, suspender negocio si hace falta), preservar evidencia y evaluar alcance. Comunicar solo hechos verificados y cumplir obligaciones aplicables.
- **Responsable:** Chavarín & Said
- **Prevención:** Accesos por rol, sesiones revocables, bitácora que no se puede editar, secretos fuera del código.
- **Estado:** Procedimiento. Controles técnicos implementados; el plan de respuesta es un procedimiento. No hay detección automática de intrusiones.

## 29. Mensualidad pendiente

- **Situación:** El negocio no pagó la suscripción.
- **Pantalla:** Administración › Suscripciones y pagos; Negocios.
- **Respuesta:** Avisar al dueño y aplicar las condiciones acordadas (periodo de gracia). Si se suspende, se bloquean operaciones nuevas pero no se borran saldos ni se sorprende a los clientes.
- **Responsable:** Chavarín & Said
- **Prevención:** Registro manual de pagos, estado de suscripción y suspensión explícita.
- **Estado:** Implementado de forma manual (sin cobro automático). La suspensión bloquea operaciones y conserva saldos (probado). Prueba: T26 negocio suspendido.

## 30. Negocio cancela o cierra

- **Situación:** Existen tarjetas y premios pendientes.
- **Pantalla:** Administración › Negocios (cancelar).
- **Respuesta:** Acordar exportación, aviso a clientes y tratamiento de premios pendientes. El negocio responde por sus premios según lo acordado.
- **Responsable:** Dueño y Chavarín & Said
- **Prevención:** Plan de salida y conservación o eliminación de datos.
- **Estado:** Procedimiento. El estado "cancelado" existe; la exportación automática de datos está PENDIENTE (hoy se haría con consulta a la base).

## 31. Restauración de respaldo

- **Situación:** Un fallo obliga a restaurar la base de datos.
- **Pantalla:** Fuera de la aplicación (proveedor de base de datos) y Administración › Incidentes.
- **Respuesta:** Restaurar en un entorno controlado, verificar integridad y conciliar los movimientos posteriores al respaldo antes de reabrir.
- **Responsable:** Chavarín & Said
- **Prevención:** Pruebas de restauración y objetivos de recuperación definidos.
- **Estado:** Pendiente. PENDIENTE: la base gratis de Render no tiene respaldos. Con plan de pago hay respaldo y recuperación a un punto en el tiempo; falta ensayar la restauración.

## 32. Soporte saturado

- **Situación:** Muchos locales piden ayuda a la vez.
- **Pantalla:** Panel del negocio › Soporte; Administración › Incidentes (ordenados por prioridad).
- **Respuesta:** Clasificar: caídas y canjes bloqueados primero, cambios de diseño después. Asignar responsable y dar un plazo realista.
- **Responsable:** Chavarín & Said
- **Prevención:** Horario, alcance, canal y responsable de soporte publicados.
- **Estado:** Procedimiento. El registro y la priorización están implementados; horario y cobertura de soporte están por definir. No hay atención 24/7.

## 33. Cambio de turno

- **Situación:** Otro empleado continúa una atención con una operación pendiente.
- **Pantalla:** Panel del empleado › Cambio de turno.
- **Respuesta:** Consultar el estado y quién la inició antes de completar. No repetir la compra ni el premio.
- **Responsable:** Encargado
- **Prevención:** Estados claros (sin entregar, en revisión) e historial visible al personal autorizado.
- **Estado:** Implementado.

## 34. Compra en otra sucursal

- **Situación:** El cliente quiere usar sus puntos en otro local.
- **Pantalla:** Panel del empleado (aviso "no aplica en esta sucursal") y página de la sucursal.
- **Respuesta:** Se acepta solo si el programa es común a ambas sucursales. Si no, se informa antes de cobrar.
- **Responsable:** Empleado
- **Prevención:** Programa por negocio o grupo de sucursales; los saldos nunca se mezclan entre empresas.
- **Estado:** Implementado y probado (programa común y programas separados). Prueba: T18 otra sucursal.

## 35. Cuenta duplicada

- **Situación:** El cliente tiene dos tarjetas con puntos y pide combinarlas.
- **Pantalla:** Panel del negocio › Tarjetas y ajustes › Unir dos tarjetas.
- **Respuesta:** Verificar el control de ambas (mismo titular o código al titular) y unir con auditoría: el saldo pasa a la que se conserva y la otra queda inválida.
- **Responsable:** Encargado y soporte
- **Prevención:** Proceso de fusión que mueve el saldo una sola vez con movimientos enlazados.
- **Estado:** Implementado y probado. Prueba: T22 fusión.

## 36. Negocio no percibe beneficio

- **Situación:** El dueño dice que no ve resultados.
- **Pantalla:** Panel del negocio › Resumen (compras registradas, recurrencia, canjes).
- **Respuesta:** Comparar periodos con contexto, revisar uso, costo de premios y soporte, entrevistar empleados y decidir ajustar, continuar o cancelar. No se atribuye toda compra al sistema.
- **Responsable:** Dueño y Chavarín & Said
- **Prevención:** Métricas de uso basadas en compras registradas; sin garantía de más ventas.
- **Estado:** Implementado. Métricas implementadas. La evaluación del piloto es un procedimiento.

## 37. Saldo insuficiente

- **Situación:** El cliente quiere un premio de 50 y tiene 40.
- **Pantalla:** Panel del empleado › Canjear (botón "Faltan 10").
- **Respuesta:** El servidor rechaza el canje sin descontar nada y muestra cuánto falta.
- **Responsable:** Sistema
- **Prevención:** Validación en servidor y restricción de saldo no negativo en la base de datos.
- **Estado:** Implementado y probado. Prueba: T06 saldo insuficiente.

## 38. Negocio pendiente de aprobación

- **Situación:** Un negocio se registró pero aún no lo revisamos.
- **Pantalla:** Administración › Negocios; Panel del negocio (aviso).
- **Respuesta:** No aparece en el directorio ni puede registrar compras hasta aprobarse. Mientras tanto puede configurar empleados y premios.
- **Responsable:** Chavarín & Said
- **Prevención:** Solo se publican negocios autorizados.
- **Estado:** Implementado y probado. Prueba: T01 categorías y búsqueda.

## 39. Cliente perdió acceso a su contacto

- **Situación:** El cliente ya no tiene el número o correo con que se registró.
- **Pantalla:** Soporte (fuera de la aplicación).
- **Respuesta:** Sin un método verificable no se transfiere el saldo. Se escala con el encargado y soporte; puede crearse una tarjeta nueva con 0 puntos.
- **Responsable:** Encargado y soporte
- **Prevención:** Se recomienda al cliente mantener actualizado su contacto.
- **Estado:** Pendiente. PENDIENTE: no existe flujo para cambiar el contacto verificado. Procedimiento manual con revisión.

## 40. Intento de operación desde otro sitio web

- **Situación:** Una página maliciosa intenta enviar una compra usando la sesión abierta del empleado.
- **Pantalla:** Ninguna (protección del servidor).
- **Respuesta:** El servidor rechaza peticiones que no sean JSON o vengan de otro origen.
- **Responsable:** Sistema
- **Prevención:** Cookies de sesión httpOnly y SameSite=Lax, verificación de origen y de tipo de contenido.
- **Estado:** Implementado y probado. Prueba: T27 protección de origen.

