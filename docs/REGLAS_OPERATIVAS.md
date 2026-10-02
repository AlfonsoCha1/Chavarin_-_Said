---
title: Reglas operativas
subtitle: Plataforma de lealtad Chavarín & Said (nombre provisional)
date: Versión 0.1 · 1 de octubre de 2026
---

# Reglas operativas

Este documento dice cómo debe operar la plataforma en el mostrador, en el negocio y en nuestra administración. Cada regla indica su estado:

- **[Implementado]**: el sistema lo hace cumplir y hay prueba automática o revisión manual documentada.
- **[Simulado]**: existe en la demostración, pero sin el servicio real (por ejemplo, mensajes y Wallet).
- **[Procedimiento]**: lo cumplen las personas; el sistema solo ayuda a registrarlo.
- **[Pendiente]**: no existe todavía.

Nada de lo aquí escrito garantiza más ventas ni cubre todos los incidentes posibles.

## 1. Quién responde de qué

| Parte | Responde de |
|---|---|
| Negocio (dueño) | Define qué compras cuentan, cuántos puntos dan, premios, vigencia y sucursales. **Cubre y entrega los premios.** Da de alta y de baja a su personal. |
| Encargado | Autoriza ajustes, devoluciones, disputas, fusiones, reposiciones y comprobantes de contingencia. |
| Empleado | Identifica la tarjeta, confirma compras y canjes, marca premios entregados. |
| Chavarín & Said | Administra la plataforma: publicación en el directorio, categorías, pagos, soporte, incidentes, respaldos e integraciones. |
| Cliente | Usa una tarjeta personal y mantiene vigente su contacto para recuperarla. |

## 2. Roles y permisos [Implementado]

| Acción | Empleado | Encargado | Dueño | Administración |
|---|:-:|:-:|:-:|:-:|
| Consultar tarjeta, registrar compra y canje | Sí (su sucursal si está asignado) | Sí | Sí | No |
| Marcar premio entregado, cambio de turno, capturar contingencia | Sí | Sí | Sí | No |
| Ajustes, devoluciones, disputas, fusiones, reposiciones | No | Sí | Sí | No |
| Aplicar o rechazar contingencia | No | Sí | Sí | No |
| Alta y baja de empleados | No | Solo empleados | Sí | No |
| Cambiar reglas, premios, costos, sucursales, perfil | No | Solo existencias de premios | Sí | No |
| Aprobar negocios, categorías, pagos, incidentes | No | No | No | Sí |
| Ver contactos completos de clientes | No | No (enmascarados) | No (enmascarados) | No |

- Cada persona tiene **cuenta individual**. No se comparten cuentas ni contraseñas. [Implementado]
- El servidor revisa permisos y negocio **en cada petición**, no solo al entrar. [Implementado]

## 3. La tarjeta

- **Es personal.** El QR identifica la tarjeta, pero no acredita quién es su titular. [Implementado como política]
- Formatos: tarjeta web (en el celular) e impresa. **El saldo siempre vive en el servidor**; el papel y Wallet solo lo muestran. [Implementado]
- Un cliente tiene como máximo **una tarjeta activa por programa**. [Implementado]
- Cada tarjeta lleva un número legible (por ejemplo `C-7K3P9Q`) junto al QR, para captura manual. [Implementado]
- **Recuperación:** con un código de 6 dígitos al contacto verificado del cliente, por SMS, WhatsApp o correo, a su elección. [Simulado: el código aparece en el buzón de la demo; falta contratar proveedor]
- Tarjeta impresa **sin contacto**: funciona al portador y **no se puede reponer**. Se le dice al cliente al emitirla. [Implementado]
- Programas que lo configuren piden **código del titular al canjear**, para reducir el riesgo de un QR copiado. [Implementado; envío Simulado]

## 4. Registro de clientes

1. El cliente escanea el **QR del mostrador** de una sucursal, que abre el registro de esa sucursal. [Implementado]
2. Captura nombre y un contacto. Debe aceptar el aviso de privacidad. La casilla de publicidad es **opcional y desmarcada**. [Implementado]
3. Confirma con un código. La tarjeta se crea con **0 puntos**. [Implementado; envío Simulado]
4. Registrarse **no suma puntos**. La compra se registra aparte, por el personal. [Implementado]
5. Si el contacto ya tenía tarjeta en ese programa, se muestra la misma; no se crea otra. [Implementado]

## 5. Compras

- **Solo suma una compra confirmada por el personal.** Escanear o mostrar un QR nunca suma. [Implementado]
- Cada compra exige **referencia de ticket o nota**. El mismo ticket no puede sumar dos veces en la sucursal. [Implementado]
- Cada intento lleva una **clave de operación única**. Si se reenvía la misma clave, el servidor devuelve el resultado original sin sumar otra vez. [Implementado]
- Si llega otra compra a la misma tarjeta en menos de **3 minutos**, el sistema pide confirmar que es una compra distinta. [Implementado]
- Límite de **compras por tarjeta por día** (3 por defecto, configurable por el dueño). Más allá, el encargado decide con un ajuste justificado. [Implementado]
- Los puntos de cada compra se calculan con la **regla vigente**, y la compra guarda su número de versión. [Implementado]
- Si el programa tiene compra mínima, el importe es obligatorio. [Implementado]
- Se registra quién, cuándo, dónde, ticket, importe y regla aplicada. [Implementado]

## 6. Canjes

- El servidor verifica permisos, sucursal, premio activo, existencias y saldo **en la misma operación** en la que descuenta. [Implementado]
- Dos canjes simultáneos sobre el mismo saldo: **solo uno pasa**. [Implementado, probado con 10 intentos simultáneos]
- Premio agotado o saldo insuficiente: **no se descuenta nada**. [Implementado]
- Después de entregar, el empleado marca el premio como **entregado**. [Implementado]
- **Sin conexión no se canjea.** [Procedimiento]
- Si el cliente dice que no recibió el premio: el encargado abre revisión; si procede, **repone los puntos** con autorización, sin crear un segundo canje automático. [Implementado]

## 7. Correcciones

- **Nada se borra.** Toda corrección es un movimiento nuevo con autor, fecha y motivo. El historial y la bitácora no se pueden editar ni borrar (lo impide la base de datos). [Implementado]
- **Ajuste:** encargado o dueño, motivo de al menos 10 caracteres, máximo ±1000 por ajuste, nunca saldo negativo. Puede enlazarse al movimiento que corrige. [Implementado]
- **Devolución:** se revierten los puntos de esa compra. Si el cliente ya los gastó, se revierte lo que haya y se abre un caso con lo faltante. **No se improvisan cobros**; se aplica la política que el negocio publique. [Implementado; política por negocio: Procedimiento]
- **Cuenta duplicada:** se unen dos tarjetas del mismo programa con verificación del titular de la que se cancela. El saldo se mueve una sola vez y la tarjeta anterior queda inválida. [Implementado]
- **Reposición:** con código al titular; tarjeta nueva, saldo transferido, tarjeta anterior inválida. [Implementado; envío Simulado]

## 8. Reglas del programa

- El dueño define puntos o sellos por compra, compra mínima, qué compras cuentan, premios, vencimiento y sucursales. [Implementado]
- **Los cambios de reglas crean una versión nueva con fecha de inicio.** Los saldos existentes **no se recalculan**. [Implementado]
- **Subir el costo de un premio aplica 14 días después**, y la página de la sucursal lo anuncia. Bajarlo aplica de inmediato. [Implementado]
- Comunicar los cambios a los clientes por mensaje. [Pendiente]
- **Vencimiento:** si el programa lo define, el saldo vence tras N días (mínimo 30) **sin compras**. El cliente ve la fecha estimada en "Mis tarjetas". [Implementado; la ejecución es manual desde Administración: falta programarla automáticamente; el aviso previo está Pendiente]
- **Sucursales:** los puntos solo se comparten si el dueño las pone en el mismo programa. **Nunca se mezclan saldos de empresas distintas**, aunque sean del mismo giro. [Implementado, también protegido en la base de datos]

## 9. Contingencias

- **Resultado incierto** (la pantalla se quedó cargando): primero se **consulta el estado** de la operación por su clave; si no existe, se reintenta con **la misma clave**. Nunca se crea otra referencia para el mismo intento. [Implementado]
- **Sin internet:** se atiende la venta y se anota tarjeta, ticket, importe y hora en la **hoja de contingencia**. No se prometen los puntos como ya sumados. Al reconectar se capturan y el encargado los aplica; un ticket repetido no suma. **No hay modo fuera de línea.** [Implementado]
- **Servidor caído:** contingencia por hoja, incidente abierto, aviso a los negocios con hechos verificados. Se restaura y concilia antes de declarar la recuperación. [Procedimiento; monitoreo externo Pendiente]
- **Cambio de turno:** antes de completar algo pendiente se revisa en "Cambio de turno" su estado y quién lo inició. [Implementado]

## 10. Wallet

- Wallet es una **representación** del saldo; la autoridad es el servidor. [Implementado]
- Las actualizaciones a Wallet van en una **cola**: copian el saldo vigente y **nunca suman puntos**. Si Wallet falla, la compra ya quedó guardada y la cola reintenta. [Implementado y probado con falla simulada]
- El botón "Añadir a Google Wallet" de la demo es una **simulación etiquetada**. No crea pases reales. [Simulado]
- Integración real con Google Wallet primero, si el piloto lo justifica; Apple Wallet en fase posterior según demanda. [Pendiente; ver WALLET.md]
- Promociones y avisos son **posteriores al MVP** y dependen de permisos y límites reales. No se garantiza su recepción. [Pendiente]

## 11. Personal

- **Alta:** el dueño (o el encargado, solo para empleados) crea la cuenta con contraseña temporal que se entrega **en persona**. El empleado la cambia al entrar. [Implementado]
- **Baja inmediata** al dejar de trabajar: se revoca el acceso y se cierran sus sesiones. Su historial se conserva. [Implementado]
- **Contraseña olvidada:** el encargado asigna una temporal; mientras tanto atiende otro compañero autorizado. Nunca se envían contraseñas por chat. [Implementado]
- **Bloqueo temporal** de 15 minutos tras 5 contraseñas incorrectas. [Implementado]
- Si una cuenta trabaja también en otro negocio, solo soporte puede restablecerla. [Implementado]

## 12. Seguridad y datos

- Separación entre empresas validada en el servidor en cada consulta y operación. [Implementado]
- Sesiones guardadas en el servidor, **revocables**; cookies `httpOnly` y `SameSite=Lax`; protección por origen. [Implementado]
- **Ningún secreto en el código, el repositorio ni los registros.** Las claves van en variables de entorno del proveedor. [Implementado; `.env` está excluido del repositorio]
- **Datos mínimos:** nombre o alias y un contacto. Sin ubicación obligatoria, sin datos bancarios. [Implementado]
- El personal del negocio ve el nombre abreviado y el contacto enmascarado; la administración no ve contactos. [Implementado]
- **Publicidad separada** del uso de la tarjeta, por negocio. [Implementado]
- Solicitudes de acceso, rectificación, cancelación, oposición y baja de publicidad con folio. [Implementado el registro; respuesta: Procedimiento]
- Aviso de privacidad: **borrador sujeto a revisión legal** con la ley mexicana vigente. [Pendiente de revisión]

## 13. Negocios, categorías y pagos

- Solo se publican **negocios autorizados** por nosotros. [Implementado]
- Las categorías se agregan, renombran, ordenan y desactivan **desde Administración, sin cambiar código**. Una categoría con sucursales activas no se puede desactivar. [Implementado]
- Ubicación: se captura a mano; las coordenadas son opcionales y **no se obliga a conceder geolocalización**. [Implementado]
- Precios iniciales sujetos a validación: instalación $300–500 MXN; Básico $199 MXN/mes; Pro $349 MXN/mes. [Procedimiento]
- **Pagos registrados a mano** durante el piloto. Sin cobro automático. [Implementado el registro; cobro automático Pendiente]
- Mensualidad vencida: aviso y periodo de gracia acordado. Si se suspende, se bloquean operaciones nuevas, **sin borrar saldos**. [Implementado la suspensión; política de gracia: Procedimiento]
- Cancelación o cierre: acordar exportación de datos, aviso a clientes y premios pendientes; el negocio responde por sus premios. [Procedimiento; exportación automática Pendiente]

## 14. Soporte e incidentes

- Canal: "Soporte" en el panel del negocio. **Horario y cobertura por definir; no hay atención 24/7.** [Procedimiento]
- Prioridad: (1) no se pueden registrar compras o canjes, (2) seguridad, (3) datos, (4) dudas y cambios de diseño. [Procedimiento]
- Se informa un plazo realista; no se promete atención inmediata sin cobertura.
- Posible intrusión: contener accesos, preservar evidencia, evaluar alcance y comunicar solo hechos verificados. [Procedimiento]

## 15. Respaldos y recuperación

- La base gratis de Render **no tiene respaldos** y se borra a los 30 días (más 14 de gracia). Solo sirve para la demostración. [Pendiente para el piloto]
- Para el piloto: base de pago con respaldos y recuperación a un punto en el tiempo, y un **ensayo de restauración** antes de operar con negocios reales. [Pendiente]
- Tras restaurar: verificar integridad y conciliar movimientos posteriores al respaldo antes de reabrir. [Procedimiento]

## 16. Piloto

- Pocos negocios reales, de sectores distintos, durante un periodo definido.
- Medimos: tarjetas creadas, compras registradas, recurrencia, canjes, errores, solicitudes de soporte, tiempo de atención en mostrador y **disposición a pagar**. El interés verbal no demuestra rentabilidad.
- Al cierre se decide con cada negocio: ajustar, continuar o cancelar.

## 17. Lo que no prometemos

- Más ventas, más clientes o retorno garantizado.
- Usuarios ilimitados.
- Recepción de promociones o avisos.
- Funciones futuras (Wallet real, mensajes reales, cobro automático) como si ya existieran.
- Atención permanente sin cobertura real.
- Que la plataforma esté lista para negocios reales antes de cerrar los pendientes de la sección 15 y contratar los servicios de mensajes.
