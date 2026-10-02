import type { FastifyReply, FastifyRequest } from 'fastify';
import { getPool, one } from '../db.js';
import { config } from '../config.js';
import { AppError } from './errors.js';
import { newToken, sha256 } from './security.js';
import type { Role, StaffCtx } from '../services/loyalty.js';

export const STAFF_COOKIE = 'cs_staff';
export const CUSTOMER_COOKIE = 'cs_cliente';

const secureCookies = () => config.publicBaseUrl.startsWith('https://');

export async function createSession(
  reply: FastifyReply,
  req: FastifyRequest,
  kind: 'staff' | 'customer',
  ids: { userId?: string; customerId?: string; companyId?: string | null },
) {
  const token = newToken();
  const hours = kind === 'staff' ? config.staffSessionHours : config.customerSessionDays * 24;
  await getPool().query(
    `INSERT INTO sessions(token_hash, kind, user_id, customer_id, company_id, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' hours')::interval, $7, $8)`,
    [sha256(token), kind, ids.userId ?? null, ids.customerId ?? null, ids.companyId ?? null, String(hours), req.ip, String(req.headers['user-agent'] ?? '').slice(0, 200)],
  );
  reply.setCookie(kind === 'staff' ? STAFF_COOKIE : CUSTOMER_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    maxAge: hours * 3600,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply, kind: 'staff' | 'customer') {
  const name = kind === 'staff' ? STAFF_COOKIE : CUSTOMER_COOKIE;
  const token = req.cookies[name];
  if (token) await getPool().query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE token_hash = $1`, [sha256(token)]);
  reply.clearCookie(name, { path: '/' });
}

export interface StaffSession {
  sessionId: string;
  user: { id: string; name: string; email: string; isAdmin: boolean; mustChangePassword: boolean };
  ctx: StaffCtx | null; // null para administradores de la plataforma sin empresa
  company: { id: string; name: string; status: string; slug: string; cardColor: string } | null;
  membership: { id: string; role: Role; branchId: string | null } | null;
}

export async function loadStaff(req: FastifyRequest): Promise<StaffSession | null> {
  const token = req.cookies[STAFF_COOKIE];
  if (!token) return null;
  const s = await one<any>(
    getPool(),
    `SELECT s.id, s.company_id, u.id AS user_id, u.name, u.email, u.is_platform_admin, u.must_change_password, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.kind = 'staff' AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!s || s.status !== 'active') return null;
  const result: StaffSession = {
    sessionId: s.id,
    user: { id: s.user_id, name: s.name, email: s.email, isAdmin: s.is_platform_admin, mustChangePassword: s.must_change_password },
    ctx: null,
    company: null,
    membership: null,
  };
  if (s.company_id) {
    // La membresía se revisa en CADA petición: si el dueño revoca al empleado, pierde acceso de inmediato.
    const m = await one<any>(
      getPool(),
      `SELECT m.id, m.role, m.branch_id, c.id AS company_id, c.name, c.status, c.slug, c.card_color
       FROM memberships m JOIN companies c ON c.id = m.company_id
       WHERE m.user_id = $1 AND m.company_id = $2 AND m.status = 'active'`,
      [s.user_id, s.company_id],
    );
    if (!m) return s.is_platform_admin ? result : null;
    result.company = { id: m.company_id, name: m.name, status: m.status, slug: m.slug, cardColor: m.card_color };
    result.membership = { id: m.id, role: m.role, branchId: m.branch_id };
    result.ctx = { userId: s.user_id, companyId: m.company_id, role: m.role, branchId: m.branch_id, ip: req.ip };
  }
  getPool().query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [s.id]).catch(() => {});
  return result;
}

export async function requireStaff(req: FastifyRequest, opts: { roles?: Role[]; operate?: boolean } = {}): Promise<{ s: StaffSession; ctx: StaffCtx }> {
  const s = await loadStaff(req);
  if (!s) throw new AppError(401, 'UNAUTHENTICATED', 'Tu sesión terminó o fue revocada. Vuelve a entrar.');
  if (!s.ctx || !s.company) throw new AppError(403, 'NO_COMPANY', 'Tu cuenta no tiene un negocio activo.');
  if (opts.roles && !opts.roles.includes(s.ctx.role)) throw new AppError(403, 'FORBIDDEN', 'Tu rol no permite esta acción.');
  if (opts.operate) {
    if (s.company.status === 'suspended') throw new AppError(403, 'COMPANY_SUSPENDED', 'El servicio de este negocio está suspendido. Los saldos se conservan; contacta a soporte.');
    if (s.company.status !== 'approved') throw new AppError(403, 'COMPANY_NOT_APPROVED', 'El negocio aún no está aprobado para operar.');
  }
  return { s, ctx: s.ctx };
}

export async function requireAdmin(req: FastifyRequest) {
  const s = await loadStaff(req);
  if (!s) throw new AppError(401, 'UNAUTHENTICATED', 'Vuelve a entrar.');
  if (!s.user.isAdmin) throw new AppError(403, 'FORBIDDEN', 'Solo administradores de la plataforma.');
  return s;
}

export async function loadCustomer(req: FastifyRequest) {
  const token = req.cookies[CUSTOMER_COOKIE];
  if (!token) return null;
  return one<any>(
    getPool(),
    `SELECT c.* FROM sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token_hash = $1 AND s.kind = 'customer' AND s.revoked_at IS NULL AND s.expires_at > now() AND c.status = 'active'`,
    [sha256(token)],
  );
}

export async function requireCustomer(req: FastifyRequest) {
  const c = await loadCustomer(req);
  if (!c) throw new AppError(401, 'UNAUTHENTICATED', 'Entra con tu código para ver tus tarjetas.');
  return c;
}

export async function revokeUserSessions(userId: string, reason: string) {
  await getPool().query(`UPDATE sessions SET revoked_at = now(), revoke_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [userId, reason]);
}
