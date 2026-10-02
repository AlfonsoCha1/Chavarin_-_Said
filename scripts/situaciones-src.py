# Fuente única del documento de situaciones. Genera public/data/situaciones.json.
import json
S = []
def c(titulo, situacion, pantalla, respuesta, responsable, prevencion, estado, detalle, prueba=''):
    S.append(dict(id=len(S)+1, titulo=titulo, situacion=situacion, pantalla=pantalla, respuesta=respuesta,
                  responsable=responsable, prevencion=prevencion, estado=estado, estado_detalle=detalle, prueba=prueba))

c('Compra con QR', 'El cliente muestra la tarjeta C-104 con 30 puntos y compra algo elegible.',
  'Panel del empleado › Mostrador: Identificar tarjeta → Confirmar compra.',
  'El empleado escanea o escribe el número, captura el ticket y confirma. Se registra +10 y el saldo queda en 40, con referencia de ticket, empleado, sucursal y versión de regla.',
  'Empleado', 'Permisos validados en el servidor por negocio y sucursal; cada compra exige referencia de ticket y clave de operación única.',
  'implementado', 'Implementado y probado.', 'T05 compra y canje normales')
c('Sin cámara o QR no se lee por cámara', 'El celular del mostrador no tiene cámara útil o el navegador no da permiso; el cliente muestra el número C-104.',
  'Panel del empleado › Mostrador: campo "Número de tarjeta".',
  'Captura manual del número. El sistema muestra la tarjeta encontrada; los puntos se suman solo al confirmar la compra.',
  'Empleado', 'El número legible acompaña siempre al QR. La búsqueda es por número, no por datos personales. La cámara solo funciona en https; en http se avisa y se usa el número.',
  'implementado', 'Implementado. La lectura con cámara usa la librería jsQR y no se probó con hardware real en este entorno.', 'T17 identificar no suma')
c('Cliente nuevo', 'El cliente pide su primera tarjeta en el mostrador.',
  'QR del mostrador → página /r/(código de la sucursal): nombre, contacto, aviso de privacidad, permiso de publicidad opcional, código de verificación.',
  'Se crea la tarjeta con 0 puntos tras verificar el código enviado al contacto. La compra se registra después, por separado, desde el panel del empleado.',
  'Empleado (orienta) y cliente', 'Registrarse no equivale a comprar. La publicidad tiene su propia casilla, desmarcada por defecto. Si el contacto ya tenía tarjeta en ese programa, se muestra la misma y no se crea otra.',
  'parcial', 'Registro y verificación implementados; el envío del código está SIMULADO (buzón demo) hasta contratar proveedor de SMS/WhatsApp/correo.', 'T16 registro con código')
c('Cliente sin celular', 'El cliente presenta la tarjeta impresa C-106.',
  'Panel del empleado › Tarjeta impresa (emitir) y Mostrador (consultar con el número).',
  'Se lee el QR impreso o se escribe el número. El saldo se muestra en el panel; se registra la compra y se informa al cliente.',
  'Empleado', 'El papel solo identifica; el saldo vive en el servidor. Al emitirla se avisa que, sin contacto registrado, funciona al portador y no se puede reponer.',
  'implementado', 'Implementado (emisión, impresión y uso). Vincular un contacto a una tarjeta impresa ya emitida queda pendiente.', 'T17 identificar no suma')
c('QR ilegible', 'Pantalla dañada o impresión borrosa.',
  'Panel del empleado › Mostrador: captura manual.',
  'Usar el número de tarjeta. Si tampoco se puede, el cliente entra a "Mis tarjetas" con su código (recuperación) para ver el número. Nunca se crea otra tarjeta para improvisar un saldo.',
  'Empleado', 'Número legible junto al QR; una tarjeta activa por cliente y programa (restricción en base de datos).',
  'implementado', 'Implementado.', '')
c('Tarjeta perdida o cambio de celular', 'El cliente cambió de celular o perdió el papel.',
  'Cliente: Mis tarjetas → entrar con código. Encargado: Panel del negocio › Tarjetas y ajustes › Reponer tarjeta.',
  'Si tiene tarjeta web, entra con un código a su contacto y la vuelve a ver (no hace falta reponer). Si se copió o se perdió el código impreso, el encargado envía un código al titular y repone con número nuevo; el anterior deja de funcionar y el saldo se transfiere con historial. Sin contacto verificable, se escala y no se repone.',
  'Encargado', 'Recuperación definida antes del alta: contacto verificado al registrarse. El QR no acredita identidad.',
  'parcial', 'Implementado; el envío del código está SIMULADO.', 'T23 reposición con código')
c('Solicitud de puntos sin compra', 'El cliente pide puntos solo mostrando su QR.',
  'Panel del empleado › Mostrador.',
  'Saldo sin cambios. Se explica que mostrar el QR no genera puntos: solo una compra confirmada con ticket.',
  'Empleado', 'Consultar tarjeta y registrar compra son acciones separadas; la consulta no escribe nada.',
  'implementado', 'Implementado y probado.', 'T17 identificar no suma')
c('QR compartido', 'Dos personas presentan la misma tarjeta.',
  'Panel del empleado › Mostrador (titular abreviado) y ajustes del programa.',
  'La tarjeta es personal. Si el programa exige verificación al canjear, se envía un código al titular; sin el código no se canjea. Sumar compras con la misma tarjeta no se bloquea, pero cuenta para el límite diario y las alertas.',
  'Encargado', 'Tarjeta personal por política. Un QR estático puede copiarse: por eso existe la verificación por código al canjear (configurable por programa) y el límite de compras por día.',
  'parcial', 'Implementado; el código de verificación se envía de forma SIMULADA. Un QR dinámico que cambie cada minuto queda pendiente.', 'T24 verificación al canjear')
c('Compra duplicada', 'El cliente o el empleado reintenta el mismo ticket T-208.',
  'Panel del empleado › Mostrador: mensaje "Ticket ya registrado".',
  'Se muestra la operación existente y no se suma nuevamente.',
  'Sistema', 'Índice único por sucursal y referencia de ticket, y clave de operación única. Si el mismo ticket llega dos veces al mismo tiempo, la base de datos solo acepta una.',
  'implementado', 'Implementado y probado, incluso con envíos simultáneos.', 'T07 compra duplicada')
c('Respuesta interrumpida', 'El botón quedó cargando después de confirmar; no se sabe si la compra se guardó.',
  'Panel del empleado › Mostrador: aviso "No sabemos si se guardó" con "Consultar estado" y "Reintentar (misma clave)".',
  'Consultar la referencia original antes de reintentar. Si existe, no se repite; si no existe, se reintenta con la MISMA clave. Nunca se genera una referencia nueva para el mismo intento.',
  'Empleado y soporte', 'Operaciones idempotentes y estado consultable por clave. La clave pendiente se guarda en el navegador mientras la pestaña siga abierta.',
  'implementado', 'Implementado y probado (reenvío con la misma clave devuelve el resultado original).', 'T30 estado de operación')
c('Saldo de Wallet desactualizado', 'Wallet muestra 30; el servidor registra 40.',
  'Mis tarjetas (saldo del servidor) y Administración › Integraciones (cola de Wallet).',
  'Vale el saldo confirmado del servidor. La cola reintenta copiar el saldo vigente al pase, sin volver a sumar puntos.',
  'Soporte', 'Cola de actualizaciones: cada tarea copia el saldo actual, no suma. Tarjeta web siempre disponible.',
  'simulado', 'La cola y su reintento están implementados y probados; el pase de Wallet es SIMULADO (no hay integración real con Google ni Apple).', 'T11 fallo de Wallet')
c('Puntos incorrectos', 'Una compra recibió 100 en lugar de 10.',
  'Panel del negocio › Tarjetas y ajustes › Ajuste autorizado.',
  'El encargado registra un ajuste de −90 con motivo y referencia al movimiento original; la operación original se conserva.',
  'Encargado', 'Solo encargado o dueño ajustan; motivo obligatorio; límite de ±1000 por ajuste; historial que no se puede editar ni borrar; alertas por muchos ajustes.',
  'implementado', 'Implementado y probado.', 'T09 ajustes auditados')
c('Devolución o reembolso', 'El cliente devuelve una compra que dio puntos.',
  'Panel del negocio › Compras › Devolución.',
  'Se revierten los puntos de esa compra. Si ya se gastaron, se revierte lo que haya y se abre un caso con lo faltante para resolverlo con la política del negocio; no se improvisan cobros.',
  'Encargado', 'Devolución enlazada a la compra original; el saldo nunca queda negativo.',
  'implementado', 'Implementado y probado. La política de qué hacer con puntos ya gastados la define cada negocio (procedimiento).', 'T13 devolución')
c('Canje normal', 'Saldo 50; el premio cuesta 50.',
  'Panel del empleado › Mostrador › Canjear premio.',
  'Se crea un único canje y se descuentan 50 en una sola operación. El empleado entrega el premio y lo marca como entregado.',
  'Empleado', 'Canje atómico en el servidor con bloqueo de la tarjeta; estado de entrega registrado.',
  'implementado', 'Implementado y probado.', 'T05 compra y canje normales')
c('Doble canje', 'Dos empleados intentan gastar los mismos 50 puntos al mismo tiempo.',
  'Panel del empleado (dos dispositivos).',
  'Solo un canje se confirma. El segundo recibe "Saldo insuficiente" con el saldo actualizado y no entrega otro premio.',
  'Sistema', 'Transacción con bloqueo de la fila de la tarjeta y restricción de saldo no negativo en la base de datos.',
  'implementado', 'Implementado y probado con 10 canjes simultáneos.', 'T08 canjes concurrentes')
c('Premio agotado', 'No hay producto disponible para entregar.',
  'Panel del empleado › Canjear (botón "Agotado") y Panel del negocio › Programa (existencias).',
  'No se descuentan puntos. El encargado ofrece otro premio del catálogo o el cliente canjea después.',
  'Encargado', 'Existencias por premio; el servidor rechaza el canje sin descontar si llegan a cero.',
  'implementado', 'Implementado y probado.', 'T12 premio agotado')
c('Entrega dudosa', 'Se descontaron puntos pero el cliente dice que no recibió el premio.',
  'Panel del negocio › Canjes › Abrir revisión → "Sí se entregó" o "Reponer puntos".',
  'Se revisa con empleado y encargado. Si procede, se reponen los puntos con autorización y registro, sin generar un segundo canje automático.',
  'Encargado', 'Estado de entrega, revisión y corrección auditada.',
  'implementado', 'Implementado y probado.', 'T09 ajustes auditados')
c('Puntos vencidos', 'El cliente reclama un saldo que venció.',
  'Panel del negocio › Tarjetas y ajustes (historial con el movimiento "Vencimiento").',
  'Se explica con las reglas mostradas y las fechas del historial. Si hubo error o regla ambigua, se escala antes de negar y se puede reponer con ajuste autorizado.',
  'Encargado', 'Reglas visibles en la página de la sucursal y en Mis tarjetas, con la fecha estimada de vencimiento.',
  'parcial', 'Vencimiento implementado y probado; se ejecuta con un botón de Administración (falta programarlo automático). El aviso previo al cliente está PENDIENTE (depende de mensajería real).', 'T21 vencimiento')
c('Cambio de reglas', 'Hay clientes con puntos y el dueño quiere subir el premio de 50 a 100.',
  'Panel del negocio › Programa y premios.',
  'Las reglas nuevas se programan con fecha; los saldos no se recalculan. Subir el costo de un premio aplica 14 días después y se muestra el aviso en la página de la sucursal.',
  'Dueño', 'Reglas versionadas; cada compra guarda la versión aplicada; aviso visible antes de aplicar.',
  'implementado', 'Implementado y probado. Comunicar el cambio a los clientes por mensaje queda PENDIENTE.', 'T20 cambio de reglas')
c('Sin internet', 'No se puede consultar saldo.',
  'Panel del empleado › Sin internet (hoja imprimible y captura posterior); Panel del negocio › Contingencia.',
  'Se atiende la venta y se anotan tarjeta, ticket, importe y hora en la hoja. Al reconectar se capturan; el encargado aplica o rechaza. Se suspenden los canjes que no puedan verificarse.',
  'Empleado y encargado', 'Conciliación por ticket sin duplicados. No hay modo fuera de línea y no se promete.',
  'implementado', 'Implementado y probado (un ticket repetido no suma dos veces).', 'T15 contingencia')
c('Servidor caído', 'Compras y canjes no se confirman; varios negocios no pueden entrar.',
  'Panel del empleado (aviso de resultado incierto); Administración › Incidentes; /api/health.',
  'Activar contingencia por hoja, abrir incidente y comunicar el estado. Restaurar y conciliar antes de declarar la recuperación.',
  'Chavarín & Said', 'Punto de salud /api/health; procedimiento de incidentes; responsable de guardia.',
  'procedimiento', 'Procedimiento definido. El monitoreo externo y el responsable de guardia están PENDIENTES; en Render gratis no hay monitoreo con alertas incluido.', '')
c('Wallet no disponible', 'El cliente no puede añadir la tarjeta a Wallet.',
  'Mis tarjetas.',
  'Ofrecer la tarjeta web o la impresa. Registrar el fallo para soporte; el saldo no cambia por cambiar de formato.',
  'Empleado y soporte', 'Mismo identificador y saldo en todas las alternativas; la tarjeta web siempre funciona.',
  'simulado', 'El botón de Google Wallet es una SIMULACIÓN etiquetada; Apple Wallet está marcado como fase posterior.', '')
c('Contraseña olvidada (empleado)', 'Un empleado no recuerda su contraseña.',
  'Panel del negocio › Empleados › Contraseña temporal; pantalla Entrar.',
  'El encargado o dueño asigna una contraseña temporal que se entrega en persona y se cambia al entrar. Mientras tanto otro empleado autorizado atiende.',
  'Empleado y encargado', 'Cuentas individuales; no se comparten ni se envían contraseñas por chat; bloqueo temporal tras 5 intentos fallidos. Si la cuenta también es de otro negocio, solo soporte puede recuperarla.',
  'implementado', 'Implementado. La recuperación por correo del propio empleado queda PENDIENTE.', 'T28 bloqueo de acceso')
c('Empleado se retira', 'Un exempleado conserva acceso.',
  'Panel del negocio › Empleados › Revocar acceso.',
  'Se revoca la membresía y se cierran sus sesiones de inmediato. Se conserva la auditoría; si hay indicios de abuso, se revisa su actividad.',
  'Encargado', 'Baja inmediata; el permiso se revisa en cada petición, no solo al entrar.',
  'implementado', 'Implementado y probado.', 'T10 revocación de empleados')
c('Abuso de puntos', 'Un empleado genera compras ficticias.',
  'Panel del negocio › Resumen › Alertas; Bitácora.',
  'Revisar la evidencia (tickets, horarios, tarjetas). Restringir la cuenta si corresponde y corregir con autorización. Una alerta no es una acusación.',
  'Dueño y soporte', 'Referencia de ticket obligatoria, límite diario por tarjeta, alertas por ráfagas de compras o ajustes, historial inmutable.',
  'implementado', 'Implementado (alertas simples basadas en reglas, sin aprendizaje automático).', 'T19 límite diario')
c('Negocio equivocado', 'Un empleado intenta acceder a la tarjeta de otro negocio.',
  'Panel del empleado.',
  'Acceso rechazado sin revelar datos de otro negocio: responde igual que si la tarjeta no existiera.',
  'Sistema', 'Aislamiento validado en el servidor en cada consulta y operación, no solo en pantalla. Una base de datos impide unir sucursales y programas de empresas distintas.',
  'implementado', 'Implementado y probado.', 'T04 separación entre empresas')
c('Datos o publicidad', 'El cliente pide dejar de recibir promociones o gestionar sus datos.',
  'Mis tarjetas › Promociones de este negocio y Tus datos; Administración › Privacidad.',
  'La publicidad se desactiva por negocio sin afectar la tarjeta. Las solicitudes de datos se registran con folio y se canalizan al responsable.',
  'Dueño y Chavarín & Said', 'Permisos de publicidad separados del uso de la tarjeta; proceso de solicitudes con folio.',
  'parcial', 'Implementado el registro y el seguimiento. El aviso de privacidad es un BORRADOR sujeto a revisión legal y el envío de promociones no existe todavía.', 'T29 publicidad separada')
c('Posible intrusión', 'Se observan accesos o movimientos sospechosos.',
  'Administración › Incidentes y Bitácora; Panel del negocio › Bitácora.',
  'Contener accesos (revocar sesiones, suspender negocio si hace falta), preservar evidencia y evaluar alcance. Comunicar solo hechos verificados y cumplir obligaciones aplicables.',
  'Chavarín & Said', 'Accesos por rol, sesiones revocables, bitácora que no se puede editar, secretos fuera del código.',
  'procedimiento', 'Controles técnicos implementados; el plan de respuesta es un procedimiento. No hay detección automática de intrusiones.', '')
c('Mensualidad pendiente', 'El negocio no pagó la suscripción.',
  'Administración › Suscripciones y pagos; Negocios.',
  'Avisar al dueño y aplicar las condiciones acordadas (periodo de gracia). Si se suspende, se bloquean operaciones nuevas pero no se borran saldos ni se sorprende a los clientes.',
  'Chavarín & Said', 'Registro manual de pagos, estado de suscripción y suspensión explícita.',
  'implementado', 'Implementado de forma manual (sin cobro automático). La suspensión bloquea operaciones y conserva saldos (probado).', 'T26 negocio suspendido')
c('Negocio cancela o cierra', 'Existen tarjetas y premios pendientes.',
  'Administración › Negocios (cancelar).',
  'Acordar exportación, aviso a clientes y tratamiento de premios pendientes. El negocio responde por sus premios según lo acordado.',
  'Dueño y Chavarín & Said', 'Plan de salida y conservación o eliminación de datos.',
  'procedimiento', 'El estado "cancelado" existe; la exportación automática de datos está PENDIENTE (hoy se haría con consulta a la base).', '')
c('Restauración de respaldo', 'Un fallo obliga a restaurar la base de datos.',
  'Fuera de la aplicación (proveedor de base de datos) y Administración › Incidentes.',
  'Restaurar en un entorno controlado, verificar integridad y conciliar los movimientos posteriores al respaldo antes de reabrir.',
  'Chavarín & Said', 'Pruebas de restauración y objetivos de recuperación definidos.',
  'pendiente', 'PENDIENTE: la base gratis de Render no tiene respaldos. Con plan de pago hay respaldo y recuperación a un punto en el tiempo; falta ensayar la restauración.', '')
c('Soporte saturado', 'Muchos locales piden ayuda a la vez.',
  'Panel del negocio › Soporte; Administración › Incidentes (ordenados por prioridad).',
  'Clasificar: caídas y canjes bloqueados primero, cambios de diseño después. Asignar responsable y dar un plazo realista.',
  'Chavarín & Said', 'Horario, alcance, canal y responsable de soporte publicados.',
  'procedimiento', 'El registro y la priorización están implementados; horario y cobertura de soporte están por definir. No hay atención 24/7.', '')
c('Cambio de turno', 'Otro empleado continúa una atención con una operación pendiente.',
  'Panel del empleado › Cambio de turno.',
  'Consultar el estado y quién la inició antes de completar. No repetir la compra ni el premio.',
  'Encargado', 'Estados claros (sin entregar, en revisión) e historial visible al personal autorizado.',
  'implementado', 'Implementado.', '')
c('Compra en otra sucursal', 'El cliente quiere usar sus puntos en otro local.',
  'Panel del empleado (aviso "no aplica en esta sucursal") y página de la sucursal.',
  'Se acepta solo si el programa es común a ambas sucursales. Si no, se informa antes de cobrar.',
  'Empleado', 'Programa por negocio o grupo de sucursales; los saldos nunca se mezclan entre empresas.',
  'implementado', 'Implementado y probado (programa común y programas separados).', 'T18 otra sucursal')
c('Cuenta duplicada', 'El cliente tiene dos tarjetas con puntos y pide combinarlas.',
  'Panel del negocio › Tarjetas y ajustes › Unir dos tarjetas.',
  'Verificar el control de ambas (mismo titular o código al titular) y unir con auditoría: el saldo pasa a la que se conserva y la otra queda inválida.',
  'Encargado y soporte', 'Proceso de fusión que mueve el saldo una sola vez con movimientos enlazados.',
  'implementado', 'Implementado y probado.', 'T22 fusión')
c('Negocio no percibe beneficio', 'El dueño dice que no ve resultados.',
  'Panel del negocio › Resumen (compras registradas, recurrencia, canjes).',
  'Comparar periodos con contexto, revisar uso, costo de premios y soporte, entrevistar empleados y decidir ajustar, continuar o cancelar. No se atribuye toda compra al sistema.',
  'Dueño y Chavarín & Said', 'Métricas de uso basadas en compras registradas; sin garantía de más ventas.',
  'implementado', 'Métricas implementadas. La evaluación del piloto es un procedimiento.', '')
# --- casos adicionales del brief ---
c('Saldo insuficiente', 'El cliente quiere un premio de 50 y tiene 40.',
  'Panel del empleado › Canjear (botón "Faltan 10").',
  'El servidor rechaza el canje sin descontar nada y muestra cuánto falta.',
  'Sistema', 'Validación en servidor y restricción de saldo no negativo en la base de datos.',
  'implementado', 'Implementado y probado.', 'T06 saldo insuficiente')
c('Negocio pendiente de aprobación', 'Un negocio se registró pero aún no lo revisamos.',
  'Administración › Negocios; Panel del negocio (aviso).',
  'No aparece en el directorio ni puede registrar compras hasta aprobarse. Mientras tanto puede configurar empleados y premios.',
  'Chavarín & Said', 'Solo se publican negocios autorizados.',
  'implementado', 'Implementado y probado.', 'T01 categorías y búsqueda')
c('Cliente perdió acceso a su contacto', 'El cliente ya no tiene el número o correo con que se registró.',
  'Soporte (fuera de la aplicación).',
  'Sin un método verificable no se transfiere el saldo. Se escala con el encargado y soporte; puede crearse una tarjeta nueva con 0 puntos.',
  'Encargado y soporte', 'Se recomienda al cliente mantener actualizado su contacto.',
  'pendiente', 'PENDIENTE: no existe flujo para cambiar el contacto verificado. Procedimiento manual con revisión.', '')
c('Intento de operación desde otro sitio web', 'Una página maliciosa intenta enviar una compra usando la sesión abierta del empleado.',
  'Ninguna (protección del servidor).',
  'El servidor rechaza peticiones que no sean JSON o vengan de otro origen.',
  'Sistema', 'Cookies de sesión httpOnly y SameSite=Lax, verificación de origen y de tipo de contenido.',
  'implementado', 'Implementado y probado.', 'T27 protección de origen')

json.dump({'version': '2026-10-01', 'nota': 'No cubre todos los incidentes posibles ni promete resolverlos al instante.', 'situaciones': S},
          open('public/data/situaciones.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(S), 'situaciones')
