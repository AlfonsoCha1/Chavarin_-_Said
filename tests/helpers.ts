// Las pruebas usan una base SEPARADA (TEST_DATABASE_URL) que se borra y recarga con datos ficticios.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://lealtad:lealtad_local@localhost:5432/lealtad_test';
process.env.DEMO_MODE = 'true';
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
process.env.KEEPALIVE_URL = '';

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

export const PW = 'demo-12345';

export async function boot() {
  const { buildApp } = await import('../src/server.js');
  const { migrate } = await import('../src/migrate.js');
  const { resetAndSeed } = await import('../src/seed.js');
  const db = await import('../src/db.js');
  const wallet = await import('../src/services/wallet.js');
  await migrate(false);
  const app = await buildApp();
  return {
    app,
    fresh: () => resetAndSeed(),
    sql: async <T = any>(text: string, params: unknown[] = []) => (await db.getPool().query(text, params)).rows as T[],
    processWallet: () => wallet.processWalletJobs(),
    close: async () => {
      await app.close();
      await db.closePool();
    },
  };
}

export class Agent {
  cookies = new Map<string, string>();
  constructor(private app: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const needsBody = !['GET', 'HEAD'].includes(method);
    const res = await this.app.inject({
      method: method as any,
      url,
      payload: needsBody ? JSON.stringify(body ?? {}) : undefined,
      headers: {
        ...(needsBody ? { 'content-type': 'application/json' } : {}),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...headers,
      },
    });
    for (const c of ([] as string[]).concat((res.headers['set-cookie'] as any) ?? [])) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (v === '' || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    let json: any = null;
    try { json = res.json(); } catch { json = res.body; }
    return { status: res.statusCode, body: json };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body);
  patch = (url: string, body?: unknown) => this.req('PATCH', url, body);

  async login(email: string, password = PW) {
    const r = await this.post('/api/staff/login', { email, password });
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    const me = await this.get('/api/staff/me');
    return me.body as { company: any; membership: any; branches: { id: string; name: string; code: string }[] };
  }
}

export const key = () => `test-${randomUUID()}`;

export async function lastCode(sql: (t: string, p?: unknown[]) => Promise<any[]>, destination: string) {
  const rows = await sql(`SELECT body FROM outbox_messages WHERE destination = $1 ORDER BY id DESC LIMIT 1`, [destination]);
  const m = rows[0]?.body.match(/(\d{6})/);
  if (!m) throw new Error(`sin código para ${destination}`);
  return m[1];
}
