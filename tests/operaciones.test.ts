import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, boot, key, lastCode } from './helpers.js';

let env: Awaited<ReturnType<typeof boot>>;
before(async () => { env = await boot(); });
after(async () => { await env.close(); });

const balance = async (code: string) => (await env.sql(`SELECT balance FROM cards WHERE code = $1`, [code]))[0].balance as number;
const ledgerCount = async (code: string) => (await env.sql(`SELECT count(*)::int AS n FROM ledger_entries le JOIN cards c ON c.id = le.card_id WHERE c.code = $1`, [code]))[0].n as number;

async function staff(email: string) {
  const a = new Agent(env.app);
  const me = await a.login(email);
  return { a, me, branch: (name?: string) => (name ? me.branches.find((b) => b.name === name)! : me.branches[0]).id };
}

describe('T01 categorías y búsqueda', () => {
  it('árbol de categorías, búsqueda sin acentos, filtro y solo negocios aprobados', async () => {
    await env.fresh();
    const p = new Agent(env.app);
    const { body: cat } = await p.get('/api/public/categories');
    const food = cat.categories.find((c: any) => c.slug === 'comida-y-bebidas');
    const fast = food.children.find((c: any) => c.slug === 'comida-rapida');
    assert.deepEqual(fast.children.map((c: any) => c.slug), ['taquerias', 'hamburguesas', 'pizzerias']);
    assert.ok(cat.categories.find((c: any) => c.slug === 'servicios').children.some((c: any) => c.slug === 'lavado-de-autos'));

    const byStreet = await p.get('/api/public/directory?q=domingo');
    assert.equal(byStreet.body.results.length, 1);
    assert.equal(byStreet.body.results[0].company, 'Tacos del Centro');
    assert.equal(byStreet.body.results[0].branch, 'Sucursal Centro');

    const byCity = await p.get('/api/public/directory?q=tepotzotlan'); // sin acento
    assert.ok(byCity.body.results.length >= 4);
    assert.ok(byCity.body.results.every((r: any) => r.city === 'Tepotzotlán'));

    const byBranch = await p.get('/api/public/directory?q=sucursal%20norte');
    assert.ok(byBranch.body.results.some((r: any) => r.code === 'tacos-del-centro-norte'));

    const fastOnly = await p.get('/api/public/directory?category=comida-rapida');
    assert.ok(fastOnly.body.results.length >= 4);
    assert.ok(fastOnly.body.results.every((r: any) => ['Taquerías', 'Hamburguesas', 'Pizzerías'].includes(r.category)));

    const pending = await p.get('/api/public/directory?q=tecnopunto');
    assert.equal(pending.body.results.length, 0, 'un negocio pendiente no se publica');
  });

  it('una categoría nueva aparece sin tocar código y la aprobación publica al negocio', async () => {
    const admin = new Agent(env.app);
    await admin.login('admin@example.com');
    const parent = (await env.sql(`SELECT id FROM categories WHERE slug = 'servicios'`))[0].id;
    const r = await admin.post('/api/admin/categories', { name: 'Veterinarias', parentId: parent });
    assert.equal(r.status, 200);
    const { body } = await new Agent(env.app).get('/api/public/categories');
    assert.ok(body.categories.find((c: any) => c.slug === 'servicios').children.some((c: any) => c.name === 'Veterinarias'));

    const tecno = (await env.sql(`SELECT id FROM companies WHERE slug = 'tecnopunto'`))[0].id;
    assert.equal((await admin.post(`/api/admin/companies/${tecno}/status`, { status: 'approved' })).status, 200);
    const after = await new Agent(env.app).get('/api/public/directory?q=tecnopunto');
    assert.equal(after.body.results.length, 1);
  });
});

describe('T04 separación entre empresas', () => {
  it('un empleado no ve ni opera tarjetas, compras ni sucursales de otro negocio', async () => {
    await env.fresh();
    const { a, branch } = await staff('empleado.centro@example.com');
    const other = await a.get('/api/staff/cards/C-AUR01'); // tarjeta de Café Aurora
    assert.equal(other.status, 404);
    assert.equal(other.body.error.code, 'CARD_NOT_FOUND');
    assert.ok(!JSON.stringify(other.body).includes('Aurora'), 'no revela datos del otro negocio');

    const buy = await a.post('/api/staff/purchases', { cardCode: 'C-AUR01', branchId: branch(), ticketRef: 'X-1', idempotencyKey: key() });
    assert.equal(buy.status, 404);
    assert.equal(await balance('C-AUR01'), 7);

    const cafeBranch = (await env.sql(`SELECT id FROM branches WHERE code = 'cafe-aurora-jardin'`))[0].id;
    const wrongBranch = await a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: cafeBranch, ticketRef: 'X-2', idempotencyKey: key() });
    assert.equal(wrongBranch.status, 404);
    assert.equal(wrongBranch.body.error.code, 'BRANCH_NOT_FOUND');

    const norte = (await env.sql(`SELECT id FROM branches WHERE code = 'tacos-del-centro-norte'`))[0].id;
    const otherBranch = await a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: norte, ticketRef: 'X-3', idempotencyKey: key() });
    assert.equal(otherBranch.status, 403, 'empleado asignado a Centro no opera en Norte');

    const allegro = await staff('dueno.allegro@example.com');
    const tacoPurchase = (await env.sql(`SELECT id FROM purchases WHERE company_id = (SELECT id FROM companies WHERE slug='tacos-del-centro') LIMIT 1`))[0].id;
    const refund = await allegro.a.post(`/api/owner/purchases/${tacoPurchase}/refund`, { reason: 'intento de otra empresa' });
    assert.equal(refund.status, 404);
    const ownerCard = await allegro.a.get('/api/owner/cards/C-104');
    assert.equal(ownerCard.status, 404);
  });

  it('la base de datos impide unir una sucursal a un programa de otra empresa', async () => {
    const prog = (await env.sql(`SELECT id FROM programs WHERE company_id = (SELECT id FROM companies WHERE slug='cafe-aurora')`))[0].id;
    const newBranch = (await env.sql(
      `INSERT INTO branches(company_id, code, name, street, city, category_id) SELECT id, 'tacos-prueba', 'Prueba', 'Calle 1', 'X', 5 FROM companies WHERE slug='tacos-del-centro' RETURNING id`,
    ))[0].id;
    await assert.rejects(env.sql(`INSERT INTO program_branches(program_id, branch_id) VALUES ($1,$2)`, [prog, newBranch]), /empresas distintas/);
  });
});

describe('T05 compra y canje normales · T17 identificar no suma · T30 estado de operación', () => {
  it('compra +10, canje −50, entrega y estados consultables', async () => {
    await env.fresh();
    const { a, branch } = await staff('empleado.centro@example.com');
    const before = await ledgerCount('C-104');
    for (let i = 0; i < 5; i++) assert.equal((await a.get('/api/staff/cards/C-104')).body.card.balance, 30);
    assert.equal(await ledgerCount('C-104'), before, 'consultar 5 veces no crea movimientos');

    const k1 = key();
    assert.equal((await a.get(`/api/staff/operations/${k1}`)).body.found, false);
    const p1 = await a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: branch(), ticketRef: 'T-208', amount: '145.50', idempotencyKey: k1 });
    assert.equal(p1.status, 200);
    assert.equal(p1.body.status, 'confirmed');
    assert.equal(p1.body.balance, 40);
    const st = await a.get(`/api/staff/operations/${k1}`);
    assert.equal(st.body.found, true);
    assert.equal(st.body.balance, 40);
    const replay = await a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: branch(), ticketRef: 'T-208', amount: '145.50', idempotencyKey: k1 });
    assert.equal(replay.body.status, 'already_confirmed');
    assert.equal(replay.body.purchase.id, p1.body.purchase.id);
    assert.equal(await balance('C-104'), 40);

    const soon = await a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: branch(), ticketRef: 'T-209', idempotencyKey: key() });
    assert.equal(soon.status, 409);
    assert.equal(soon.body.error.code, 'POSSIBLE_DUPLICATE');
    const p2 = await a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: branch(), ticketRef: 'T-209', idempotencyKey: key(), confirmPossibleDuplicate: true });
    assert.equal(p2.body.balance, 50);

    const card = await a.get('/api/staff/cards/C-104');
    const tacos = card.body.rewards.find((r: any) => r.cost === 50);
    const red = await a.post('/api/staff/redemptions', { cardCode: 'C-104', branchId: branch(), rewardId: tacos.id, idempotencyKey: key() });
    assert.equal(red.status, 200);
    assert.equal(red.body.balance, 0);
    const del = await a.post(`/api/staff/redemptions/${red.body.redemption.id}/deliver`, {});
    assert.equal(del.body.status, 'delivered');

    const rows = await env.sql(`SELECT kind, points, balance_after, actor_user_id IS NOT NULL AS has_actor, program_version FROM ledger_entries le JOIN cards c ON c.id = le.card_id WHERE c.code='C-104' ORDER BY le.id DESC LIMIT 3`);
    assert.deepEqual(rows.map((r) => [r.kind, r.points, r.balance_after]), [['redemption', -50, 0], ['purchase', 10, 50], ['purchase', 10, 40]]);
    assert.ok(rows.every((r) => r.has_actor));
  });
});

describe('T06 saldo insuficiente', () => {
  it('rechaza sin descontar nada', async () => {
    await env.fresh();
    const { a, branch } = await staff('empleado.centro@example.com');
    const card = await a.get('/api/staff/cards/C-T203');
    assert.equal(card.body.card.balance, 10);
    const reward = card.body.rewards.find((r: any) => r.cost === 30);
    const countRed = async () => (await env.sql(`SELECT count(*)::int n FROM redemptions re JOIN cards c ON c.id=re.card_id WHERE c.code='C-T203'`))[0].n;
    const redBefore = await countRed();
    const r = await a.post('/api/staff/redemptions', { cardCode: 'C-T203', branchId: branch(), rewardId: reward.id, idempotencyKey: key() });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'INSUFFICIENT_BALANCE');
    assert.equal(await balance('C-T203'), 10);
    assert.equal(await countRed(), redBefore, 'no se creó ningún canje');
  });
});

describe('T07 compra duplicada', () => {
  it('mismo ticket con otra clave no suma; envíos simultáneos solo registran una vez', async () => {
    await env.fresh();
    const { a, branch } = await staff('empleado.centro@example.com');
    const ok = await a.post('/api/staff/purchases', { cardCode: 'C-105', branchId: branch(), ticketRef: 'T-500', idempotencyKey: key() });
    assert.equal(ok.body.balance, 60);
    const dup = await a.post('/api/staff/purchases', { cardCode: 'C-105', branchId: branch(), ticketRef: 't-500', idempotencyKey: key(), confirmPossibleDuplicate: true });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_TICKET');
    assert.equal(await balance('C-105'), 60);

    // 6 envíos simultáneos del MISMO ticket con claves distintas (doble clic en varios dispositivos)
    const results = await Promise.all(Array.from({ length: 6 }, () =>
      a.post('/api/staff/purchases', { cardCode: 'C-T204', branchId: branch(), ticketRef: 'T-777', idempotencyKey: key(), confirmPossibleDuplicate: true })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.error.code === 'DUPLICATE_TICKET'));
    assert.equal(await balance('C-T204'), 30);

    // 6 reintentos simultáneos con la MISMA clave (respuesta interrumpida)
    const k = key();
    const same = await Promise.all(Array.from({ length: 6 }, () =>
      a.post('/api/staff/purchases', { cardCode: 'C-T205', branchId: branch(), ticketRef: 'T-778', idempotencyKey: k, confirmPossibleDuplicate: true })));
    assert.ok(same.every((r) => r.status === 200));
    assert.equal(new Set(same.map((r) => r.body.purchase.id)).size, 1);
    assert.equal(await balance('C-T205'), 50);
    assert.equal((await env.sql(`SELECT count(*)::int n FROM purchases WHERE idempotency_key = $1`, [k]))[0].n, 1);
  });
});

describe('T08 canjes concurrentes', () => {
  it('10 canjes simultáneos desde dos empleados sobre 50 puntos: solo uno se confirma', async () => {
    await env.fresh();
    const e1 = await staff('empleado.centro@example.com');
    const e2 = await staff('encargada.tacos@example.com');
    const card = await e1.a.get('/api/staff/cards/C-105');
    assert.equal(card.body.card.balance, 50);
    const reward = card.body.rewards.find((r: any) => r.cost === 50);
    const centro = e1.branch();
    const attempts = Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? e2.a : e1.a).post('/api/staff/redemptions', { cardCode: 'C-105', branchId: centro, rewardId: reward.id, idempotencyKey: key() }));
    const res = await Promise.all(attempts);
    assert.equal(res.filter((r) => r.status === 200).length, 1);
    assert.equal(res.filter((r) => r.status === 409 && r.body.error.code === 'INSUFFICIENT_BALANCE').length, 9);
    assert.equal(await balance('C-105'), 0);
    assert.equal((await env.sql(`SELECT count(*)::int n FROM redemptions re JOIN cards c ON c.id=re.card_id WHERE c.code='C-105'`))[0].n, 1);
  });

  it('con 100 puntos y premio de 30, exactamente 3 de 8 canjes simultáneos pasan', async () => {
    const e1 = await staff('empleado.centro@example.com');
    await env.sql(`UPDATE cards SET balance = 100 WHERE code = 'C-T208'`); // preparación directa de la prueba
    const card = await e1.a.get('/api/staff/cards/C-T208');
    const reward = card.body.rewards.find((r: any) => r.cost === 30);
    const res = await Promise.all(Array.from({ length: 8 }, () =>
      e1.a.post('/api/staff/redemptions', { cardCode: 'C-T208', branchId: e1.branch(), rewardId: reward.id, idempotencyKey: key() })));
    assert.equal(res.filter((r) => r.status === 200).length, 3);
    assert.equal(await balance('C-T208'), 10);
  });
});

describe('T09 ajustes auditados', () => {
  it('solo encargado o dueño ajustan, con motivo; el historial original no se modifica', async () => {
    await env.fresh();
    const emp = await staff('empleado.centro@example.com');
    const mgr = await staff('encargada.tacos@example.com');
    const p = await emp.a.post('/api/staff/purchases', { cardCode: 'C-T206', branchId: emp.branch(), ticketRef: 'T-900', idempotencyKey: key() });
    const original = (await env.sql(`SELECT * FROM ledger_entries WHERE purchase_id = $1`, [p.body.purchase.id]))[0];

    const denied = await emp.a.post('/api/owner/adjustments', { cardCode: 'C-T206', points: -10, reason: 'intento sin permiso' });
    assert.equal(denied.status, 403);
    const noReason = await mgr.a.post('/api/owner/adjustments', { cardCode: 'C-T206', points: -10, reason: 'corto' });
    assert.equal(noReason.status, 400);
    const negative = await mgr.a.post('/api/owner/adjustments', { cardCode: 'C-T206', points: -500, reason: 'dejaría saldo negativo' });
    assert.equal(negative.body.error.code, 'INSUFFICIENT_BALANCE');

    const adj = await mgr.a.post('/api/owner/adjustments', { cardCode: 'C-T206', points: -10, reason: 'Ticket T-900 se capturó por error en esta tarjeta', relatedEntryId: original.id });
    assert.equal(adj.status, 200);
    assert.equal(adj.body.balance, 20);
    const entry = (await env.sql(`SELECT * FROM ledger_entries WHERE id = $1`, [adj.body.entryId]))[0];
    assert.equal(entry.kind, 'adjustment');
    assert.equal(entry.related_entry_id, original.id);
    assert.ok(entry.actor_user_id);
    assert.match(entry.reason, /T-900/);
    const stillThere = (await env.sql(`SELECT * FROM ledger_entries WHERE id = $1`, [original.id]))[0];
    assert.equal(stillThere.points, 10);
    const auditRow = await env.sql(`SELECT * FROM audit_log WHERE action = 'card.adjusted' AND entity_id = 'C-T206'`);
    assert.equal(auditRow.length, 1);

    await assert.rejects(env.sql(`UPDATE ledger_entries SET points = 999 WHERE id = $1`, [original.id]), /solo admite agregar/);
    await assert.rejects(env.sql(`DELETE FROM ledger_entries WHERE id = $1`, [original.id]), /solo admite agregar/);
    await assert.rejects(env.sql(`DELETE FROM audit_log WHERE action = 'card.adjusted'`), /solo admite agregar/);
  });

  it('entrega disputada: reponer puntos con registro y sin crear otro canje', async () => {
    const emp = await staff('empleado.centro@example.com');
    const mgr = await staff('encargada.tacos@example.com');
    const card = await emp.a.get('/api/staff/cards/C-105');
    const reward = card.body.rewards.find((r: any) => r.cost === 50);
    const red = await emp.a.post('/api/staff/redemptions', { cardCode: 'C-105', branchId: emp.branch(), rewardId: reward.id, idempotencyKey: key() });
    assert.equal(red.body.balance, 0);
    assert.equal((await mgr.a.post(`/api/owner/redemptions/${red.body.redemption.id}/dispute`, { note: 'Cliente dice que no recibió los tacos' })).status, 200);
    const res = await mgr.a.post(`/api/owner/redemptions/${red.body.redemption.id}/resolve`, { resolution: 'reversed', note: 'Cocina confirma que no se entregó' });
    assert.equal(res.body.balance, 50);
    assert.equal((await env.sql(`SELECT count(*)::int n FROM redemptions re JOIN cards c ON c.id=re.card_id WHERE c.code='C-105'`))[0].n, 1);
    const kinds = (await env.sql(`SELECT kind FROM ledger_entries le JOIN cards c ON c.id=le.card_id WHERE c.code='C-105' ORDER BY le.id DESC LIMIT 2`)).map((r) => r.kind);
    assert.deepEqual(kinds, ['redemption_reversal', 'redemption']);
  });
});

describe('T10 revocación de empleados', () => {
  it('al revocar, la sesión abierta deja de funcionar y no puede volver a entrar; su historial se conserva', async () => {
    await env.fresh();
    const emp = await staff('empleado.norte@example.com');
    const p = await emp.a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: emp.branch(), ticketRef: 'N-1', idempotencyKey: key() });
    assert.equal(p.status, 200);
    const owner = await staff('dueno.tacos@example.com');
    const list = await owner.a.get('/api/owner/employees');
    const m = list.body.employees.find((e: any) => e.email === 'empleado.norte@example.com');
    const rv = await owner.a.post(`/api/owner/employees/${m.id}/revoke`, { reason: 'Dejó de trabajar aquí' });
    assert.equal(rv.status, 200);
    assert.ok(rv.body.sessionsClosed >= 1);

    const after = await emp.a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: emp.branch(), ticketRef: 'N-2', idempotencyKey: key() });
    assert.equal(after.status, 401);
    const relogin = await new Agent(env.app).post('/api/staff/login', { email: 'empleado.norte@example.com', password: 'demo-12345' });
    assert.equal(relogin.status, 403);
    assert.equal((await env.sql(`SELECT count(*)::int n FROM purchases WHERE ticket_ref = 'N-1'`))[0].n, 1);

    const mgr = await staff('encargada.tacos@example.com');
    const ownerM = list.body.employees.find((e: any) => e.role === 'owner');
    assert.equal((await mgr.a.post(`/api/owner/employees/${ownerM.id}/revoke`, { reason: 'no permitido' })).status, 403);
  });
});

describe('T11 fallo de Wallet sin pérdida de compra', () => {
  it('la compra se guarda aunque Wallet falle; el reintento copia el saldo sin sumar otra vez', async () => {
    await env.fresh();
    const cust = new Agent(env.app);
    await cust.post('/api/customer/login/start', { contactType: 'email', contact: 'ana.martinez@example.com', channel: 'email' });
    const code = await lastCode(env.sql, 'ana.martinez@example.com');
    assert.equal((await cust.post('/api/customer/login/verify', { contactType: 'email', contact: 'ana.martinez@example.com', code })).status, 200);
    const w = await cust.post('/api/customer/cards/C-104/wallet', { provider: 'google' });
    assert.equal(w.body.simulated, true);
    assert.equal((await env.sql(`SELECT displayed_balance FROM wallet_passes wp JOIN cards c ON c.id=wp.card_id WHERE c.code='C-104'`))[0].displayed_balance, 30);

    const admin = new Agent(env.app);
    await admin.login('admin@example.com');
    await admin.post('/api/admin/settings/wallet-failure', { enabled: true });

    const emp = await staff('empleado.centro@example.com');
    const p = await emp.a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: emp.branch(), ticketRef: 'W-1', idempotencyKey: key() });
    assert.equal(p.status, 200, 'la compra se confirma aunque Wallet esté caído');
    assert.equal(p.body.balance, 40);
    await env.processWallet();
    const job = (await env.sql(`SELECT j.* FROM wallet_sync_jobs j JOIN cards c ON c.id=j.card_id WHERE c.code='C-104' ORDER BY j.id DESC LIMIT 1`))[0];
    assert.equal(job.status, 'failed');
    assert.equal((await env.sql(`SELECT displayed_balance FROM wallet_passes wp JOIN cards c ON c.id=wp.card_id WHERE c.code='C-104'`))[0].displayed_balance, 30, 'Wallet desactualizado');
    assert.equal(await balance('C-104'), 40, 'el servidor conserva la compra');
    const ledgerBefore = await ledgerCount('C-104');

    await admin.post('/api/admin/settings/wallet-failure', { enabled: false });
    const retry = await admin.post('/api/admin/wallet-jobs/retry', {});
    assert.ok(retry.body.done >= 1);
    await admin.post('/api/admin/wallet-jobs/retry', {}); // reintentar dos veces no cambia nada
    assert.equal((await env.sql(`SELECT displayed_balance FROM wallet_passes wp JOIN cards c ON c.id=wp.card_id WHERE c.code='C-104'`))[0].displayed_balance, 40);
    assert.equal(await balance('C-104'), 40, 'reintentar no suma puntos');
    assert.equal(await ledgerCount('C-104'), ledgerBefore);
  });
});

describe('T12 premio agotado', () => {
  it('no descuenta puntos si no hay existencias; con existencias las reduce', async () => {
    await env.fresh();
    const { a } = await staff('vendedor.allegro@example.com');
    const me = await a.get('/api/staff/me');
    const card = await a.get('/api/staff/cards/C-ALG01');
    assert.equal(card.body.card.balance, 125);
    const funda = card.body.rewards.find((r: any) => r.name.startsWith('Funda'));
    const r = await a.post('/api/staff/redemptions', { cardCode: 'C-ALG01', branchId: me.body.branches[0].id, rewardId: funda.id, idempotencyKey: key() });
    assert.equal(r.body.error.code, 'REWARD_OUT_OF_STOCK');
    assert.equal(await balance('C-ALG01'), 125);
    const cuerdas = card.body.rewards.find((x: any) => x.name.startsWith('Juego de cuerdas'));
    const ok = await a.post('/api/staff/redemptions', { cardCode: 'C-ALG01', branchId: me.body.branches[0].id, rewardId: cuerdas.id, idempotencyKey: key() });
    assert.equal(ok.status, 200);
    assert.equal((await env.sql(`SELECT stock FROM rewards WHERE id = $1`, [cuerdas.id]))[0].stock, 4);
  });
});

describe('T13 devolución', () => {
  it('revierte puntos; si ya se gastaron, revierte lo posible y abre un caso', async () => {
    await env.fresh();
    const emp = await staff('empleado.centro@example.com');
    const mgr = await staff('encargada.tacos@example.com');
    const p = await emp.a.post('/api/staff/purchases', { cardCode: 'C-T202', branchId: emp.branch(), ticketRef: 'D-1', idempotencyKey: key() });
    assert.equal(p.body.balance, 30);
    const full = await mgr.a.post(`/api/owner/purchases/${p.body.purchase.id}/refund`, { reason: 'Cliente devolvió la orden completa' });
    assert.equal(full.body.reverted, 10);
    assert.equal(full.body.shortfall, 0);
    assert.equal(await balance('C-T202'), 20);
    const again = await mgr.a.post(`/api/owner/purchases/${p.body.purchase.id}/refund`, { reason: 'Cliente devolvió la orden completa' });
    assert.equal(again.body.error.code, 'ALREADY_REFUNDED');

    await env.sql(`UPDATE cards SET balance = 4 WHERE code = 'C-T202'`); // simula que ya gastó casi todo
    const p2 = (await env.sql(`SELECT pu.id FROM purchases pu JOIN cards c ON c.id=pu.card_id WHERE c.code='C-T202' AND pu.status='confirmed' LIMIT 1`))[0].id;
    const partial = await mgr.a.post(`/api/owner/purchases/${p2}/refund`, { reason: 'Devolución con puntos ya usados' });
    assert.equal(partial.body.reverted, 4);
    assert.equal(partial.body.shortfall, 6);
    assert.equal(await balance('C-T202'), 0);
    assert.equal((await env.sql(`SELECT count(*)::int n FROM incidents WHERE kind = 'devolucion'`))[0].n, 1);
  });
});

describe('T15 contingencia sin internet', () => {
  it('comprobantes capturados después se aplican una sola vez y detectan tickets ya registrados', async () => {
    await env.fresh();
    const emp = await staff('empleado.centro@example.com');
    const mgr = await staff('encargada.tacos@example.com');
    await emp.a.post('/api/staff/purchases', { cardCode: 'C-T207', branchId: emp.branch(), ticketRef: 'K-1', idempotencyKey: key() });
    const at = new Date(Date.now() - 2 * 3600_000).toISOString();
    const cap = await emp.a.post('/api/staff/contingency', { branchId: emp.branch(), records: [
      { cardCode: 'C-T207', ticketRef: 'K-1', amount: '100', occurredAt: at },
      { cardCode: 'c-t209', ticketRef: 'K-2', amount: '80', occurredAt: at },
    ] });
    assert.deepEqual(cap.body.results.map((r: any) => r.status), ['duplicate', 'pending']);
    const dupCap = await emp.a.post('/api/staff/contingency', { branchId: emp.branch(), records: [{ cardCode: 'C-T209', ticketRef: 'k-2', occurredAt: at }] });
    assert.equal(dupCap.body.results[0].status, 'duplicate');

    const id = cap.body.results[1].id;
    const before = await balance('C-T209');
    assert.equal((await emp.a.post(`/api/owner/contingency/${id}`, { decision: 'apply' })).status, 403, 'el empleado no aplica');
    const ap = await mgr.a.post(`/api/owner/contingency/${id}`, { decision: 'apply' });
    assert.equal(ap.body.status, 'applied');
    assert.equal(await balance('C-T209'), before + 10);
    const twice = await mgr.a.post(`/api/owner/contingency/${id}`, { decision: 'apply' });
    assert.equal(twice.status, 409);
    assert.equal(await balance('C-T209'), before + 10);
    const pu = (await env.sql(`SELECT source, actor_user_id FROM purchases WHERE ticket_ref = 'K-2'`))[0];
    assert.equal(pu.source, 'contingency');
  });
});

describe('T16 registro con código · T29 publicidad separada', () => {
  it('QR del mostrador → registro verificado con 0 puntos; repetir no crea otra tarjeta', async () => {
    await env.fresh();
    const c = new Agent(env.app);
    const start = await c.post('/api/public/register/start', { branchCode: 'barberia-el-filo-centro', name: 'Mario Prueba', contactType: 'phone', contact: '55 1234 5678', channel: 'whatsapp', acceptPrivacy: true, marketing: false });
    assert.equal(start.status, 200);
    assert.equal(start.body.to, '***5678');
    const bad = await c.post('/api/public/register/verify', { otpId: start.body.otpId, code: '000000' });
    assert.equal(bad.body.error.code, 'OTP_INVALID');
    const code = await lastCode(env.sql, '+525512345678');
    const ok = await c.post('/api/public/register/verify', { otpId: start.body.otpId, code });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.card.balance, 0);
    const reuse = await c.post('/api/public/register/verify', { otpId: start.body.otpId, code });
    assert.equal(reuse.status, 400, 'un código no se usa dos veces');

    const c2 = new Agent(env.app);
    const s2 = await c2.post('/api/public/register/start', { branchCode: 'barberia-el-filo-centro', name: 'Mario', contactType: 'phone', contact: '5512345678', channel: 'sms', acceptPrivacy: true });
    const ok2 = await c2.post('/api/public/register/verify', { otpId: s2.body.otpId, code: await lastCode(env.sql, '+525512345678') });
    assert.equal(ok2.body.existed, true);
    assert.equal(ok2.body.card.code, ok.body.card.code);

    const noPrivacy = await new Agent(env.app).post('/api/public/register/start', { branchCode: 'barberia-el-filo-centro', name: 'X', contactType: 'phone', contact: '5599999999', channel: 'sms', acceptPrivacy: false });
    assert.equal(noPrivacy.status, 400);

    const cards = await c.get('/api/customer/cards');
    assert.equal(cards.body.cards.length, 1);
    const companyId = cards.body.cards[0].companyId;
    const consent = (await env.sql(`SELECT granted FROM marketing_consents WHERE company_id = $1`, [companyId]))[0];
    assert.equal(consent.granted, false, 'publicidad desmarcada por defecto');
    const on = await c.post('/api/customer/marketing', { companyId, granted: true });
    assert.equal(on.status, 200);
    const off = await c.post('/api/customer/marketing', { companyId, granted: false });
    assert.equal(off.status, 200);
    const barber = await staff('barbero.centro@example.com');
    const buy = await barber.a.post('/api/staff/purchases', { cardCode: ok.body.card.code, branchId: barber.branch(), ticketRef: 'B-1', idempotencyKey: key() });
    assert.equal(buy.body.balance, 1, 'quitar la publicidad no afecta la tarjeta');
  });

  it('un QR de sucursal inexistente o no aprobada no permite registrarse', async () => {
    const r = await new Agent(env.app).post('/api/public/register/start', { branchCode: 'tecnopunto-plaza', name: 'Xavier', contactType: 'phone', contact: '5511111111', channel: 'sms', acceptPrivacy: true });
    assert.equal(r.status, 404);
  });
});

describe('T18 otra sucursal', () => {
  it('programa común sí; programas separados no', async () => {
    await env.fresh();
    const mgr = await staff('encargada.tacos@example.com');
    const norte = mgr.branch('Sucursal Norte');
    const ok = await mgr.a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: norte, ticketRef: 'S-1', idempotencyKey: key() });
    assert.equal(ok.status, 200, 'Centro y Norte comparten programa');

    const filo = await staff('dueno.filo@example.com');
    const izcalli = filo.branch('Sucursal Izcalli');
    const no = await filo.a.post('/api/staff/purchases', { cardCode: 'C-FIL01', branchId: izcalli, ticketRef: 'S-2', idempotencyKey: key() });
    assert.equal(no.status, 409);
    assert.equal(no.body.error.code, 'BRANCH_NOT_IN_PROGRAM');
    assert.equal(await balance('C-FIL01'), 4);
  });
});

describe('T19 límite diario', () => {
  it('después del máximo de compras del día por tarjeta, rechaza', async () => {
    await env.fresh();
    const emp = await staff('empleado.centro@example.com');
    for (let i = 1; i <= 3; i++) {
      const r = await emp.a.post('/api/staff/purchases', { cardCode: 'C-T210', branchId: emp.branch(), ticketRef: `L-${i}`, idempotencyKey: key(), confirmPossibleDuplicate: true });
      assert.equal(r.status, 200);
    }
    const fourth = await emp.a.post('/api/staff/purchases', { cardCode: 'C-T210', branchId: emp.branch(), ticketRef: 'L-4', idempotencyKey: key(), confirmPossibleDuplicate: true });
    assert.equal(fourth.body.error.code, 'DAILY_LIMIT');
  });
});

describe('T20 cambio de reglas', () => {
  it('nueva versión aplica a compras nuevas, no recalcula saldos; subir costo de premio se programa', async () => {
    await env.fresh();
    const owner = await staff('dueno.tacos@example.com');
    const { body } = await owner.a.get('/api/owner/programs');
    const prog = body.programs[0];
    const before = await balance('C-104');
    const v = await owner.a.post(`/api/owner/programs/${prog.id}/versions`, { pointsPerPurchase: 20, minPurchase: 0, eligible: 'Cualquier consumo con ticket', terms: 'Nuevas condiciones de prueba para el programa', effectiveFrom: new Date().toISOString() });
    assert.equal(v.body.version, 2);
    assert.equal(await balance('C-104'), before, 'no se recalcula el saldo');
    const emp = await staff('empleado.centro@example.com');
    const p = await emp.a.post('/api/staff/purchases', { cardCode: 'C-104', branchId: emp.branch(), ticketRef: 'R-1', idempotencyKey: key() });
    assert.equal(p.body.purchase.points, 20);
    assert.equal(p.body.purchase.ruleVersion, 2);
    assert.equal((await env.sql(`SELECT count(*)::int n FROM purchases WHERE program_version = 1`))[0].n > 0, true);

    const reward = prog.rewards.find((r: any) => r.cost === 50);
    const up = await owner.a.patch(`/api/owner/rewards/${reward.id}`, { cost: 100 });
    assert.match(up.body.message, /14 días/);
    const card = await emp.a.get('/api/staff/cards/C-104');
    assert.equal(card.body.rewards.find((r: any) => r.id === reward.id).cost, 50, 'mientras corre el aviso se respeta el costo anterior');
    const mgr = await staff('encargada.tacos@example.com');
    assert.equal((await mgr.a.patch(`/api/owner/rewards/${reward.id}`, { cost: 10 })).status, 403, 'el encargado no cambia costos');
  });
});

describe('T21 vencimiento', () => {
  it('vence el saldo tras los días configurados sin compras y deja registro', async () => {
    await env.fresh();
    await env.sql(`UPDATE cards SET last_activity_at = now() - interval '200 days' WHERE code = 'C-105'`);
    const admin = new Agent(env.app);
    await admin.login('admin@example.com');
    const r = await admin.post('/api/admin/jobs/expire-points', {});
    assert.ok(r.body.expired >= 1);
    assert.equal(await balance('C-105'), 0);
    const last = (await env.sql(`SELECT kind, points FROM ledger_entries le JOIN cards c ON c.id=le.card_id WHERE c.code='C-105' ORDER BY le.id DESC LIMIT 1`))[0];
    assert.deepEqual([last.kind, last.points], ['expiration', -50]);
    assert.equal(await balance('C-104'), 30, 'tarjetas con actividad reciente no vencen');
  });
});

describe('T22 fusión · T23 reposición · T24 verificación al canjear', () => {
  it('une dos tarjetas con verificación del titular y sin sumar dos veces', async () => {
    await env.fresh();
    const reg = async (contactType: string, contact: string, dest: string, channel: string) => {
      const c = new Agent(env.app);
      const s = await c.post('/api/public/register/start', { branchCode: 'tacos-del-centro-centro', name: 'Pedro Duplicado', contactType, contact, channel, acceptPrivacy: true });
      const r = await c.post('/api/public/register/verify', { otpId: s.body.otpId, code: await lastCode(env.sql, dest) });
      return r.body.card.code as string;
    };
    const A = await reg('email', 'pedro@example.com', 'pedro@example.com', 'email');
    const B = await reg('phone', '5587654321', '+525587654321', 'sms');
    const emp = await staff('empleado.centro@example.com');
    await emp.a.post('/api/staff/purchases', { cardCode: A, branchId: emp.branch(), ticketRef: 'M-1', idempotencyKey: key() });
    await emp.a.post('/api/staff/purchases', { cardCode: B, branchId: emp.branch(), ticketRef: 'M-2', idempotencyKey: key() });
    const mgr = await staff('encargada.tacos@example.com');
    const noCode = await mgr.a.post('/api/owner/cards/merge', { fromCode: A, toCode: B, reason: 'Cliente se registró dos veces' });
    assert.equal(noCode.body.error.code, 'VERIFICATION_REQUIRED');
    await mgr.a.post(`/api/staff/cards/${A}/send-code`, { purpose: 'holder' });
    const m = await mgr.a.post('/api/owner/cards/merge', { fromCode: A, toCode: B, reason: 'Cliente se registró dos veces', verificationCode: await lastCode(env.sql, 'pedro@example.com') });
    assert.equal(m.status, 200);
    assert.equal(await balance(B), 20);
    assert.equal(await balance(A), 0);
    assert.equal((await env.sql(`SELECT status FROM cards WHERE code = $1`, [A]))[0].status, 'merged');
    const useOld = await emp.a.post('/api/staff/purchases', { cardCode: A, branchId: emp.branch(), ticketRef: 'M-3', idempotencyKey: key() });
    assert.equal(useOld.body.error.code, 'CARD_INACTIVE');
  });

  it('repone una tarjeta perdida solo con código al titular; la anterior deja de funcionar', async () => {
    const mgr = await staff('encargada.tacos@example.com');
    const wrong = await mgr.a.post('/api/owner/cards/C-104/replace', { reason: 'Cliente perdió su celular', verificationCode: '123456' });
    assert.ok([400].includes(wrong.status));
    await mgr.a.post('/api/staff/cards/C-104/send-code', { purpose: 'holder' });
    const r = await mgr.a.post('/api/owner/cards/C-104/replace', { reason: 'Cliente perdió su celular', verificationCode: await lastCode(env.sql, 'ana.martinez@example.com') });
    assert.equal(r.status, 200);
    assert.equal(await balance(r.body.newCode), 30);
    assert.equal((await env.sql(`SELECT status FROM cards WHERE code = 'C-104'`))[0].status, 'replaced');
    const printed = await mgr.a.post('/api/staff/cards/C-106/send-code', { purpose: 'holder' });
    assert.equal(printed.body.error.code, 'NO_VERIFIABLE_HOLDER', 'tarjeta impresa sin contacto no se puede reponer');
  });

  it('programa con verificación: sin el código del titular no hay canje', async () => {
    const barista = await staff('barista.cafe@example.com');
    await barista.a.post('/api/staff/purchases', { cardCode: 'C-AUR01', branchId: barista.branch(), ticketRef: 'A-1', idempotencyKey: key() });
    const card = await barista.a.get('/api/staff/cards/C-AUR01');
    assert.equal(card.body.card.balance, 8);
    const reward = card.body.rewards[0];
    const noCode = await barista.a.post('/api/staff/redemptions', { cardCode: 'C-AUR01', branchId: barista.branch(), rewardId: reward.id, idempotencyKey: key() });
    assert.equal(noCode.body.error.code, 'VERIFICATION_REQUIRED');
    await barista.a.post('/api/staff/cards/C-AUR01/send-code', { purpose: 'redeem' });
    const bad = await barista.a.post('/api/staff/redemptions', { cardCode: 'C-AUR01', branchId: barista.branch(), rewardId: reward.id, idempotencyKey: key(), verificationCode: '000000' });
    assert.equal(bad.body.error.code, 'OTP_INVALID');
    const ok = await barista.a.post('/api/staff/redemptions', { cardCode: 'C-AUR01', branchId: barista.branch(), rewardId: reward.id, idempotencyKey: key(), verificationCode: await lastCode(env.sql, 'ana.martinez@example.com') });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.balance, 0);
  });
});

describe('T26 negocio suspendido · T27 protección de origen · T28 bloqueo de acceso', () => {
  it('suspender bloquea operaciones nuevas, conserva saldos y retira del directorio', async () => {
    await env.fresh();
    const admin = new Agent(env.app);
    await admin.login('admin@example.com');
    const brasa = (await env.sql(`SELECT id FROM companies WHERE slug='la-brasa-burger'`))[0].id;
    await admin.post(`/api/admin/companies/${brasa}/status`, { status: 'suspended', note: 'Mensualidad vencida más allá del periodo de gracia' });
    const owner = await staff('dueno.brasa@example.com');
    const r = await owner.a.post('/api/staff/purchases', { cardCode: 'C-BRA01', branchId: owner.branch(), ticketRef: 'Z-1', amount: 200, idempotencyKey: key() });
    assert.equal(r.body.error.code, 'COMPANY_SUSPENDED');
    assert.equal(await balance('C-BRA01'), 30);
    assert.equal((await new Agent(env.app).get('/api/public/directory?q=brasa')).body.results.length, 0);
  });

  it('rechaza peticiones que no son JSON o vienen de otro sitio', async () => {
    const emp = new Agent(env.app);
    await emp.login('empleado.centro@example.com');
    const text = await emp.req('POST', '/api/staff/purchases', undefined, { 'content-type': 'text/plain' });
    assert.equal(text.status, 415);
    const cross = await emp.req('POST', '/api/staff/logout', {}, { origin: 'https://sitio-malicioso.example' });
    assert.equal(cross.status, 403);
  });

  it('bloquea temporalmente tras 5 contraseñas incorrectas', async () => {
    const a = new Agent(env.app);
    for (let i = 0; i < 5; i++) assert.equal((await a.post('/api/staff/login', { email: 'dueno.dalia@example.com', password: 'equivocada' })).status, 401);
    const locked = await a.post('/api/staff/login', { email: 'dueno.dalia@example.com', password: 'demo-12345' });
    assert.equal(locked.status, 429);
  });
});
