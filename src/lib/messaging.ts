import type { Db } from '../db.js';
import { config } from '../config.js';

export type Channel = 'sms' | 'whatsapp' | 'email';

// Adaptador de mensajería. Hoy solo existe "simulated": NO envía nada,
// guarda el mensaje en outbox_messages para verlo en el buzón de la demostración.
// Para producción se debe implementar un proveedor real (SMS/WhatsApp/correo) con sus costos y permisos.
export async function sendMessage(db: Db, channel: Channel, destination: string, subject: string, body: string) {
  if (config.messagingProvider !== 'simulated') {
    throw new Error(`Proveedor de mensajería "${config.messagingProvider}" no implementado`);
  }
  await db.query(
    `INSERT INTO outbox_messages(channel, destination, subject, body, provider, status) VALUES ($1,$2,$3,$4,'simulated','simulated')`,
    [channel, destination, subject, body],
  );
  return { delivered: false, simulated: true };
}

export function integrationStatus() {
  return {
    sms: config.messagingProvider === 'simulated' ? 'simulado' : 'no implementado',
    whatsapp: config.messagingProvider === 'simulated' ? 'simulado' : 'no implementado',
    email: config.messagingProvider === 'simulated' ? 'simulado' : 'no implementado',
  };
}
