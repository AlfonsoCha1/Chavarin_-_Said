import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, key } from './helpers.js';
import { HttpAgent, startServer, stopServer } from './server-process.js';

const PORT = 3999;
let env: Awaited<ReturnType<typeof boot>>;
before(async () => {
  env = await boot();
  await env.fresh();
});
after(async () => { await env.close(); });

describe('T03 persistencia tras reiniciar', () => {
  it('una compra confirmada sigue ahí después de matar y volver a arrancar el servidor', async () => {
    let server = await startServer(PORT);
    const a = new HttpAgent(`http://127.0.0.1:${PORT}`);
    assert.equal((await a.req('POST', '/api/staff/login', { email: 'empleado.centro@example.com', password: 'demo-12345' })).status, 200);
    const me = await a.req('GET', '/api/staff/me');
    const k = key();
    const p = await a.req('POST', '/api/staff/purchases', { cardCode: 'C-104', branchId: me.body.branches[0].id, ticketRef: 'P-1', idempotencyKey: k });
    assert.equal(p.status, 200);
    assert.equal(p.body.balance, 40);

    await stopServer(server, 'SIGKILL'); // caída abrupta, sin cierre ordenado
    server = await startServer(PORT);
    try {
      const card = await a.req('GET', '/api/staff/cards/C-104'); // la sesión también se guarda en la base
      assert.equal(card.status, 200);
      assert.equal(card.body.card.balance, 40);
      const replay = await a.req('POST', '/api/staff/purchases', { cardCode: 'C-104', branchId: me.body.branches[0].id, ticketRef: 'P-1', idempotencyKey: k });
      assert.equal(replay.body.status, 'already_confirmed');
      const st = await a.req('GET', `/api/staff/operations/${k}`);
      assert.equal(st.body.found, true);
    } finally {
      await stopServer(server, 'SIGTERM');
    }
  });
});
