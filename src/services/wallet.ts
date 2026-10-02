import type pg from 'pg';
import { getPool, q, one, type Db } from '../db.js';
import { config } from '../config.js';

// Wallet es solo una representación del saldo. La autoridad es el servidor.
// Hoy solo existe un adaptador SIMULADO. Google/Apple requieren credenciales y aprobación (ver docs/WALLET.md).
interface WalletAdapter {
  mode: 'simulated' | 'live';
  pushBalance(db: Db, cardId: string, provider: string, balance: number): Promise<void>;
}

const simulatedAdapter: WalletAdapter = {
  mode: 'simulated',
  async pushBalance(db, cardId, provider, balance) {
    const s = await one<{ value: any }>(db, `SELECT value FROM settings WHERE key = 'wallet_simulate_failure'`);
    if (s?.value === true) throw new Error('Fallo simulado del proveedor de Wallet (activado desde el panel de administración)');
    await db.query(
      `UPDATE wallet_passes SET displayed_balance = $3, last_synced_at = now() WHERE card_id = $1 AND provider = $2`,
      [cardId, provider, balance],
    );
  },
};

export function walletAdapter(): WalletAdapter {
  if (config.walletProvider !== 'simulated') throw new Error(`Proveedor Wallet "${config.walletProvider}" no implementado`);
  return simulatedAdapter;
}

// Se llama dentro de la misma transacción que la compra/canje: si la compra se guarda, la tarea también.
export async function enqueueWalletSync(c: pg.PoolClient, cardId: string) {
  await c.query(
    `INSERT INTO wallet_sync_jobs(card_id, provider)
     SELECT card_id, provider FROM wallet_passes WHERE card_id = $1`,
    [cardId],
  );
}

// Procesa la cola. Copia el saldo VIGENTE del servidor; nunca suma ni resta puntos.
export async function processWalletJobs(limit = 25) {
  const pool = getPool();
  const adapter = walletAdapter();
  const jobs = await q<any>(
    pool,
    `SELECT id, card_id, provider FROM wallet_sync_jobs
     WHERE status = 'pending' OR (status = 'failed' AND attempts < 5)
     ORDER BY id LIMIT $1`,
    [limit],
  );
  let done = 0;
  let failed = 0;
  for (const j of jobs) {
    const card = await one<{ balance: number }>(pool, 'SELECT balance FROM cards WHERE id = $1', [j.card_id]);
    try {
      await adapter.pushBalance(pool, j.card_id, j.provider, card!.balance);
      await pool.query(`UPDATE wallet_sync_jobs SET status='done', attempts=attempts+1, synced_balance=$2, last_error=NULL, updated_at=now() WHERE id=$1`, [j.id, card!.balance]);
      done++;
    } catch (e: any) {
      await pool.query(`UPDATE wallet_sync_jobs SET status='failed', attempts=attempts+1, last_error=$2, updated_at=now() WHERE id=$1`, [j.id, String(e.message).slice(0, 300)]);
      failed++;
    }
  }
  return { processed: jobs.length, done, failed };
}

export function walletStatus() {
  return {
    google: config.walletProvider === 'simulated' ? 'simulado (sin credenciales de Google Wallet API)' : 'no implementado',
    apple: 'pendiente (fase posterior; requiere Apple Developer Program y certificado Pass Type ID)',
  };
}
