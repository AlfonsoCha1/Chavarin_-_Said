import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash, randomInt } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const newOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// Código de tarjeta: sin letras ambiguas (0/O, 1/I/L).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function newCardCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
  return `C-${s}`;
}

export function normalizeCardCode(input: string): string {
  let s = input.trim().toUpperCase();
  // Acepta el contenido del QR (URL .../c/C-XXXX) o el número escrito a mano.
  const m = s.match(/\/C\/(C-[A-Z0-9]+)\/?$/);
  if (m) s = m[1];
  s = s.replace(/\s+/g, '');
  if (!s.startsWith('C-') && /^C?[A-Z0-9]{3,8}$/.test(s)) s = 'C-' + s.replace(/^C/, '');
  return s;
}
