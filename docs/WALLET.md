# Google Wallet y Apple Wallet

## Estado actual

- **Tarjeta web**: funcional; es la alternativa que siempre debe existir.
- **Google Wallet**: **simulado**. El botón dice "Añadir a Google Wallet (simulación)" y registra un pase de prueba en la base; **no crea nada en el teléfono**.
- **Apple Wallet**: **pendiente**. El botón aparece deshabilitado con la leyenda "fase posterior".
- La cola de actualización (`wallet_sync_jobs`) sí está implementada: copia el saldo vigente del servidor al pase y **nunca suma puntos**. Una falla de Wallet no afecta la compra (prueba T11).

## Google Wallet API — lo que dice la documentación oficial

Consultado el 1 de octubre de 2026.

**Cuentas y permisos**

- Se necesita una **cuenta de emisor (Issuer) en Google Pay & Wallet Console**. Al crearla se obtiene un Issuer ID y el rol de administrador.
- Las cuentas nuevas empiezan en **modo demo**: se pueden crear pases, pero solo los pueden guardar usuarios con rol de administrador o desarrollador del emisor, o cuentas agregadas como prueba. Los pases llevan la marca "[TEST ONLY]".
- Para publicar a cualquier cliente hay que **solicitar acceso de publicación**: completar el **perfil del negocio** (para verificar que el emisor es real) y tener **al menos una clase de pase** creada. El equipo de Google Wallet revisa y avisa cuando aprueba. La documentación no indica plazos ni tarifas.

**Implementación prevista (cuando haya credenciales)**

1. Crear un proyecto de Google Cloud, habilitar la API de Google Wallet y una **cuenta de servicio**; su llave privada va en una variable de entorno, nunca en el repositorio.
2. Una **clase de lealtad** por programa (nombre del negocio, logotipo, color) y un **objeto de lealtad** por tarjeta (número de tarjeta, código QR con la URL `/c/<código>`, saldo).
3. El botón "Añadir a Google Wallet" se genera como un enlace firmado (JWT) desde el servidor.
4. Al cambiar el saldo, la cola existente llama a la API para actualizar el objeto con el **saldo vigente**. Reintentar es seguro porque se copia el valor, no se suma.
5. Si la API falla, la compra ya quedó guardada; la cola reintenta y el cliente puede usar la tarjeta web.

**Riesgos y límites a validar antes de prometerlo**

- Aprobación de publicación (tiempo y requisitos de Google).
- Cuotas de la API y cómo se reflejan las actualizaciones en el teléfono (no son instantáneas garantizadas).
- Dispositivos sin Google Wallet: se usa la tarjeta web.

## Apple Wallet — lo que dice la documentación oficial

- Se necesita membresía del **Apple Developer Program** (cuota anual; verificar el precio vigente en la página de Apple) y un **certificado de Pass Type ID** para firmar los pases (`.pkpass`).
- Para que un pase se actualice, el pase incluye `webServiceURL` y `authenticationToken`. El servidor debe implementar los servicios para **registrar y dar de baja dispositivos, listar pases actualizados y entregar el pase nuevo**, y enviar una **notificación push (APNs)** firmada con el mismo certificado cuando cambie el saldo.
- El servicio web debe usar **HTTPS en producción**, y las notificaciones de actualización de pases **solo funcionan en el entorno de producción**.

Implica más trabajo que Google Wallet (firmado de pases, servicio de registro de dispositivos y push). Por eso queda para una fase posterior **solo si el piloto muestra demanda** (por ejemplo, porcentaje alto de clientes con iPhone que no usan la tarjeta web).

## Decisión propuesta

1. Piloto con **tarjeta web + impresa**.
2. Si los negocios y clientes lo piden, abrir cuenta de emisor de Google Wallet, probar en modo demo con los socios y solicitar publicación.
3. Apple Wallet después, según demanda medida.
4. Promociones y avisos por Wallet: posteriores al MVP, sujetos a permisos y límites reales; nunca se garantiza su recepción.

## Fuentes

- [Setting up a Google Wallet API Issuer account](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding)
- [Requesting publishing access (Google Wallet)](https://developers.google.com/wallet/generic/getting-started/request-publishing-access)
- [Adding a Web Service to Update Passes (Apple)](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes)
