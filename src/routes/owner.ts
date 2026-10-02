import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool, one, q, tx } from '../db.js';
import { config } from '../config.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { requireStaff } from '../lib/auth.js';
import { hashPassword, normalizeCardCode } from '../lib/security.js';
import { maskEmail, maskName, maskPhone } from '../lib/mask.js';
import {
  adjustPoints, applyContingency, disputeRedemption, lookupCard, mergeCards, refundPurchase, replaceCard, resolveRedemption,
} from '../services/loyalty.js';

const MANAGERS = ['owner', 'manager'] as const;
const OWNER = ['owner'] as const;
const days = (v: unknown) => Math.min(365, Math.max(1, Number(v ?? 30) || 30));

export async function ownerRoutes(app: FastifyInstance) {
  // ---------- resumen y recurrencia ----------
  app.get('/api/owner/overview', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const d = days((req.query as any).days);
    const pool = getPool();
    const base = `company_id = $1 AND occurred_at > now() - ($2 || ' days')::interval`;
    const totals = await one<any>(
      pool,
      `WITH p AS (SELECT * FROM purchases WHERE ${base} AND status = 'confirmed')
       SELECT (SELECT count(*) FROM p)::int AS purchases,
              (SELECT coalesce(sum(points),0) FROM p)::int AS points_issued,
              (SELECT count(DISTINCT card_id) FROM p)::int AS active_cards,
              (SELECT count(*) FROM (SELECT card_id FROM p GROUP BY card_id HAVING count(*) >= 2) x)::int AS returning_cards,
              (SELECT count(*) FROM redemptions WHERE company_id = $1 AND status <> 'reversed' AND created_at > now() - ($2 || ' days')::interval)::int AS redemptions,
              (SELECT coalesce(sum(cost),0) FROM redemptions WHERE company_id = $1 AND status <> 'reversed' AND created_at > now() - ($2 || ' days')::interval)::int AS points_redeemed,
              (SELECT count(*) FROM cards ca JOIN programs pr ON pr.id = ca.program_id WHERE pr.company_id = $1 AND ca.created_at > now() - ($2 || ' days')::interval)::int AS new_cards,
              (SELECT count(*) FROM cards ca JOIN programs pr ON pr.id = ca.program_id WHERE pr.company_id = $1 AND ca.status = 'active')::int AS total_cards,
              (SELECT coalesce(sum(balance),0) FROM cards ca JOIN programs pr ON pr.id = ca.program_id WHERE pr.company_id = $1 AND ca.status = 'active')::int AS outstanding_points`,
      [ctx.companyId, String(d)],
    );
    const byBranch = await q<any>(
      pool,
      `SELECT b.name, count(p.id)::int AS purchases, count(DISTINCT p.card_id)::int AS cards
       FROM branches b LEFT JOIN purchases p ON p.branch_id = b.id AND p.status = 'confirmed' AND p.occurred_at > now() - ($2 || ' days')::interval
       WHERE b.company_id = $1 GROUP BY b.id, b.name ORDER BY b.name`,
      [ctx.companyId, String(d)],
    );
    const weekly = await q<any>(
      pool,
      `SELECT to_char(date_trunc('week', occurred_at AT TIME ZONE $2), 'YYYY-MM-DD') AS week, count(*)::int AS purchases,
              count(DISTINCT card_id)::int AS cards
       FROM purchases WHERE company_id = $1 AND status = 'confirmed' AND occurred_at > now() - interval '8 weeks'
       GROUP BY 1 ORDER BY 1`,
      [ctx.companyId, config.timezone],
    );
    return {
      days: d,
      totals: { ...totals, recurrence: totals.active_cards ? Math.round((totals.returning_cards / totals.active_cards) * 100) : null },
      byBranch,
      weekly,
      note: 'Cifras basadas solo en compras registradas en la plataforma. No incluyen ventas sin tarjeta ni demuestran por sí solas un aumento de ventas.',
    };
  });

  app.get('/api/owner/purchases', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const qs = req.query as any;
    const params: unknown[] = [ctx.companyId, String(days(qs.days))];
    let extra = '';
    if (qs.branchId) { params.push(qs.branchId); extra += ` AND pu.branch_id = $${params.length}`; }
    if (qs.q) { params.push(`%${String(qs.q).toLowerCase()}%`); extra += ` AND (lower(pu.ticket_ref) LIKE $${params.length} OR lower(ca.code) LIKE $${params.length})`; }
    const rows = await q<any>(
      getPool(),
      `SELECT pu.id, pu.ticket_ref, pu.amount_cents, pu.points, pu.program_version, pu.status, pu.source, pu.occurred_at, pu.created_at,
              ca.code, b.name AS branch, u.name AS actor
       FROM purchases pu JOIN cards ca ON ca.id = pu.card_id JOIN branches b ON b.id = pu.branch_id JOIN users u ON u.id = pu.actor_user_id
       WHERE pu.company_id = $1 AND pu.created_at > now() - ($2 || ' days')::interval ${extra}
       ORDER BY pu.created_at DESC LIMIT 200`,
      params,
    );
    return { purchases: rows };
  });

  app.get('/api/owner/redemptions', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const status = (req.query as any).status;
    const rows = await q<any>(
      getPool(),
      `SELECT re.id, re.reward_name, re.cost, re.status, re.created_at, re.delivered_at, re.dispute_note, re.resolution,
              ca.code, b.name AS branch, u.name AS actor
       FROM redemptions re JOIN cards ca ON ca.id = re.card_id JOIN branches b ON b.id = re.branch_id JOIN users u ON u.id = re.actor_user_id
       WHERE re.company_id = $1 ${status ? 'AND re.status = $2' : ''} ORDER BY re.created_at DESC LIMIT 200`,
      status ? [ctx.companyId, status] : [ctx.companyId],
    );
    return { redemptions: rows };
  });

  app.get('/api/owner/cards/:code', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const info = await lookupCard(ctx, (req.params as any).code);
    const card = await one<any>(
      getPool(),
      `SELECT ca.id, ca.created_at, ca.replaced_by, cu.email, cu.phone, cu.display_name, r.code AS replaced_by_code
       FROM cards ca JOIN programs p ON p.id = ca.program_id LEFT JOIN customers cu ON cu.id = ca.customer_id LEFT JOIN cards r ON r.id = ca.replaced_by
       WHERE ca.code = $1 AND p.company_id = $2`,
      [normalizeCardCode((req.params as any).code), ctx.companyId],
    );
    const ledger = await q<any>(
      getPool(),
      `SELECT le.id, le.kind, le.points, le.balance_after, le.created_at, le.reason, le.program_version, le.related_entry_id,
              b.name AS branch, u.name AS actor, pu.ticket_ref, re.reward_name
       FROM ledger_entries le LEFT JOIN branches b ON b.id = le.branch_id LEFT JOIN users u ON u.id = le.actor_user_id
       LEFT JOIN purchases pu ON pu.id = le.purchase_id LEFT JOIN redemptions re ON re.id = le.redemption_id
       WHERE le.card_id = $1 ORDER BY le.id DESC`,
      [card.id],
    );
    return {
      ...info,
      holderContact: { name: maskName(card.display_name), email: maskEmail(card.email), phone: maskPhone(card.phone) },
      replacedBy: card.replaced_by_code,
      createdAt: card.created_at,
      ledger,
    };
  });

  // ---------- correcciones auditadas ----------
  app.post('/api/owner/adjustments', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS], operate: true });
    const b = z.object({ cardCode: z.string(), points: z.coerce.number().int(), reason: z.string(), relatedEntryId: z.coerce.number().int().optional().nullable() }).parse(req.body);
    return adjustPoints(ctx, b);
  });

  app.post('/api/owner/purchases/:id/refund', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS], operate: true });
    const b = z.object({ reason: z.string() }).parse(req.body);
    return refundPurchase(ctx, z.string().uuid().parse((req.params as any).id), b.reason);
  });

  app.post('/api/owner/redemptions/:id/dispute', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const b = z.object({ note: z.string() }).parse(req.body);
    return disputeRedemption(ctx, z.string().uuid().parse((req.params as any).id), b.note);
  });

  app.post('/api/owner/redemptions/:id/resolve', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const b = z.object({ resolution: z.enum(['upheld', 'reversed']), note: z.string() }).parse(req.body);
    return resolveRedemption(ctx, z.string().uuid().parse((req.params as any).id), b.resolution, b.note);
  });

  app.post('/api/owner/cards/merge', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS], operate: true });
    const b = z.object({ fromCode: z.string(), toCode: z.string(), reason: z.string(), verificationCode: z.string().optional() }).parse(req.body);
    return mergeCards(ctx, b);
  });

  app.post('/api/owner/cards/:code/replace', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS], operate: true });
    const b = z.object({ reason: z.string(), verificationCode: z.string() }).parse(req.body);
    return replaceCard(ctx, { code: (req.params as any).code, ...b });
  });

  app.get('/api/owner/contingency', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    return {
      records: await q(
        getPool(),
        `SELECT cr.*, b.name AS branch, u.name AS captured_by_name FROM contingency_records cr JOIN branches b ON b.id = cr.branch_id
         JOIN users u ON u.id = cr.captured_by WHERE cr.company_id = $1 ORDER BY (cr.status = 'pending') DESC, cr.captured_at DESC LIMIT 100`,
        [ctx.companyId],
      ),
    };
  });

  app.post('/api/owner/contingency/:id', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS], operate: true });
    const b = z.object({ decision: z.enum(['apply', 'reject']), note: z.string().max(300).optional() }).parse(req.body);
    return applyContingency(ctx, z.string().uuid().parse((req.params as any).id), b.decision, b.note);
  });

  // ---------- empleados y permisos ----------
  app.get('/api/owner/employees', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const rows = await q<any>(
      getPool(),
      `SELECT m.id, m.role, m.status, m.created_at, m.revoked_at, m.revoke_reason, u.name, u.email, b.name AS branch, m.branch_id,
              (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id AND s.company_id = m.company_id) AS last_seen
       FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN branches b ON b.id = m.branch_id
       WHERE m.company_id = $1 ORDER BY (m.status = 'active') DESC, m.role, u.name`,
      [ctx.companyId],
    );
    return { employees: rows };
  });

  app.post('/api/owner/employees', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const b = z
      .object({
        name: z.string().trim().min(2).max(80),
        email: z.string().trim().toLowerCase().email(),
        role: z.enum(['manager', 'employee']),
        branchId: z.string().uuid().optional().nullable(),
        tempPassword: z.string().min(10, 'La contraseña temporal debe tener al menos 10 caracteres').max(100),
      })
      .parse(req.body);
    if (ctx.role === 'manager' && b.role !== 'employee') throw forbidden('El encargado solo puede dar de alta empleados.');
    if (b.branchId) {
      const ok = await one(getPool(), `SELECT 1 FROM branches WHERE id = $1 AND company_id = $2`, [b.branchId, ctx.companyId]);
      if (!ok) throw notFound('Sucursal');
    }
    return tx(async (c) => {
      let user = await one<any>(c, `SELECT id FROM users WHERE email = $1`, [b.email]);
      if (user) {
        const active = await one(c, `SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2 AND status = 'active'`, [user.id, ctx.companyId]);
        if (active) throw new AppError(409, 'ALREADY_MEMBER', 'Esa persona ya tiene acceso a este negocio.');
      } else {
        user = await one<any>(c, `INSERT INTO users(email, name, password_hash, must_change_password) VALUES ($1,$2,$3,true) RETURNING id`, [b.email, b.name, await hashPassword(b.tempPassword)]);
      }
      const m = await one<any>(c, `INSERT INTO memberships(user_id, company_id, role, branch_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [user.id, ctx.companyId, b.role, b.branchId ?? null, ctx.userId]);
      await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'employee.added', entity: 'membership', entityId: m.id, details: { email: b.email, role: b.role, branch: b.branchId }, ip: ctx.ip });
      return { id: m.id, message: 'Cuenta creada. Entrega la contraseña temporal en persona; se pedirá cambiarla al entrar.' };
    });
  });

  app.post('/api/owner/employees/:id/revoke', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const b = z.object({ reason: z.string().trim().min(5, 'Escribe el motivo').max(200) }).parse(req.body);
    const id = z.string().uuid().parse((req.params as any).id);
    return tx(async (c) => {
      const m = await one<any>(c, `SELECT * FROM memberships WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, ctx.companyId]);
      if (!m) throw notFound('Empleado');
      if (m.status !== 'active') return { status: 'revoked', message: 'Ese acceso ya estaba revocado.' };
      if (m.user_id === ctx.userId) throw new AppError(409, 'SELF_REVOKE', 'No puedes revocar tu propio acceso.');
      if (m.role === 'owner') throw forbidden('El acceso del dueño no se revoca desde aquí; contacta a soporte.');
      if (ctx.role === 'manager' && m.role !== 'employee') throw forbidden('El encargado solo puede revocar empleados.');
      await c.query(`UPDATE memberships SET status = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1`, [id, ctx.userId, b.reason]);
      const r = await c.query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'membership_revoked' WHERE user_id = $1 AND company_id = $2 AND revoked_at IS NULL`, [m.user_id, ctx.companyId]);
      await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'employee.revoked', entity: 'membership', entityId: id, details: { reason: b.reason, sessions_closed: r.rowCount }, ip: ctx.ip });
      return { status: 'revoked', sessionsClosed: r.rowCount, message: 'Acceso revocado y sesiones cerradas. El historial de sus operaciones se conserva.' };
    });
  });

  app.post('/api/owner/employees/:id/reset-password', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const b = z.object({ tempPassword: z.string().min(10).max(100) }).parse(req.body);
    const id = z.string().uuid().parse((req.params as any).id);
    const m = await one<any>(getPool(), `SELECT * FROM memberships WHERE id = $1 AND company_id = $2 AND status = 'active'`, [id, ctx.companyId]);
    if (!m) throw notFound('Empleado');
    if (m.role === 'owner' || (ctx.role === 'manager' && m.role !== 'employee')) throw forbidden();
    // Si la persona trabaja también en otro negocio, este negocio no puede cambiarle la contraseña.
    const other = await one(getPool(), `SELECT 1 FROM memberships WHERE user_id = $1 AND company_id <> $2 AND status = 'active'`, [m.user_id, ctx.companyId]);
    const admin = await one<any>(getPool(), `SELECT is_platform_admin FROM users WHERE id = $1`, [m.user_id]);
    if (other || admin?.is_platform_admin) throw new AppError(409, 'SHARED_ACCOUNT', 'Esta cuenta también se usa en otro negocio: la persona debe pedir soporte para recuperarla.');
    await getPool().query(`UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1`, [m.user_id, await hashPassword(b.tempPassword)]);
    await getPool().query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL`, [m.user_id]);
    await audit(getPool(), { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'employee.password_reset', entity: 'membership', entityId: id, ip: ctx.ip });
    return { ok: true, message: 'Contraseña temporal asignada. Entrégala en persona, no por chat.' };
  });

  // ---------- perfil, sucursales y programa ----------
  app.get('/api/owner/company', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const co = await one<any>(getPool(), `SELECT id, slug, name, description, logo_url, card_color, contact_email, contact_phone, status, review_note, pilot FROM companies WHERE id = $1`, [ctx.companyId]);
    const branches = await q<any>(
      getPool(),
      `SELECT b.*, c.name AS category, pb.program_id FROM branches b JOIN categories c ON c.id = b.category_id LEFT JOIN program_branches pb ON pb.branch_id = b.id
       WHERE b.company_id = $1 ORDER BY b.name`,
      [ctx.companyId],
    );
    const sub = await one<any>(getPool(), `SELECT plan, status, paid_through, monthly_price_cents FROM subscriptions WHERE company_id = $1`, [ctx.companyId]);
    return { company: co, branches, subscription: sub, publicBaseUrl: config.publicBaseUrl };
  });

  app.patch('/api/owner/company', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...OWNER] });
    const b = z
      .object({
        description: z.string().max(400).optional(),
        cardColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        logoUrl: z.string().url().max(300).or(z.literal('')).optional(),
        contactPhone: z.string().max(20).optional(),
      })
      .parse(req.body);
    await getPool().query(
      `UPDATE companies SET description = coalesce($2, description), card_color = coalesce($3, card_color),
              logo_url = CASE WHEN $4::text IS NULL THEN logo_url WHEN $4 = '' THEN NULL ELSE $4 END, contact_phone = coalesce($5, contact_phone) WHERE id = $1`,
      [ctx.companyId, b.description ?? null, b.cardColor ?? null, b.logoUrl ?? null, b.contactPhone ?? null],
    );
    await audit(getPool(), { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'company.updated', details: b, ip: ctx.ip });
    return { ok: true, message: 'Perfil actualizado.' };
  });

  const branchSchema = z.object({
    name: z.string().trim().min(2).max(60),
    street: z.string().trim().min(3).max(120),
    neighborhood: z.string().max(80).optional().default(''),
    city: z.string().trim().min(2).max(80),
    state: z.string().max(80).optional().default(''),
    postalCode: z.string().max(10).optional().default(''),
    categoryId: z.coerce.number().int(),
    hours: z.string().max(120).optional().default(''),
    phone: z.string().max(20).optional().default(''),
    lat: z.coerce.number().min(-90).max(90).optional().nullable(),
    lng: z.coerce.number().min(-180).max(180).optional().nullable(),
    programId: z.string().uuid(),
  });

  app.post('/api/owner/branches', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...OWNER] });
    const b = branchSchema.parse(req.body);
    const pr = await one<any>(getPool(), `SELECT id FROM programs WHERE id = $1 AND company_id = $2`, [b.programId, ctx.companyId]);
    if (!pr) throw notFound('Programa');
    const co = await one<any>(getPool(), `SELECT slug FROM companies WHERE id = $1`, [ctx.companyId]);
    return tx(async (c) => {
      let code = `${co.slug}-${b.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 55).replace(/-$/, '');
      for (let i = 2; await one(c, `SELECT 1 FROM branches WHERE code = $1`, [code]); i++) code = `${code.slice(0, 52)}-${i}`;
      const br = await one<any>(
        c,
        `INSERT INTO branches(company_id, code, name, street, neighborhood, city, state, postal_code, category_id, hours, phone, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, code`,
        [ctx.companyId, code, b.name, b.street, b.neighborhood || null, b.city, b.state || null, b.postalCode || null, b.categoryId, b.hours || null, b.phone || null, b.lat ?? null, b.lng ?? null],
      );
      await c.query(`INSERT INTO program_branches(program_id, branch_id) VALUES ($1,$2)`, [pr.id, br.id]);
      await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'branch.created', entity: 'branch', entityId: br.id, details: { code }, ip: ctx.ip });
      return { id: br.id, code: br.code, message: 'Sucursal creada. Imprime su QR de mostrador desde la lista de sucursales.' };
    });
  });

  app.get('/api/owner/programs', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const programs = await q<any>(getPool(), `SELECT * FROM programs WHERE company_id = $1 ORDER BY created_at`, [ctx.companyId]);
    for (const p of programs) {
      p.versions = await q(getPool(), `SELECT pv.*, u.name AS created_by_name FROM program_versions pv LEFT JOIN users u ON u.id = pv.created_by WHERE program_id = $1 ORDER BY version DESC`, [p.id]);
      p.rewards = await q(getPool(), `SELECT * FROM rewards WHERE program_id = $1 ORDER BY sort_order, cost`, [p.id]);
      p.branches = await q(getPool(), `SELECT b.id, b.name FROM program_branches pb JOIN branches b ON b.id = pb.branch_id WHERE pb.program_id = $1 ORDER BY b.name`, [p.id]);
    }
    return { programs, rewardCostNoticeDays: config.rewardCostNoticeDays };
  });

  app.patch('/api/owner/programs/:id', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...OWNER] });
    const b = z
      .object({ redeemVerification: z.enum(['none', 'otp']).optional(), maxPurchasesPerDay: z.coerce.number().int().min(1).max(50).optional(), status: z.enum(['active', 'paused']).optional(), name: z.string().min(2).max(80).optional() })
      .parse(req.body);
    const r = await getPool().query(
      `UPDATE programs SET redeem_verification = coalesce($3, redeem_verification), max_purchases_per_card_per_day = coalesce($4, max_purchases_per_card_per_day),
              status = coalesce($5, status), name = coalesce($6, name) WHERE id = $1 AND company_id = $2`,
      [(req.params as any).id, ctx.companyId, b.redeemVerification ?? null, b.maxPurchasesPerDay ?? null, b.status ?? null, b.name ?? null],
    );
    if (!r.rowCount) throw notFound('Programa');
    await audit(getPool(), { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'program.settings_updated', entity: 'program', entityId: (req.params as any).id, details: b, ip: ctx.ip });
    return { ok: true, message: 'Configuración guardada.' };
  });

  // Cambio de reglas: crea una versión nueva con fecha de inicio. No recalcula saldos existentes.
  app.post('/api/owner/programs/:id/versions', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...OWNER] });
    const b = z
      .object({
        pointsPerPurchase: z.coerce.number().int().min(1).max(10000),
        minPurchase: z.coerce.number().min(0).max(100000).default(0),
        expirationDays: z.coerce.number().int().min(30).max(1095).optional().nullable(),
        eligible: z.string().trim().min(5).max(300),
        terms: z.string().trim().min(10).max(1500),
        effectiveFrom: z.string().min(8),
      })
      .parse(req.body);
    const from = new Date(b.effectiveFrom);
    if (Number.isNaN(from.getTime())) throw new AppError(400, 'BAD_DATE', 'Fecha inválida.');
    const effective = from < new Date() ? new Date() : from;
    return tx(async (c) => {
      const p = await one<any>(c, `SELECT id FROM programs WHERE id = $1 AND company_id = $2 FOR UPDATE`, [(req.params as any).id, ctx.companyId]);
      if (!p) throw notFound('Programa');
      const max = await one<any>(c, `SELECT coalesce(max(version),0) AS v FROM program_versions WHERE program_id = $1`, [p.id]);
      const version = max.v + 1;
      await c.query(
        `INSERT INTO program_versions(program_id, version, points_per_purchase, min_purchase_cents, expiration_days, eligible_description, terms, effective_from, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.id, version, b.pointsPerPurchase, Math.round(b.minPurchase * 100), b.expirationDays ?? null, b.eligible, b.terms, effective.toISOString(), ctx.userId],
      );
      await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'program.version_created', entity: 'program', entityId: p.id, details: { version, ...b }, ip: ctx.ip });
      return { version, effectiveFrom: effective, message: `Reglas versión ${version} programadas. Los puntos ya acumulados no se recalculan; avisa a tus clientes antes de la fecha.` };
    });
  });

  app.post('/api/owner/programs/:id/rewards', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...OWNER] });
    const b = z.object({ name: z.string().trim().min(2).max(80), description: z.string().max(200).optional().default(''), cost: z.coerce.number().int().min(1).max(100000), stock: z.coerce.number().int().min(0).optional().nullable() }).parse(req.body);
    const p = await one<any>(getPool(), `SELECT id FROM programs WHERE id = $1 AND company_id = $2`, [(req.params as any).id, ctx.companyId]);
    if (!p) throw notFound('Programa');
    const r = await one<any>(getPool(), `INSERT INTO rewards(program_id, name, description, cost, stock) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [p.id, b.name, b.description || null, b.cost, b.stock ?? null]);
    await audit(getPool(), { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'reward.created', entity: 'reward', entityId: r.id, details: b, ip: ctx.ip });
    return { id: r.id, message: 'Premio agregado.' };
  });

  app.patch('/api/owner/rewards/:id', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const b = z
      .object({ name: z.string().trim().min(2).max(80).optional(), description: z.string().max(200).optional(), cost: z.coerce.number().int().min(1).max(100000).optional(), stock: z.coerce.number().int().min(0).nullable().optional(), active: z.boolean().optional() })
      .parse(req.body);
    // El encargado solo actualiza existencias; nombre, costo y activación los decide el dueño.
    if (ctx.role !== 'owner' && (b.name !== undefined || b.cost !== undefined || b.active !== undefined || b.description !== undefined)) {
      throw forbidden('El encargado solo puede actualizar existencias.');
    }
    return tx(async (c) => {
      const r = await one<any>(c, `SELECT r.* FROM rewards r JOIN programs p ON p.id = r.program_id WHERE r.id = $1 AND p.company_id = $2 FOR UPDATE OF r`, [(req.params as any).id, ctx.companyId]);
      if (!r) throw notFound('Premio');
      let message = 'Premio actualizado.';
      if (b.cost !== undefined && b.cost !== r.cost) {
        if (b.cost > r.cost) {
          // Subir el costo perjudica a quien ya ahorró: se programa con aviso previo.
          await c.query(`UPDATE rewards SET pending_cost = $2, pending_cost_from = now() + ($3 || ' days')::interval WHERE id = $1`, [r.id, b.cost, String(config.rewardCostNoticeDays)]);
          message = `El nuevo costo (${b.cost}) aplica en ${config.rewardCostNoticeDays} días; mientras tanto se respeta ${r.cost}. Avisa a tus clientes.`;
        } else {
          await c.query(`UPDATE rewards SET cost = $2, pending_cost = NULL, pending_cost_from = NULL WHERE id = $1`, [r.id, b.cost]);
          message = `Costo reducido a ${b.cost} desde ahora.`;
        }
      }
      await c.query(
        `UPDATE rewards SET name = coalesce($2, name), description = coalesce($3, description), active = coalesce($4, active),
                stock = CASE WHEN $5::boolean THEN $6::int ELSE stock END WHERE id = $1`,
        [r.id, b.name ?? null, b.description ?? null, b.active ?? null, b.stock !== undefined, b.stock ?? null],
      );
      await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'reward.updated', entity: 'reward', entityId: r.id, details: b, ip: ctx.ip });
      return { ok: true, message };
    });
  });

  // ---------- alertas de posible abuso (no son acusaciones) ----------
  app.get('/api/owner/alerts', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const pool = getPool();
    const alerts: any[] = [];
    const burst = await q<any>(
      pool,
      `SELECT u.name, date_trunc('hour', pu.created_at) AS hour, count(*)::int AS n FROM purchases pu JOIN users u ON u.id = pu.actor_user_id
       WHERE pu.company_id = $1 AND pu.created_at > now() - interval '7 days' GROUP BY u.name, hour HAVING count(*) >= 12 ORDER BY hour DESC`,
      [ctx.companyId],
    );
    for (const r of burst) alerts.push({ level: 'revisar', text: `${r.name} registró ${r.n} compras en una hora (${new Date(r.hour).toLocaleString('es-MX', { timeZone: config.timezone })}).` });
    const sameCard = await q<any>(
      pool,
      `SELECT u.name, ca.code, count(*)::int AS n FROM purchases pu JOIN users u ON u.id = pu.actor_user_id JOIN cards ca ON ca.id = pu.card_id
       WHERE pu.company_id = $1 AND pu.created_at > now() - interval '7 days' GROUP BY u.name, ca.code HAVING count(*) >= 6`,
      [ctx.companyId],
    );
    for (const r of sameCard) alerts.push({ level: 'revisar', text: `${r.name} registró ${r.n} compras a la tarjeta ${r.code} en 7 días.` });
    const adj = await q<any>(
      pool,
      `SELECT u.name, count(*)::int AS n, sum(le.points)::int AS pts FROM ledger_entries le JOIN users u ON u.id = le.actor_user_id
       WHERE le.company_id = $1 AND le.kind = 'adjustment' AND le.created_at > now() - interval '7 days' GROUP BY u.name HAVING count(*) >= 5`,
      [ctx.companyId],
    );
    for (const r of adj) alerts.push({ level: 'revisar', text: `${r.name} hizo ${r.n} ajustes manuales (${r.pts} puntos netos) en 7 días.` });
    const cont = await one<any>(pool, `SELECT count(*)::int AS n FROM contingency_records WHERE company_id = $1 AND status = 'pending' AND captured_at < now() - interval '24 hours'`, [ctx.companyId]);
    if (cont.n) alerts.push({ level: 'pendiente', text: `${cont.n} comprobantes de contingencia llevan más de 24 h sin revisar.` });
    const disp = await one<any>(pool, `SELECT count(*)::int AS n FROM redemptions WHERE company_id = $1 AND status = 'disputed'`, [ctx.companyId]);
    if (disp.n) alerts.push({ level: 'pendiente', text: `${disp.n} canjes en disputa esperan resolución.` });
    const undelivered = await one<any>(pool, `SELECT count(*)::int AS n FROM redemptions WHERE company_id = $1 AND status = 'confirmed' AND created_at < now() - interval '2 hours'`, [ctx.companyId]);
    if (undelivered.n) alerts.push({ level: 'pendiente', text: `${undelivered.n} canjes confirmados no se han marcado como entregados.` });
    return { alerts, note: 'Una alerta es una señal para revisar evidencia, no una acusación.' };
  });

  app.get('/api/owner/audit', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const rows = await q<any>(
      getPool(),
      `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at, a.actor_kind, u.name AS actor
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.company_id = $1 ORDER BY a.id DESC LIMIT 150`,
      [ctx.companyId],
    );
    return { audit: rows };
  });

  app.get('/api/owner/incidents', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    return { incidents: await q(getPool(), `SELECT * FROM incidents WHERE company_id = $1 ORDER BY created_at DESC LIMIT 100`, [ctx.companyId]) };
  });

  app.post('/api/owner/incidents', async (req) => {
    const { ctx } = await requireStaff(req, { roles: [...MANAGERS] });
    const b = z.object({ kind: z.enum(['soporte', 'falla', 'seguridad', 'datos']), title: z.string().trim().min(5).max(120), description: z.string().max(2000).optional().default('') }).parse(req.body);
    const priority = b.kind === 'falla' || b.kind === 'seguridad' ? 'alta' : 'media';
    const r = await one<any>(getPool(), `INSERT INTO incidents(company_id, kind, priority, title, description, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [ctx.companyId, b.kind, priority, b.title, b.description, ctx.userId]);
    await audit(getPool(), { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'incident.opened', entity: 'incident', entityId: r.id, ip: ctx.ip });
    return { id: r.id, message: 'Solicitud registrada con folio. Soporte responde en el horario publicado; no hay atención 24/7.' };
  });
}
