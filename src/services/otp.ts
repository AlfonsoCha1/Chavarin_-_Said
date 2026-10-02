import type pg from 'pg';
import { getPool, one, type Db } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { newOtp, sha256 } from '../lib/security.js';
import { sendMessage, type Channel } from '../lib/messaging.js';

export type OtpPurpose = 'register' | 'login' | 'redeem' | 'holder';

// Normaliza teléfono mexicano a +52 y 10 dígitos; correo a minúsculas.
export function normalizeContact(type: 'phone' | 'email', value: string): string {
  if (type === 'email') {
    const v = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw new AppError(400, 'INVALID_EMAIL', 'El correo no parece válido.');
    return v;
  }
  let d = value.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  if (d.length !== 10) throw new AppError(400, 'INVALID_PHONE', 'El teléfono debe tener 10 dígitos.');
  return `+52${d}`;
}

const hashCode = (destination: string, code: string) => sha256(`${destination}:${code}`);

const purposeText: Record<OtpPurpose, string> = {
  register: 'confirmar tu tarjeta de lealtad',
  login: 'entrar a Mis tarjetas',
  redeem: 'autorizar el canje de un premio',
  holder: 'confirmar que eres titular de la tarjeta',
};

export async function issueOtp(
  db: Db,
  o: { purpose: OtpPurpose; channel: Channel; destination: string; customerId?: string | null; cardId?: string | null; payload?: unknown },
) {
  const recent = await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM otp_codes WHERE destination = $1 AND created_at > now() - interval '15 minutes'`,
    [o.destination],
  );
  if ((recent?.n ?? 0) >= config.otpMaxPerWindow) {
    throw new AppError(429, 'OTP_RATE_LIMIT', 'Se pidieron demasiados códigos para este contacto. Espera 15 minutos e inténtalo de nuevo.');
  }
  const code = newOtp();
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO otp_codes(purpose, channel, destination, customer_id, card_id, payload, code_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' minutes')::interval) RETURNING id`,
    [o.purpose, o.channel, o.destination, o.customerId ?? null, o.cardId ?? null, o.payload ?? null, hashCode(o.destination, code), String(config.otpMinutes)],
  );
  await sendMessage(
    db,
    o.channel,
    o.destination,
    'Tu código de verificación',
    `Tu código para ${purposeText[o.purpose]} es ${code}. Vence en ${config.otpMinutes} minutos. Nadie del negocio te lo pedirá por teléfono.`,
  );
  return { otpId: row!.id };
}

// Verifica el código con su propia conexión para que los intentos fallidos queden registrados
// aunque la operación principal se revierta. Devuelve el registro; se consume después con consumeOtp.
export async function checkOtp(o: { purpose: OtpPurpose; code: string; otpId?: string; destination?: string; cardId?: string }) {
  const pool = getPool();
  const conds = ['purpose = $1', 'consumed_at IS NULL'];
  const params: unknown[] = [o.purpose];
  if (o.otpId) { params.push(o.otpId); conds.push(`id = $${params.length}`); }
  if (o.destination) { params.push(o.destination); conds.push(`destination = $${params.length}`); }
  if (o.cardId) { params.push(o.cardId); conds.push(`card_id = $${params.length}`); }
  const otp = await one<any>(pool, `SELECT * FROM otp_codes WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT 1`, params);
  if (!otp) throw new AppError(400, 'OTP_NOT_FOUND', 'No hay un código vigente. Pide uno nuevo.');
  if (new Date(otp.expires_at) < new Date()) throw new AppError(400, 'OTP_EXPIRED', 'El código venció. Pide uno nuevo.');
  if (otp.attempts >= config.otpMaxAttempts) throw new AppError(429, 'OTP_LOCKED', 'Demasiados intentos con este código. Pide uno nuevo.');
  if (hashCode(otp.destination, String(o.code).trim()) !== otp.code_hash) {
    await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    throw new AppError(400, 'OTP_INVALID', 'El código no coincide.');
  }
  return otp;
}

export async function consumeOtp(c: pg.PoolClient, id: string) {
  const r = await c.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [id]);
  if (r.rowCount !== 1) throw new AppError(409, 'OTP_USED', 'Este código ya se usó. Pide uno nuevo.');
}

export function maskDestination(dest: string) {
  if (dest.includes('@')) {
    const [u, d] = dest.split('@');
    return `${u.slice(0, 1)}***@${d}`;
  }
  return `***${dest.slice(-4)}`;
}
