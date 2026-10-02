import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool, one, q } from '../db.js';
import { config } from '../config.js';
import { AppError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { requireAdmin } from '../lib/auth.js';
import { integrationStatus } from '../lib/messaging.js';
import { processWalletJobs, walletStatus } from '../services/wallet.js';
import { expirePoints } from '../services/loyalty.js';
import { maskDestination } from '../services/otp.js';

// Administración de la plataforma (Chavarín & Said). Acceso limitado: ve negocios, categorías,
// pagos e incidentes; NO ve contactos de clientes.
export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/overview', async (req) => {
    await requireAdmin(req);
    const r = await one<any>(
      getPool(),
      `SELECT (SELECT count(*) FROM companies WHERE status = 'approved')::int AS approved,
              (SELECT count(*) FROM companies WHERE status = 'pending')::int AS pending,
              (SELECT count(*) FROM companies WHERE pilot)::int AS pilots,
              (SELECT count(*) FROM incidents WHERE status <> 'resuelto')::int AS open_incidents,
              (SELECT count(*) FROM wallet_sync_jobs WHERE status = 'failed')::int AS wallet_failed,
              (SELECT count(*) FROM privacy_requests WHERE status IN ('recibida','en_proceso'))::int AS privacy_open,
              (SELECT count(*) FROM subscriptions WHERE status = 'past_due')::int AS past_due`,
    );
    return r;
  });

  app.get('/api/admin/companies', async (req) => {
    await requireAdmin(req);
    const rows = await q<any>(
      getPool(),
      `SELECT co.id, co.name, co.slug, co.status, co.review_note, co.pilot, co.pilot_start, co.pilot_end, co.pilot_notes, co.created_at, co.is_demo,
              s.plan, s.status AS sub_status, s.paid_through,
              (SELECT count(*) FROM branches b WHERE b.company_id = co.id)::int AS branches,
              (SELECT count(*) FROM cards ca JOIN programs p ON p.id = ca.program_id WHERE p.company_id = co.id AND ca.status = 'active')::int AS cards,
              (SELECT count(*) FROM purchases pu WHERE pu.company_id = co.id AND pu.created_at > now() - interval '30 days')::int AS purchases_30d,
              (SELECT string_agg(DISTINCT cat.name, ', ') FROM branches b JOIN categories cat ON cat.id = b.category_id WHERE b.company_id = co.id) AS categories
       FROM companies co LEFT JOIN subscriptions s ON s.company_id = co.id
       ORDER BY (co.status = 'pending') DESC, co.name`,
    );
    return { companies: rows };
  });

  app.post('/api/admin/companies/:id/status', async (req) => {
    const s = await requireAdmin(req);
    const b = z.object({ status: z.enum(['approved', 'rejected', 'suspended', 'cancelled']), note: z.string().max(500).optional().default('') }).parse(req.body);
    const r = await getPool().query(
      `UPDATE companies SET status = $2, review_note = $3, approved_at = CASE WHEN $2 = 'approved' THEN coalesce(approved_at, now()) ELSE approved_at END WHERE id = $1`,
      [(req.params as any).id, b.status, b.note || null],
    );
    if (!r.rowCount) throw notFound('Negocio');
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, companyId: (req.params as any).id, action: `company.${b.status}`, details: { note: b.note }, ip: req.ip });
    return { ok: true, message: b.status === 'approved' ? 'Negocio aprobado y publicado en el directorio.' : 'Estado actualizado. Los saldos de los clientes se conservan.' };
  });

  app.patch('/api/admin/companies/:id/pilot', async (req) => {
    const s = await requireAdmin(req);
    const b = z.object({ pilot: z.boolean(), start: z.string().optional().nullable(), end: z.string().optional().nullable(), notes: z.string().max(1000).optional().nullable() }).parse(req.body);
    await getPool().query(`UPDATE companies SET pilot = $2, pilot_start = $3, pilot_end = $4, pilot_notes = $5 WHERE id = $1`, [(req.params as any).id, b.pilot, b.start || null, b.end || null, b.notes || null]);
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, companyId: (req.params as any).id, action: 'company.pilot_updated', details: b, ip: req.ip });
    return { ok: true };
  });

  // ---------- categorías editables sin tocar código ----------
  app.get('/api/admin/categories', async (req) => {
    await requireAdmin(req);
    return { categories: await q(getPool(), `SELECT c.*, (SELECT count(*) FROM branches b WHERE b.category_id = c.id)::int AS branches FROM categories c ORDER BY c.sort_order, c.name`) };
  });

  const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  app.post('/api/admin/categories', async (req) => {
    const s = await requireAdmin(req);
    const b = z.object({ name: z.string().trim().min(2).max(60), parentId: z.coerce.number().int().optional().nullable(), sortOrder: z.coerce.number().int().default(100) }).parse(req.body);
    let slug = slugify(b.name);
    for (let i = 2; await one(getPool(), `SELECT 1 FROM categories WHERE slug = $1`, [slug]); i++) slug = `${slugify(b.name)}-${i}`;
    const r = await one<any>(getPool(), `INSERT INTO categories(name, slug, parent_id, sort_order) VALUES ($1,$2,$3,$4) RETURNING id, slug`, [b.name, slug, b.parentId ?? null, b.sortOrder]);
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, action: 'category.created', entity: 'category', entityId: String(r.id), details: b, ip: req.ip });
    return { id: r.id, slug: r.slug, message: 'Categoría creada. Ya aparece en el directorio y en el registro de negocios.' };
  });

  app.patch('/api/admin/categories/:id', async (req) => {
    const s = await requireAdmin(req);
    const b = z.object({ name: z.string().trim().min(2).max(60).optional(), parentId: z.coerce.number().int().nullable().optional(), sortOrder: z.coerce.number().int().optional(), active: z.boolean().optional() }).parse(req.body);
    const id = Number((req.params as any).id);
    if (b.parentId === id) throw new AppError(400, 'BAD_PARENT', 'Una categoría no puede ser su propia madre.');
    if (b.active === false) {
      const used = await one<any>(getPool(), `SELECT count(*)::int AS n FROM branches WHERE category_id = $1 AND status = 'active'`, [id]);
      if (used.n) throw new AppError(409, 'CATEGORY_IN_USE', `Hay ${used.n} sucursales en esta categoría. Muévelas antes de desactivarla.`);
    }
    await getPool().query(
      `UPDATE categories SET name = coalesce($2, name), parent_id = CASE WHEN $3::boolean THEN $4::int ELSE parent_id END,
              sort_order = coalesce($5, sort_order), active = coalesce($6, active) WHERE id = $1`,
      [id, b.name ?? null, b.parentId !== undefined, b.parentId ?? null, b.sortOrder ?? null, b.active ?? null],
    );
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, action: 'category.updated', entity: 'category', entityId: String(id), details: b, ip: req.ip });
    return { ok: true };
  });

  // ---------- suscripciones y pagos manuales ----------
  app.get('/api/admin/subscriptions', async (req) => {
    await requireAdmin(req);
    return {
      subscriptions: await q(getPool(), `SELECT s.*, co.name FROM subscriptions s JOIN companies co ON co.id = s.company_id ORDER BY co.name`),
      payments: await q(getPool(), `SELECT p.*, co.name, u.name AS recorded_by_name FROM payments p JOIN companies co ON co.id = p.company_id JOIN users u ON u.id = p.recorded_by ORDER BY p.created_at DESC LIMIT 100`),
    };
  });

  app.patch('/api/admin/subscriptions/:companyId', async (req) => {
    const s = await requireAdmin(req);
    const b = z.object({ plan: z.enum(['basico', 'pro']).optional(), status: z.enum(['trial', 'active', 'past_due', 'suspended', 'cancelled']).optional(), paidThrough: z.string().optional().nullable(), notes: z.string().max(500).optional() }).parse(req.body);
    await getPool().query(
      `UPDATE subscriptions SET plan = coalesce($2, plan), status = coalesce($3, status), paid_through = coalesce($4::date, paid_through), notes = coalesce($5, notes),
              monthly_price_cents = CASE coalesce($2, plan) WHEN 'pro' THEN 34900 ELSE 19900 END, updated_at = now() WHERE company_id = $1`,
      [(req.params as any).companyId, b.plan ?? null, b.status ?? null, b.paidThrough || null, b.notes ?? null],
    );
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, companyId: (req.params as any).companyId, action: 'subscription.updated', details: b, ip: req.ip });
    return { ok: true };
  });

  app.post('/api/admin/payments', async (req) => {
    const s = await requireAdmin(req);
    const b = z
      .object({ companyId: z.string().uuid(), amount: z.coerce.number().positive().max(100000), concept: z.enum(['instalacion', 'mensualidad', 'otro']), method: z.enum(['efectivo', 'transferencia', 'otro']), reference: z.string().max(80).optional().default(''), periodMonth: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')).default('') })
      .parse(req.body);
    const r = await one<any>(
      getPool(),
      `INSERT INTO payments(company_id, amount_cents, concept, method, reference, period_month, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.companyId, Math.round(b.amount * 100), b.concept, b.method, b.reference || null, b.periodMonth || null, s.user.id],
    );
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, companyId: b.companyId, action: 'payment.recorded', entity: 'payment', entityId: r.id, details: b, ip: req.ip });
    return { id: r.id, message: 'Pago registrado manualmente. Actualiza el periodo pagado de la suscripción si corresponde.' };
  });

  // ---------- incidentes y soporte ----------
  app.get('/api/admin/incidents', async (req) => {
    await requireAdmin(req);
    return { incidents: await q(getPool(), `SELECT i.*, co.name AS company FROM incidents i LEFT JOIN companies co ON co.id = i.company_id ORDER BY (i.status = 'resuelto'), CASE i.priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, i.created_at DESC LIMIT 200`) };
  });

  app.post('/api/admin/incidents', async (req) => {
    const s = await requireAdmin(req);
    const b = z.object({ companyId: z.string().uuid().optional().nullable(), kind: z.enum(['soporte', 'falla', 'seguridad', 'disputa', 'datos', 'devolucion']), priority: z.enum(['alta', 'media', 'baja']), title: z.string().min(5).max(120), description: z.string().max(2000).optional().default(''), assignedTo: z.string().max(60).optional().default('') }).parse(req.body);
    const r = await one<any>(getPool(), `INSERT INTO incidents(company_id, kind, priority, title, description, created_by, assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [b.companyId ?? null, b.kind, b.priority, b.title, b.description, s.user.id, b.assignedTo || null]);
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, companyId: b.companyId ?? null, action: 'incident.opened', entity: 'incident', entityId: r.id, ip: req.ip });
    return { id: r.id };
  });

  app.patch('/api/admin/incidents/:id', async (req) => {
    const s = await requireAdmin(req);
    const b = z.object({ status: z.enum(['abierto', 'en_proceso', 'resuelto']).optional(), assignedTo: z.string().max(60).optional(), resolution: z.string().max(2000).optional() }).parse(req.body);
    await getPool().query(
      `UPDATE incidents SET status = coalesce($2, status), assigned_to = coalesce($3, assigned_to), resolution = coalesce($4, resolution), updated_at = now(),
              resolved_at = CASE WHEN $2 = 'resuelto' THEN now() ELSE resolved_at END WHERE id = $1`,
      [(req.params as any).id, b.status ?? null, b.assignedTo ?? null, b.resolution ?? null],
    );
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, action: 'incident.updated', entity: 'incident', entityId: (req.params as any).id, details: b, ip: req.ip });
    return { ok: true };
  });

  // ---------- integraciones ----------
  app.get('/api/admin/integrations', async (req) => {
    await requireAdmin(req);
    let db = 'conectada';
    try { await getPool().query('SELECT 1'); } catch { db = 'sin conexión'; }
    const failure = await one<any>(getPool(), `SELECT value FROM settings WHERE key = 'wallet_simulate_failure'`);
    const jobs = await one<any>(getPool(), `SELECT count(*) FILTER (WHERE status='pending')::int AS pending, count(*) FILTER (WHERE status='failed')::int AS failed, count(*) FILTER (WHERE status='done')::int AS done FROM wallet_sync_jobs`);
    return {
      database: db,
      messaging: integrationStatus(),
      wallet: walletStatus(),
      walletSimulateFailure: failure?.value === true,
      walletJobs: jobs,
      backups: 'Depende del proveedor de la base. En Render gratis NO hay respaldos (ver docs/DESPLIEGUE_RENDER.md).',
      keepalive: config.keepaliveUrl ? `activo cada ${config.keepaliveMinutes} min` : 'desactivado',
    };
  });

  app.post('/api/admin/settings/wallet-failure', async (req) => {
    const s = await requireAdmin(req);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await getPool().query(`INSERT INTO settings(key, value) VALUES ('wallet_simulate_failure', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(enabled)]);
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, action: 'settings.wallet_failure', details: { enabled }, ip: req.ip });
    return { ok: true };
  });

  app.get('/api/admin/wallet-jobs', async (req) => {
    await requireAdmin(req);
    return { jobs: await q(getPool(), `SELECT j.*, ca.code, ca.balance AS server_balance, wp.displayed_balance FROM wallet_sync_jobs j JOIN cards ca ON ca.id = j.card_id LEFT JOIN wallet_passes wp ON wp.card_id = j.card_id AND wp.provider = j.provider ORDER BY j.id DESC LIMIT 50`) };
  });

  app.post('/api/admin/wallet-jobs/retry', async (req) => {
    await requireAdmin(req);
    return processWalletJobs();
  });

  app.post('/api/admin/jobs/expire-points', async (req) => {
    const s = await requireAdmin(req);
    const r = await expirePoints({ kind: 'admin', userId: s.user.id });
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, action: 'job.expire_points', details: r, ip: req.ip });
    return r;
  });

  app.get('/api/admin/privacy-requests', async (req) => {
    await requireAdmin(req);
    return { requests: await q(getPool(), `SELECT pr.id, pr.kind, pr.status, pr.details, pr.created_at, pr.resolution, co.name AS company FROM privacy_requests pr LEFT JOIN companies co ON co.id = pr.company_id ORDER BY pr.created_at DESC LIMIT 100`) };
  });

  app.patch('/api/admin/privacy-requests/:id', async (req) => {
    const s = await requireAdmin(req);
    const b = z.object({ status: z.enum(['en_proceso', 'atendida', 'rechazada']), resolution: z.string().max(1000).optional().default('') }).parse(req.body);
    await getPool().query(`UPDATE privacy_requests SET status = $2, resolution = $3, resolved_at = CASE WHEN $2 IN ('atendida','rechazada') THEN now() ELSE NULL END WHERE id = $1`, [(req.params as any).id, b.status, b.resolution]);
    await audit(getPool(), { actorKind: 'admin', actorId: s.user.id, action: 'privacy.updated', entity: 'privacy_request', entityId: (req.params as any).id, details: b, ip: req.ip });
    return { ok: true };
  });

  app.get('/api/admin/audit', async (req) => {
    await requireAdmin(req);
    return { audit: await q(getPool(), `SELECT a.id, a.action, a.actor_kind, a.entity, a.entity_id, a.created_at, co.name AS company FROM audit_log a LEFT JOIN companies co ON co.id = a.company_id ORDER BY a.id DESC LIMIT 150`) };
  });

  // ---------- solo demostración ----------
  app.get('/api/demo/outbox', async () => {
    if (!config.demoMode) throw notFound('Buzón');
    const rows = await q<any>(getPool(), `SELECT id, channel, destination, subject, body, created_at FROM outbox_messages ORDER BY id DESC LIMIT 50`);
    return { messages: rows.map((m) => ({ ...m, destination: maskDestination(m.destination) })) };
  });

  app.post('/api/demo/reset', async (req) => {
    if (!config.demoMode) throw notFound('Ruta');
    const s = await requireAdmin(req);
    const { resetAndSeed } = await import('../seed.js');
    await resetAndSeed();
    return { ok: true, message: `Demo reiniciada por ${s.user.name}.` };
  });
}
