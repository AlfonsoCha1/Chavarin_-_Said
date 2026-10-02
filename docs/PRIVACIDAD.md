# Privacidad: propuesta y procedimiento

> **Borrador sujeto a revisión legal.** No somos abogados. Antes de operar con clientes reales, un abogado debe revisar este procedimiento y el aviso de privacidad (`/privacidad`) con la ley mexicana vigente de protección de datos personales en posesión de particulares y las disposiciones de la autoridad competente.

## Datos que guarda la plataforma

| Dato | Para qué | Quién lo ve |
|---|---|---|
| Nombre o alias | Identificar al titular en el mostrador | Personal del negocio: solo nombre y la inicial del apellido |
| Celular o correo | Enviar códigos de verificación y recuperar la tarjeta | Cliente completo; negocio enmascarado (`***5678`, `a***@dominio`); administración no lo ve |
| Movimientos de la tarjeta | Saldo, historial, aclaraciones | Cliente y el negocio de esa tarjeta |
| Permiso de publicidad por negocio | Saber si se le pueden enviar promociones | Cliente y el negocio |
| Datos técnicos (IP, fecha, acción) | Seguridad y auditoría | Administración (bitácora) |

**No se piden**: ubicación en tiempo real, datos bancarios, datos sensibles, fecha de nacimiento.

## Principios aplicados en el sistema

- Datos mínimos para operar. [Implementado]
- Permiso de publicidad separado del uso de la tarjeta, desmarcado por defecto, revocable en "Mis tarjetas". [Implementado]
- El personal ve lo necesario para atender, con contacto enmascarado; la búsqueda es por número de tarjeta, no por datos personales. [Implementado]
- Cada empresa ve solo sus tarjetas. [Implementado]
- Ningún secreto en el código ni en registros. [Implementado]

## Procedimiento de solicitudes (acceso, rectificación, cancelación, oposición, baja de publicidad)

1. **Recepción**: el cliente la envía desde "Mis tarjetas → Tus datos" (queda con folio) o por el correo de privacidad que se publique.
2. **Verificación de identidad**: la solicitud desde "Mis tarjetas" ya viene de una sesión verificada con código. Por correo, se pide confirmar con un código al contacto registrado.
3. **Atención** (administración, Administración → Privacidad):
   - *Acceso*: exportar sus datos y movimientos (hoy, consulta manual a la base; exportación automática pendiente).
   - *Rectificación*: corregir nombre; el cambio de contacto verificado no tiene flujo todavía (pendiente).
   - *Cancelación*: desactivar al cliente y sus tarjetas, conservando solo lo que la ley obligue (por ejemplo, registros contables del negocio), sin borrar el historial de otros.
   - *Oposición / baja de publicidad*: marcar el permiso en falso para todos los negocios.
4. **Respuesta**: dentro del plazo que marque la ley aplicable (a confirmar con el abogado), por el contacto registrado. Registrar la respuesta en la solicitud.
5. **Negocios**: si la solicitud es sobre promociones de un negocio, avisarle para que deje de usar ese contacto.

## Incidentes de seguridad con datos

1. Contener (revocar sesiones, suspender accesos).
2. Preservar evidencia (bitácora, registros del proveedor).
3. Evaluar alcance real antes de comunicar.
4. Comunicar a negocios y titulares afectados **solo hechos verificados** y cumplir las obligaciones legales aplicables.

## Pendientes antes del piloto

- Razón social y domicilio del responsable.
- Correo de privacidad y plazo de respuesta.
- Plazo de conservación de datos.
- Acuerdo con cada negocio sobre su papel (responsable o encargado) y el uso de datos para promociones.
- Revisión legal del aviso y de este procedimiento.
