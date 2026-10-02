import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { getPool, one, q } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { createSession, destroySession, loadStaff, requireStaff, revokeUserSessions } from '../lib/auth.js';
import { hashPassword, normalizeCardCode, verifyPassword } from '../lib/security.js';
import {
  captureContingency, confirmPurchase, confirmRedemption, issuePrintedCard, lookupCard, markDelivered, operationStatus, sendHolderCode,
} from '../services/loyalty.js';

const money = z.union([z.number(), z.string()]).optional().nullable().transform((v, ctx) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: 'custom', message: 'Importe inválido' });
    return z.NEVER;
  }
  return Math.round(n * 100);
});

export async function staffRoutes(app: FastifyInstance) {
  app.post('/api/staff/login', async (req, reply) => {
    const b = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const u = await one<any>(getPool(), `SELECT * FROM users WHERE email = $1`, [b.email]);
    const fail = new AppError(401, 'BAD_CREDENTIALS', 'Correo o contraseña incorrectos.');
    if (!u) throw fail;
    if (u.status !== 'active') throw new AppError(403, 'USER_DISABLED', 'Esta cuenta está desactivada.');
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      throw new AppError(429, 'LOCKED', `Cuenta bloqueada temporalmente por intentos fallidos. Intenta después de ${config.loginLockMinutes} minutos.`);
    }
    if (!(await verifyPassword(b.password, u.password_hash))) {
      const fails = u.failed_logins + 1;
      if (fails >= config.loginMaxFailures) {
        await getPool().query(`UPDATE users SET failed_logins = 0, locked_until = now() + ($2 || ' minutes')::interval WHERE id = $1`, [u.id, String(config.loginLockMinutes)]);
      } else {
        await getPool().query(`UPDATE users SET failed_logins = $2 WHERE id = $1`, [u.id, fails]);
      }
      await audit(getPool(), { actorKind: 'public', actorId: u.id, action: 'staff.login_failed', ip: req.ip });
      throw fail;
    }
    const m = await one<any>(
      getPool(),
      `SELECT m.company_id FROM memberships m JOIN companies c ON c.id = m.company_id
       WHERE m.user_id = $1 AND m.status = 'active' ORDER BY (m.role = 'owner') DESC, m.created_at LIMIT 1`,
      [u.id],
    );
    if (!m && !u.is_platform_admin) throw new AppError(403, 'NO_ACCESS', 'Tu cuenta ya no tiene acceso a ningún negocio.');
    await getPool().query(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [u.id]);
    await createSession(reply, req, 'staff', { userId: u.id, companyId: m?.company_id ?? null });
    await audit(getPool(), { actorKind: 'staff', actorId: u.id, companyId: m?.company_id ?? null, action: 'staff.login', ip: req.ip });
    return { ok: true, mustChangePassword: u.must_change_password, isAdmin: u.is_platform_admin, hasCompany: !!m };
  });

  app.post('/api/staff/logout', async (req, reply) => {
    await destroySession(req, reply, 'staff');
    return { ok: true };
  });

  app.get('/api/staff/me', async (req) => {
    const s = await loadStaff(req);
    if (!s) throw new AppError(401, 'UNAUTHENTICATED', 'Entra con tu cuenta.');
    let branches: any[] = [];
    if (s.company) {
      branches = await q<any>(
        getPool(),
        `SELECT b.id, b.name, b.code, b.street, b.city FROM branches b WHERE b.company_id = $1 AND b.status = 'active'
         ${s.membership?.branchId ? 'AND b.id = $2' : ''} ORDER BY b.name`,
        s.membership?.branchId ? [s.company.id, s.membership.branchId] : [s.company.id],
      );
    }
    return { user: s.user, company: s.company, membership: s.membership, branches };
  });

  app.post('/api/staff/password', async (req) => {
    const s = await loadStaff(req);
    if (!s) throw new AppError(401, 'UNAUTHENTICATED', 'Entra con tu cuenta.');
    const b = z.object({ current: z.string().min(1), next: z.string().min(10, 'Mínimo 10 caracteres').max(100) }).parse(req.body);
    const u = await one<any>(getPool(), `SELECT password_hash FROM users WHERE id = $1`, [s.user.id]);
    if (!(await verifyPassword(b.current, u.password_hash))) throw new AppError(400, 'BAD_PASSWORD', 'La contraseña actual no coincide.');
    await getPool().query(`UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`, [s.user.id, await hashPassword(b.next)]);
    // Cierra las demás sesiones abiertas de esa cuenta.
    await getPool().query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'password_change' WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`, [s.user.id, s.sessionId]);
    await audit(getPool(), { actorKind: 'staff', actorId: s.user.id, action: 'staff.password_changed', ip: req.ip });
    return { ok: true, message: 'Contraseña actualizada. Se cerraron tus otras sesiones.' };
  });

  // Cerrar todas mis sesiones (por ejemplo, si se perdió un teléfono del mostrador).
  app.post('/api/staff/sessions/revoke-all', async (req, reply) => {
    const s = await loadStaff(req);
    if (!s) throw new AppError(401, 'UNAUTHENTICATED', 'Entra con tu cuenta.');
    await revokeUserSessions(s.user.id, 'user_revoke_all');
    await destroySession(req, reply, 'staff');
    return { ok: true };
  });

  app.get('/api/staff/cards/:code', async (req) => {
    const { ctx } = await requireStaff(req);
    return lookupCard(ctx, (req.params as any).code);
  });

  app.get('/api/staff/cards/:code/qr.svg', async (req, reply) => {
    const { ctx } = await requireStaff(req);
    const code = normalizeCardCode((req.params as any).code);
    const ok = await one(getPool(), `SELECT 1 FROM cards ca JOIN programs p ON p.id = ca.program_id WHERE ca.code = $1 AND p.company_id = $2`, [code, ctx.companyId]);
    if (!ok) throw new AppError(404, 'CARD_NOT_FOUND', 'No encontramos esa tarjeta en este negocio.');
    const svg = await QRCode.toString(`${config.publicBaseUrl}/c/${code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    reply.type('image/svg+xml').send(svg);
  });

  app.post('/api/staff/purchases', async (req) => {
    const { ctx } = await requireStaff(req, { operate: true });
    const b = z
      .object({
        cardCode: z.string().min(3).max(120),
        branchId: z.string().uuid(),
        ticketRef: z.string().trim().min(1, 'Escribe la referencia del ticket').max(60),
        amount: money,
        idempotencyKey: z.string().min(8).max(80),
        confirmPossibleDuplicate: z.boolean().optional(),
      })
      .parse(req.body);
    return confirmPurchase(ctx, { ...b, amountCents: b.amount });
  });

  app.get('/api/staff/operations/:key', async (req) => {
    const { ctx } = await requireStaff(req);
    return operationStatus(ctx, (req.params as any).key);
  });

  app.post('/api/staff/redemptions', async (req) => {
    const { ctx } = await requireStaff(req, { operate: true });
    const b = z
      .object({
        cardCode: z.string().min(3).max(120),
        branchId: z.string().uuid(),
        rewardId: z.string().uuid(),
        idempotencyKey: z.string().min(8).max(80),
        verificationCode: z.string().max(8).optional(),
      })
      .parse(req.body);
    return confirmRedemption(ctx, b);
  });

  app.post('/api/staff/redemptions/:id/deliver', async (req) => {
    const { ctx } = await requireStaff(req, { operate: true });
    return markDelivered(ctx, z.string().uuid().parse((req.params as any).id));
  });

  app.post('/api/staff/cards/:code/send-code', async (req) => {
    const { ctx } = await requireStaff(req, { operate: true });
    const { purpose } = z.object({ purpose: z.enum(['redeem', 'holder']) }).parse(req.body);
    return sendHolderCode(ctx, (req.params as any).code, purpose);
  });

  app.post('/api/staff/printed-cards', async (req) => {
    const { ctx } = await requireStaff(req, { operate: true });
    const { branchId } = z.object({ branchId: z.string().uuid() }).parse(req.body);
    return issuePrintedCard(ctx, branchId);
  });

  app.post('/api/staff/contingency', async (req) => {
    const { ctx } = await requireStaff(req, { operate: true });
    const b = z
      .object({
        branchId: z.string().uuid(),
        records: z.array(z.object({ cardCode: z.string().min(3).max(40), ticketRef: z.string().max(60), amount: money, occurredAt: z.string().min(8) })).min(1).max(100),
      })
      .parse(req.body);
    return captureContingency(ctx, b.branchId, b.records.map((r) => ({ ...r, amountCents: r.amount })));
  });

  // Cambio de turno: lo que pasó en la sucursal en las últimas horas y lo que quedó pendiente.
  app.get('/api/staff/shift', async (req) => {
    const { ctx } = await requireStaff(req);
    const branchId = z.string().uuid().parse((req.query as any).branchId);
    if (ctx.branchId && ctx.branchId !== branchId) throw new AppError(403, 'FORBIDDEN', 'Solo puedes ver tu sucursal.');
    const ok = await one(getPool(), `SELECT 1 FROM branches WHERE id = $1 AND company_id = $2`, [branchId, ctx.companyId]);
    if (!ok) throw new AppError(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada.');
    const purchases = await q<any>(
      getPool(),
      `SELECT pu.id, pu.ticket_ref, pu.points, pu.created_at, pu.status, pu.source, ca.code, u.name AS actor
       FROM purchases pu JOIN cards ca ON ca.id = pu.card_id JOIN users u ON u.id = pu.actor_user_id
       WHERE pu.branch_id = $1 AND pu.created_at > now() - interval '12 hours' ORDER BY pu.created_at DESC LIMIT 30`,
      [branchId],
    );
    const pendingDeliveries = await q<any>(
      getPool(),
      `SELECT re.id, re.reward_name, re.cost, re.created_at, re.status, ca.code, u.name AS actor
       FROM redemptions re JOIN cards ca ON ca.id = re.card_id JOIN users u ON u.id = re.actor_user_id
       WHERE re.branch_id = $1 AND re.status IN ('confirmed','disputed') ORDER BY re.created_at DESC LIMIT 30`,
      [branchId],
    );
    const contingency = await q<any>(
      getPool(),
      `SELECT id, card_code, ticket_ref, occurred_at, status FROM contingency_records WHERE branch_id = $1 AND status = 'pending' ORDER BY captured_at`,
      [branchId],
    );
    return { purchases, pendingDeliveries, contingency };
  });
}
