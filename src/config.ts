import { readFileSync, existsSync } from 'node:fs';

// Carga .env sin dependencias externas (solo variables que aún no existan en el entorno).
function loadDotEnv() {
  const path = new URL('../.env', import.meta.url);
  const alt = new URL('../../.env', import.meta.url); // cuando corre desde dist/src
  const file = existsSync(path) ? path : existsSync(alt) ? alt : null;
  if (!file) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadDotEnv();

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  console.error('FALTA DATABASE_URL: en Render copia la "Internal Database URL" de la base y agrégala en Environment del servicio.');
  process.exit(1);
}

const bool = (v: string | undefined, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://lealtad:lealtad_local@localhost:5432/lealtad',
  databaseSsl: bool(process.env.DATABASE_SSL),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  // En Render, RENDER_EXTERNAL_URL existe automáticamente (https://<servicio>.onrender.com).
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, ''),
  demoMode: bool(process.env.DEMO_MODE, true),
  seedDemoOnEmpty: bool(process.env.SEED_DEMO_ON_EMPTY, false),
  messagingProvider: process.env.MESSAGING_PROVIDER ?? 'simulated',
  walletProvider: process.env.WALLET_PROVIDER ?? 'simulated',
  keepaliveUrl:
    process.env.KEEPALIVE_URL ||
    (bool(process.env.KEEPALIVE_ENABLED) && process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/health` : ''),
  keepaliveMinutes: Number(process.env.KEEPALIVE_MINUTES ?? 10),
  // Horario (hora CDMX) en que el despertador mantiene despierto el servicio, p. ej. "8-22". Vacío = todo el día.
  keepaliveHours: process.env.KEEPALIVE_HOURS ?? '',
  isProduction: process.env.NODE_ENV === 'production',
  timezone: 'America/Mexico_City',
  // Reglas operativas configurables
  otpMinutes: 10,
  otpMaxAttempts: 5,
  otpMaxPerWindow: 3,
  staffSessionHours: 12,
  customerSessionDays: 30,
  loginMaxFailures: 5,
  loginLockMinutes: 15,
  rewardCostNoticeDays: 14,
  possibleDuplicateMinutes: 3,
};
