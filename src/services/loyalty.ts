import type pg from 'pg';
import { getPool, one, q, tx } from '../db.js';
import { config } from '../config.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { newCardCode, normalizeCardCode } from '../lib/security.js';
import { maskName } from '../lib/mask.js';
import { enqueueWalletSync, processWalletJobs } from './wallet.js';
import { checkOtp, consumeOtp } from './otp.js';

export type Role = 'owner' | 'manager' | 'employee';
export interface StaffCtx {
  userId: string;
  companyId: string;
  role: Role;
  branchId: string | null; // null = todas las sucursales de la empresa
  ip?: string | null;
}

const isManager = (ctx: StaffCtx) => ctx.role === 'owner' || ctx.role === 'manager';
export function requireManager(ctx: StaffCtx) {
  if (!isManager(ctx)) throw forbidden('Esta acción la autoriza el encargado o el dueño.');
}

// ---------- utilidades internas ----------

async function lockCard(c: pg.PoolClient, companyId: string, rawCode: string) {
  const code = normalizeCardCode(rawCode);
  const card = await one<any>(
    c,
    `SELECT ca.*, p.company_id, p.kind, p.name AS program_name, p.redeem_verification, p.status AS program_status,
            p.max_purchases_per_card_per_day, p.card_transferable
     FROM cards ca JOIN programs p ON p.id = ca.program_id
     WHERE ca.code = $1 AND p.company_id = $2
     FOR UPDATE OF ca`,
    [code, companyId],
  );
  // Misma respuesta si la tarjeta no existe o es de otro negocio: no se revela información ajena.
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'No encontramos esa tarjeta en este negocio. Revisa el número.');
  return card;
}

function assertCardActive(card: any) {
  if (card.status !== 'active') {
    const why: Record<string, string> = {
      replaced: 'fue reemplazada por una tarjeta nueva',
      merged: 'se unió a otra tarjeta',
      blocked: 'está bloqueada',
      closed: 'está cerrada',
    };
    throw new AppError(409, 'CARD_INACTIVE', `Esta tarjeta ${why[card.status] ?? 'no está activa'}. Usa la tarjeta vigente del cliente.`);
  }
  if (card.program_status !== 'active') throw new AppError(409, 'PROGRAM_INACTIVE', 'El programa de esta tarjeta está en pausa o cerrado.');
}

async function assertBranch(c: pg.PoolClient | pg.Pool, ctx: StaffCtx, branchId: string, programId?: string) {
  const b = await one<any>(c, `SELECT id, name, status FROM branches WHERE id = $1 AND company_id = $2`, [branchId, ctx.companyId]);
  if (!b) throw new AppError(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada en este negocio.');
  if (ctx.branchId && ctx.branchId !== branchId) throw forbidden('Tu cuenta solo puede operar en tu sucursal asignada.');
  if (b.status !== 'active') throw new AppError(409, 'BRANCH_INACTIVE', 'Esta sucursal está inactiva.');
  if (programId) {
    const ok = await one(c, `SELECT 1 FROM program_branches WHERE program_id = $1 AND branch_id = $2`, [programId, branchId]);
    if (!ok) {
      throw new AppError(409, 'BRANCH_NOT_IN_PROGRAM', 'Esta tarjeta pertenece a un programa que no aplica en esta sucursal. Los puntos solo se comparten si el dueño configuró un programa común.');
    }
  }
  return b;
}

export async function activeVersion(db: pg.PoolClient | pg.Pool, programId: string) {
  const v = await one<any>(
    db,
    `SELECT * FROM program_versions WHERE program_id = $1 AND effective_from <= now() ORDER BY version DESC LIMIT 1`,
    [programId],
  );
  if (!v) throw new AppError(409, 'NO_ACTIVE_RULES', 'El programa no tiene reglas vigentes.');
  return v;
}

export function effectiveCost(r: any): number {
  if (r.pending_cost && r.pending_cost_from && new Date(r.pending_cost_from) <= new Date()) return r.pending_cost;
  return r.cost;
}

async function ledger(
  c: pg.PoolClient,
  e: {
    card: any;
    branchId?: string | null;
    kind: string;
    points: number;
    balanceAfter: number;
    purchaseId?: string | null;
    redemptionId?: string | null;
    programVersion?: number | null;
    reason?: string | null;
    actorKind: 'staff' | 'system' | 'admin';
    actorUserId?: string | null;
    relatedEntryId?: number | null;
  },
) {
  const r = await one<{ id: number }>(
    c,
    `INSERT INTO ledger_entries(company_id, program_id, card_id, branch_id, kind, points, balance_after, purchase_id, redemption_id,
                                program_version, reason, actor_kind, actor_user_id, related_entry_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      e.card.company_id, e.card.program_id, e.card.id, e.branchId ?? null, e.kind, e.points, e.balanceAfter,
      e.purchaseId ?? null, e.redemptionId ?? null, e.programVersion ?? null, e.reason ?? null, e.actorKind,
      e.actorUserId ?? null, e.relatedEntryId ?? null,
    ],
  );
  return r!.id;
}

function kickWallet() {
  // Se procesa fuera de la transacción: si falla Wallet, la compra ya quedó guardada.
  setImmediate(() => processWalletJobs().catch(() => {}));
}

// ---------- consulta de tarjeta (empleado) ----------

export async function lookupCard(ctx: StaffCtx, rawCode: string) {
  const code = normalizeCardCode(rawCode);
  const pool = getPool();
  const card = await one<any>(
    pool,
    `SELECT ca.id, ca.code, ca.balance, ca.status, ca.format, ca.program_id, ca.last_activity_at, ca.created_at,
            p.name AS program_name, p.kind, p.redeem_verification, p.card_transferable,
            cu.display_name, cu.contact_verified_at, (cu.id IS NOT NULL) AS has_holder
     FROM cards ca JOIN programs p ON p.id = ca.program_id
     LEFT JOIN customers cu ON cu.id = ca.customer_id
     WHERE ca.code = $1 AND p.company_id = $2`,
    [code, ctx.companyId],
  );
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'No encontramos esa tarjeta en este negocio. Revisa el número.');
  const version = await activeVersion(pool, card.program_id);
  const rewards = await q<any>(pool, `SELECT * FROM rewards WHERE program_id = $1 AND active ORDER BY sort_order, cost`, [card.program_id]);
  const branches = await q<any>(
    pool,
    `SELECT b.id, b.name FROM program_branches pb JOIN branches b ON b.id = pb.branch_id WHERE pb.program_id = $1 ORDER BY b.name`,
    [card.program_id],
  );
  const movements = await q<any>(
    pool,
    `SELECT le.id, le.kind, le.points, le.balance_after, le.created_at, le.reason, b.name AS branch_name
     FROM ledger_entries le LEFT JOIN branches b ON b.id = le.branch_id
     WHERE le.card_id = $1 ORDER BY le.id DESC LIMIT 8`,
    [card.id],
  );
  return {
    card: {
      code: card.code,
      balance: card.balance,
      status: card.status,
      format: card.format,
      holder: card.has_holder ? maskName(card.display_name) : 'Tarjeta sin titular registrado (al portador)',
      holderVerified: !!card.contact_verified_at,
      programName: card.program_name,
      kind: card.kind,
      redeemVerification: card.has_holder ? card.redeem_verification : 'none',
      transferable: card.card_transferable,
    },
    rules: {
      pointsPerPurchase: version.points_per_purchase,
      minPurchaseCents: version.min_purchase_cents,
      eligible: version.eligible_description,
      expirationDays: version.expiration_days,
      version: version.version,
    },
    rewards: rewards.map((r) => {
      const cost = effectiveCost(r);
      return {
        id: r.id,
        name: r.name,
        cost,
        stock: r.stock,
        available: r.stock === null || r.stock > 0,
        affordable: card.balance >= cost,
      };
    }),
    branches,
    movements,
  };
}

// ---------- compra ----------

export interface PurchaseInput {
  cardCode: string;
  branchId: string;
  ticketRef: string;
  amountCents?: number | null;
  idempotencyKey: string;
  confirmPossibleDuplicate?: boolean;
  source?: 'counter' | 'contingency';
  occurredAt?: Date;
  actorUserId?: string; // para contingencia: quien capturó el comprobante
}

async function purchaseReplay(key: string, ctx: StaffCtx) {
  const prev = await one<any>(
    getPool(),
    `SELECT pu.*, ca.code AS card_code, ca.balance FROM purchases pu JOIN cards ca ON ca.id = pu.card_id WHERE pu.idempotency_key = $1`,
    [key],
  );
  if (!prev || prev.company_id !== ctx.companyId) return null;
  return {
    status: 'already_confirmed' as const,
    message: 'Esta compra ya estaba registrada. No se sumaron puntos otra vez.',
    purchase: { id: prev.id, ticketRef: prev.ticket_ref, points: prev.points, createdAt: prev.created_at },
    balance: prev.balance,
    cardCode: prev.card_code,
  };
}

export async function confirmPurchase(ctx: StaffCtx, input: PurchaseInput) {
  const ticket = input.ticketRef.trim();
  if (!ticket) throw new AppError(400, 'TICKET_REQUIRED', 'Escribe la referencia del ticket o nota de venta.');
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(input.idempotencyKey)) throw new AppError(400, 'BAD_IDEMPOTENCY_KEY', 'Clave de operación inválida.');
  try {
    const result = await tx(async (c) => {
      const card = await lockCard(c, ctx.companyId, input.cardCode);

      // 1) Misma operación repetida (reintento tras respuesta interrumpida): devolver el resultado original.
      const prev = await one<any>(c, `SELECT * FROM purchases WHERE idempotency_key = $1`, [input.idempotencyKey]);
      if (prev) {
        if (prev.company_id !== ctx.companyId || prev.card_id !== card.id || prev.ticket_ref.toLowerCase() !== ticket.toLowerCase()) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Esta clave de operación ya se usó para otra compra.');
        }
        return {
          status: 'already_confirmed' as const,
          message: 'Esta compra ya estaba registrada. No se sumaron puntos otra vez.',
          purchase: { id: prev.id, ticketRef: prev.ticket_ref, points: prev.points, createdAt: prev.created_at },
          balance: card.balance,
          cardCode: card.code,
        };
      }

      assertCardActive(card);
      await assertBranch(c, ctx, input.branchId, card.program_id);

      // 2) El mismo ticket no puede sumar dos veces en la sucursal.
      const dup = await one<any>(
        c,
        `SELECT pu.id, pu.created_at, pu.points, ca.code FROM purchases pu JOIN cards ca ON ca.id = pu.card_id
         WHERE pu.branch_id = $1 AND lower(pu.ticket_ref) = lower($2)`,
        [input.branchId, ticket],
      );
      if (dup) {
        throw new AppError(409, 'DUPLICATE_TICKET', `El ticket ${ticket} ya se registró. No se sumaron puntos otra vez.`, {
          existing: { id: dup.id, createdAt: dup.created_at, points: dup.points, cardCode: dup.code },
        });
      }

      const occurredAt = input.occurredAt ?? new Date();

      // 3) Límite diario por tarjeta (prevención de abuso).
      const today = await one<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM purchases
         WHERE card_id = $1 AND status = 'confirmed'
           AND (occurred_at AT TIME ZONE $2)::date = ($3::timestamptz AT TIME ZONE $2)::date`,
        [card.id, config.timezone, occurredAt.toISOString()],
      );
      if ((today?.n ?? 0) >= card.max_purchases_per_card_per_day) {
        throw new AppError(409, 'DAILY_LIMIT', `Esta tarjeta ya tiene ${today!.n} compras hoy, el máximo del programa. Si es legítimo, el encargado puede registrar un ajuste con motivo.`);
      }

      // 4) Posible doble registro sin ticket distinto: pedir confirmación explícita.
      if ((input.source ?? 'counter') === 'counter' && !input.confirmPossibleDuplicate) {
        const recent = await one<any>(
          c,
          `SELECT id, ticket_ref, created_at FROM purchases
           WHERE card_id = $1 AND branch_id = $2 AND created_at > now() - ($3 || ' minutes')::interval
           ORDER BY created_at DESC LIMIT 1`,
          [card.id, input.branchId, String(config.possibleDuplicateMinutes)],
        );
        if (recent) {
          throw new AppError(409, 'POSSIBLE_DUPLICATE', `Hace menos de ${config.possibleDuplicateMinutes} minutos se registró otra compra (ticket ${recent.ticket_ref}) en esta tarjeta. ¿Es una compra distinta?`, {
            recent: { ticketRef: recent.ticket_ref, createdAt: recent.created_at },
          });
        }
      }

      // 5) Regla vigente y elegibilidad.
      const v = await activeVersion(c, card.program_id);
      if (input.amountCents != null && input.amountCents < v.min_purchase_cents) {
        throw new AppError(422, 'NOT_ELIGIBLE', `La compra mínima para sumar es de $${(v.min_purchase_cents / 100).toFixed(2)}.`);
      }
      if (v.min_purchase_cents > 0 && input.amountCents == null) {
        throw new AppError(400, 'AMOUNT_REQUIRED', 'Este programa pide capturar el importe de la compra.');
      }
      const points = v.points_per_purchase;
      const actor = input.actorUserId ?? ctx.userId;

      const purchase = await one<any>(
        c,
        `INSERT INTO purchases(company_id, branch_id, program_id, card_id, ticket_ref, amount_cents, points, program_version,
                               idempotency_key, source, occurred_at, actor_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [ctx.companyId, input.branchId, card.program_id, card.id, ticket, input.amountCents ?? null, points, v.version,
         input.idempotencyKey, input.source ?? 'counter', occurredAt.toISOString(), actor],
      );
      const newBalance = card.balance + points;
      await c.query(`UPDATE cards SET balance = $2, last_activity_at = now() WHERE id = $1`, [card.id, newBalance]);
      await ledger(c, {
        card, branchId: input.branchId, kind: 'purchase', points, balanceAfter: newBalance, purchaseId: purchase.id,
        programVersion: v.version, actorKind: 'staff', actorUserId: actor,
      });
      await enqueueWalletSync(c, card.id);
      await audit(c, {
        actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'purchase.confirmed', entity: 'purchase',
        entityId: purchase.id, details: { card: card.code, ticket, points, rule_version: v.version, source: input.source ?? 'counter' }, ip: ctx.ip,
      });
      return {
        status: 'confirmed' as const,
        message: `Compra registrada: +${points} ${card.kind === 'stamps' ? 'sellos' : 'puntos'}.`,
        purchase: { id: purchase.id, ticketRef: ticket, points, createdAt: purchase.created_at, ruleVersion: v.version },
        balance: newBalance,
        cardCode: card.code,
      };
    });
    if (result.status === 'confirmed') kickWallet();
    return result;
  } catch (e: any) {
    if (e?.code === '23505') {
      // Dos intentos simultáneos con la misma clave o el mismo ticket: gana uno, el otro ve el resultado.
      const replay = await purchaseReplay(input.idempotencyKey, ctx);
      if (replay) return replay;
      throw new AppError(409, 'DUPLICATE_TICKET', `El ticket ${ticket} ya se registró. No se sumaron puntos otra vez.`);
    }
    throw e;
  }
}

// Estado de una operación por su clave (para "la pantalla se quedó cargando").
export async function operationStatus(ctx: StaffCtx, key: string) {
  const pool = getPool();
  const p = await one<any>(
    pool,
    `SELECT pu.id, pu.ticket_ref, pu.points, pu.created_at, pu.status, ca.code, ca.balance
     FROM purchases pu JOIN cards ca ON ca.id = pu.card_id WHERE pu.idempotency_key = $1 AND pu.company_id = $2`,
    [key, ctx.companyId],
  );
  if (p) return { found: true, type: 'purchase', status: p.status, ticketRef: p.ticket_ref, points: p.points, cardCode: p.code, balance: p.balance, createdAt: p.created_at };
  const r = await one<any>(
    pool,
    `SELECT re.id, re.reward_name, re.cost, re.created_at, re.status, ca.code, ca.balance
     FROM redemptions re JOIN cards ca ON ca.id = re.card_id WHERE re.idempotency_key = $1 AND re.company_id = $2`,
    [key, ctx.companyId],
  );
  if (r) return { found: true, type: 'redemption', status: r.status, reward: r.reward_name, cost: r.cost, cardCode: r.code, balance: r.balance, createdAt: r.created_at, id: r.id };
  return { found: false, message: 'No hay registro de esa operación: no se guardó. Puedes intentarla de nuevo con la misma clave.' };
}

// ---------- canje ----------

export interface RedeemInput {
  cardCode: string;
  branchId: string;
  rewardId: string;
  idempotencyKey: string;
  verificationCode?: string;
}

async function redemptionReplay(key: string, ctx: StaffCtx) {
  const prev = await one<any>(
    getPool(),
    `SELECT re.*, ca.code AS card_code, ca.balance FROM redemptions re JOIN cards ca ON ca.id = re.card_id WHERE re.idempotency_key = $1`,
    [key],
  );
  if (!prev || prev.company_id !== ctx.companyId) return null;
  return {
    status: 'already_confirmed' as const,
    message: 'Este canje ya estaba registrado. No se descontaron puntos otra vez.',
    redemption: { id: prev.id, reward: prev.reward_name, cost: prev.cost, status: prev.status, createdAt: prev.created_at },
    balance: prev.balance,
    cardCode: prev.card_code,
  };
}

export async function confirmRedemption(ctx: StaffCtx, input: RedeemInput) {
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(input.idempotencyKey)) throw new AppError(400, 'BAD_IDEMPOTENCY_KEY', 'Clave de operación inválida.');
  // Si el programa pide verificación del titular, el código se revisa antes (los intentos fallidos se registran).
  let otpId: string | null = null;
  const pre = await one<any>(
    getPool(),
    `SELECT ca.id, ca.customer_id, p.redeem_verification FROM cards ca JOIN programs p ON p.id = ca.program_id
     WHERE ca.code = $1 AND p.company_id = $2`,
    [normalizeCardCode(input.cardCode), ctx.companyId],
  );
  if (pre && pre.redeem_verification === 'otp' && pre.customer_id) {
    const already = await redemptionReplay(input.idempotencyKey, ctx);
    if (already) return already;
    if (!input.verificationCode) {
      throw new AppError(403, 'VERIFICATION_REQUIRED', 'Este programa pide confirmar al titular: envía el código al cliente y escríbelo aquí.');
    }
    const otp = await checkOtp({ purpose: 'redeem', cardId: pre.id, code: input.verificationCode });
    otpId = otp.id;
  }
  try {
    const result = await tx(async (c) => {
      // El bloqueo de la fila de la tarjeta hace que dos canjes simultáneos se atiendan uno después del otro.
      const card = await lockCard(c, ctx.companyId, input.cardCode);
      const prev = await one<any>(c, `SELECT * FROM redemptions WHERE idempotency_key = $1`, [input.idempotencyKey]);
      if (prev) {
        if (prev.company_id !== ctx.companyId || prev.card_id !== card.id) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Esta clave de operación ya se usó para otro canje.');
        }
        return {
          status: 'already_confirmed' as const,
          message: 'Este canje ya estaba registrado. No se descontaron puntos otra vez.',
          redemption: { id: prev.id, reward: prev.reward_name, cost: prev.cost, status: prev.status, createdAt: prev.created_at },
          balance: card.balance,
          cardCode: card.code,
        };
      }
      assertCardActive(card);
      await assertBranch(c, ctx, input.branchId, card.program_id);

      const reward = await one<any>(c, `SELECT * FROM rewards WHERE id = $1 AND program_id = $2 FOR UPDATE`, [input.rewardId, card.program_id]);
      if (!reward || !reward.active) throw new AppError(404, 'REWARD_NOT_FOUND', 'Ese premio no existe o no está activo en este programa.');
      if (reward.stock !== null && reward.stock <= 0) {
        throw new AppError(409, 'REWARD_OUT_OF_STOCK', 'Premio agotado. No se descontaron puntos. El encargado puede ofrecer otra opción del catálogo.');
      }
      const cost = effectiveCost(reward);
      if (card.balance < cost) {
        throw new AppError(409, 'INSUFFICIENT_BALANCE', `Saldo insuficiente: tiene ${card.balance} y el premio cuesta ${cost}. No se descontó nada.`, {
          balance: card.balance, cost,
        });
      }
      if (otpId) await consumeOtp(c, otpId);

      const newBalance = card.balance - cost;
      await c.query(`UPDATE cards SET balance = $2, last_activity_at = now() WHERE id = $1`, [card.id, newBalance]);
      if (reward.stock !== null) await c.query(`UPDATE rewards SET stock = stock - 1 WHERE id = $1`, [reward.id]);
      const red = await one<any>(
        c,
        `INSERT INTO redemptions(company_id, branch_id, program_id, card_id, reward_id, reward_name, cost, idempotency_key, actor_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ctx.companyId, input.branchId, card.program_id, card.id, reward.id, reward.name, cost, input.idempotencyKey, ctx.userId],
      );
      await ledger(c, {
        card, branchId: input.branchId, kind: 'redemption', points: -cost, balanceAfter: newBalance, redemptionId: red.id,
        actorKind: 'staff', actorUserId: ctx.userId,
      });
      await enqueueWalletSync(c, card.id);
      await audit(c, {
        actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'redemption.confirmed', entity: 'redemption',
        entityId: red.id, details: { card: card.code, reward: reward.name, cost, verified: !!otpId }, ip: ctx.ip,
      });
      return {
        status: 'confirmed' as const,
        message: `Canje registrado: ${reward.name} (−${cost}). Entrega el premio y márcalo como entregado.`,
        redemption: { id: red.id, reward: reward.name, cost, status: red.status, createdAt: red.created_at },
        balance: newBalance,
        cardCode: card.code,
      };
    });
    if (result.status === 'confirmed') kickWallet();
    return result;
  } catch (e: any) {
    if (e?.code === '23505') {
      const replay = await redemptionReplay(input.idempotencyKey, ctx);
      if (replay) return replay;
    }
    if (e?.code === '23514') {
      // CHECK (balance >= 0): última barrera si algo intentara dejar saldo negativo.
      throw new AppError(409, 'INSUFFICIENT_BALANCE', 'Saldo insuficiente. No se descontó nada.');
    }
    throw e;
  }
}

export async function markDelivered(ctx: StaffCtx, redemptionId: string) {
  return tx(async (c) => {
    const r = await one<any>(c, `SELECT * FROM redemptions WHERE id = $1 AND company_id = $2 FOR UPDATE`, [redemptionId, ctx.companyId]);
    if (!r) throw notFound('Canje');
    if (r.status === 'delivered') return { status: 'delivered', message: 'Ya estaba marcado como entregado.' };
    if (r.status !== 'confirmed') throw new AppError(409, 'BAD_STATE', 'Este canje está en revisión o revertido.');
    await c.query(`UPDATE redemptions SET status = 'delivered', delivered_at = now(), delivered_by = $2 WHERE id = $1`, [r.id, ctx.userId]);
    await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'redemption.delivered', entity: 'redemption', entityId: r.id, ip: ctx.ip });
    return { status: 'delivered', message: 'Premio marcado como entregado.' };
  });
}

// ---------- correcciones (encargado / dueño) ----------

export async function adjustPoints(ctx: StaffCtx, input: { cardCode: string; points: number; reason: string; relatedEntryId?: number | null }) {
  requireManager(ctx);
  if (!Number.isInteger(input.points) || input.points === 0 || Math.abs(input.points) > 1000) {
    throw new AppError(400, 'BAD_POINTS', 'El ajuste debe ser un número entero distinto de cero, máximo ±1000.');
  }
  if (!input.reason || input.reason.trim().length < 10) throw new AppError(400, 'REASON_REQUIRED', 'Escribe el motivo del ajuste (mínimo 10 caracteres).');
  const result = await tx(async (c) => {
    const card = await lockCard(c, ctx.companyId, input.cardCode);
    if (card.status !== 'active') throw new AppError(409, 'CARD_INACTIVE', 'La tarjeta no está activa.');
    if (input.relatedEntryId) {
      const rel = await one(c, `SELECT 1 FROM ledger_entries WHERE id = $1 AND card_id = $2`, [input.relatedEntryId, card.id]);
      if (!rel) throw new AppError(400, 'BAD_RELATED', 'El movimiento relacionado no pertenece a esta tarjeta.');
    }
    const newBalance = card.balance + input.points;
    if (newBalance < 0) throw new AppError(409, 'INSUFFICIENT_BALANCE', `El ajuste dejaría saldo negativo (saldo actual ${card.balance}).`);
    await c.query(`UPDATE cards SET balance = $2 WHERE id = $1`, [card.id, newBalance]);
    const entryId = await ledger(c, {
      card, kind: 'adjustment', points: input.points, balanceAfter: newBalance, reason: input.reason.trim(), actorKind: 'staff',
      actorUserId: ctx.userId, relatedEntryId: input.relatedEntryId ?? null,
    });
    await enqueueWalletSync(c, card.id);
    await audit(c, {
      actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'card.adjusted', entity: 'card', entityId: card.code,
      details: { points: input.points, reason: input.reason, related_entry: input.relatedEntryId ?? null }, ip: ctx.ip,
    });
    return { status: 'adjusted', entryId, balance: newBalance, message: `Ajuste registrado (${input.points > 0 ? '+' : ''}${input.points}). El movimiento original se conserva.` };
  });
  kickWallet();
  return result;
}

export async function refundPurchase(ctx: StaffCtx, purchaseId: string, reason: string) {
  requireManager(ctx);
  if (!reason || reason.trim().length < 10) throw new AppError(400, 'REASON_REQUIRED', 'Escribe el motivo de la devolución (mínimo 10 caracteres).');
  const result = await tx(async (c) => {
    const p = await one<any>(c, `SELECT * FROM purchases WHERE id = $1 AND company_id = $2 FOR UPDATE`, [purchaseId, ctx.companyId]);
    if (!p) throw notFound('Compra');
    if (p.status === 'refunded') throw new AppError(409, 'ALREADY_REFUNDED', 'Esta compra ya se marcó como devuelta.');
    const card = await one<any>(c, `SELECT ca.*, pr.company_id FROM cards ca JOIN programs pr ON pr.id = ca.program_id WHERE ca.id = $1 FOR UPDATE OF ca`, [p.card_id]);
    const revert = Math.min(p.points, card.balance);
    const shortfall = p.points - revert;
    let balance = card.balance;
    if (revert > 0) {
      balance = card.balance - revert;
      await c.query(`UPDATE cards SET balance = $2 WHERE id = $1`, [card.id, balance]);
      await ledger(c, { card, branchId: p.branch_id, kind: 'refund', points: -revert, balanceAfter: balance, purchaseId: p.id, reason: reason.trim(), actorKind: 'staff', actorUserId: ctx.userId });
    }
    await c.query(`UPDATE purchases SET status = 'refunded', refunded_at = now(), refunded_by = $2, refund_reason = $3 WHERE id = $1`, [p.id, ctx.userId, reason.trim()]);
    if (shortfall > 0) {
      await c.query(
        `INSERT INTO incidents(company_id, kind, priority, title, description, created_by)
         VALUES ($1, 'devolucion', 'media', $2, $3, $4)`,
        [ctx.companyId, `Devolución con puntos ya usados (ticket ${p.ticket_ref})`,
         `Se revirtieron ${revert} de ${p.points} puntos; faltan ${shortfall} porque ya se habían canjeado. Resolver según la política publicada; no cobrar al cliente sin acuerdo.`, ctx.userId],
      );
    }
    await enqueueWalletSync(c, card.id);
    await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'purchase.refunded', entity: 'purchase', entityId: p.id, details: { revert, shortfall, reason }, ip: ctx.ip });
    return {
      status: 'refunded', reverted: revert, shortfall, balance,
      message: shortfall > 0
        ? `Se revirtieron ${revert} puntos. Faltan ${shortfall} que ya se habían canjeado: se abrió un caso para resolverlo con la política del negocio.`
        : `Devolución registrada: se revirtieron ${revert} puntos.`,
    };
  });
  kickWallet();
  return result;
}

export async function disputeRedemption(ctx: StaffCtx, redemptionId: string, note: string) {
  requireManager(ctx);
  if (!note || note.trim().length < 10) throw new AppError(400, 'REASON_REQUIRED', 'Describe la disputa (mínimo 10 caracteres).');
  return tx(async (c) => {
    const r = await one<any>(c, `SELECT * FROM redemptions WHERE id = $1 AND company_id = $2 FOR UPDATE`, [redemptionId, ctx.companyId]);
    if (!r) throw notFound('Canje');
    if (!['confirmed', 'delivered'].includes(r.status)) throw new AppError(409, 'BAD_STATE', 'Este canje ya está en revisión o revertido.');
    await c.query(`UPDATE redemptions SET status = 'disputed', dispute_note = $2, disputed_at = now() WHERE id = $1`, [r.id, note.trim()]);
    await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'redemption.disputed', entity: 'redemption', entityId: r.id, details: { note }, ip: ctx.ip });
    return { status: 'disputed', message: 'Canje en revisión. Los puntos no cambian hasta resolver.' };
  });
}

export async function resolveRedemption(ctx: StaffCtx, redemptionId: string, resolution: 'upheld' | 'reversed', note: string) {
  requireManager(ctx);
  if (!note || note.trim().length < 10) throw new AppError(400, 'REASON_REQUIRED', 'Escribe la resolución (mínimo 10 caracteres).');
  const result = await tx(async (c) => {
    const r = await one<any>(c, `SELECT * FROM redemptions WHERE id = $1 AND company_id = $2 FOR UPDATE`, [redemptionId, ctx.companyId]);
    if (!r) throw notFound('Canje');
    if (r.status !== 'disputed') throw new AppError(409, 'BAD_STATE', 'Solo se resuelven canjes en revisión.');
    let balance: number | null = null;
    if (resolution === 'reversed') {
      const card = await one<any>(c, `SELECT ca.*, pr.company_id FROM cards ca JOIN programs pr ON pr.id = ca.program_id WHERE ca.id = $1 FOR UPDATE OF ca`, [r.card_id]);
      const restored: number = card.balance + r.cost;
      balance = restored;
      await c.query(`UPDATE cards SET balance = $2 WHERE id = $1`, [card.id, restored]);
      await ledger(c, { card, branchId: r.branch_id, kind: 'redemption_reversal', points: r.cost, balanceAfter: restored, redemptionId: r.id, reason: note.trim(), actorKind: 'staff', actorUserId: ctx.userId });
      await enqueueWalletSync(c, card.id);
    }
    await c.query(
      `UPDATE redemptions SET status = $2, resolved_at = now(), resolved_by = $3, resolution = $4 WHERE id = $1`,
      [r.id, resolution === 'reversed' ? 'reversed' : 'delivered', ctx.userId, note.trim()],
    );
    await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: `redemption.${resolution}`, entity: 'redemption', entityId: r.id, details: { note }, ip: ctx.ip });
    return {
      status: resolution, balance,
      message: resolution === 'reversed' ? `Se repusieron ${r.cost} puntos con registro. No se generó otro canje.` : 'Se confirmó la entrega. Saldo sin cambios.',
    };
  });
  kickWallet();
  return result;
}

// Verificación del titular (para reemplazo o fusión): envía un código al contacto registrado.
export async function sendHolderCode(ctx: StaffCtx, rawCode: string, purpose: 'holder' | 'redeem') {
  const pool = getPool();
  const card = await one<any>(
    pool,
    `SELECT ca.id, ca.code, cu.id AS customer_id, cu.email, cu.phone, cu.preferred_channel, cu.contact_verified_at
     FROM cards ca JOIN programs p ON p.id = ca.program_id LEFT JOIN customers cu ON cu.id = ca.customer_id
     WHERE ca.code = $1 AND p.company_id = $2`,
    [normalizeCardCode(rawCode), ctx.companyId],
  );
  if (!card) throw new AppError(404, 'CARD_NOT_FOUND', 'No encontramos esa tarjeta en este negocio.');
  if (!card.customer_id || !card.contact_verified_at) {
    throw new AppError(409, 'NO_VERIFIABLE_HOLDER', 'Esta tarjeta no tiene un contacto verificado. No se puede confirmar al titular por mensaje; escala al encargado.');
  }
  const channel = card.preferred_channel !== 'none' ? card.preferred_channel : card.email ? 'email' : 'sms';
  const destination = channel === 'email' ? card.email : card.phone;
  const { issueOtp, maskDestination } = await import('./otp.js');
  await issueOtp(pool, { purpose, channel, destination, customerId: card.customer_id, cardId: card.id });
  await audit(pool, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: `otp.${purpose}.sent`, entity: 'card', entityId: card.code, ip: ctx.ip });
  return { sent: true, channel, to: maskDestination(destination), simulated: true, message: `Código enviado por ${channel} a ${maskDestination(destination)} (simulado: revisa el buzón de la demo).` };
}

async function transfer(c: pg.PoolClient, ctx: StaffCtx, from: any, to: any, reason: string, kindOut = 'transfer_out', kindIn = 'transfer_in') {
  if (from.balance > 0) {
    const outId = await ledger(c, { card: from, kind: kindOut, points: -from.balance, balanceAfter: 0, reason, actorKind: 'staff', actorUserId: ctx.userId });
    const newTo = to.balance + from.balance;
    await c.query(`UPDATE cards SET balance = 0 WHERE id = $1`, [from.id]);
    await c.query(`UPDATE cards SET balance = $2 WHERE id = $1`, [to.id, newTo]);
    await ledger(c, { card: to, kind: kindIn, points: from.balance, balanceAfter: newTo, reason, actorKind: 'staff', actorUserId: ctx.userId, relatedEntryId: outId });
    return newTo;
  }
  return to.balance;
}

export async function mergeCards(ctx: StaffCtx, input: { fromCode: string; toCode: string; reason: string; verificationCode?: string }) {
  requireManager(ctx);
  if (!input.reason || input.reason.trim().length < 10) throw new AppError(400, 'REASON_REQUIRED', 'Escribe el motivo (mínimo 10 caracteres).');
  const fromCode = normalizeCardCode(input.fromCode);
  const toCode = normalizeCardCode(input.toCode);
  if (fromCode === toCode) throw new AppError(400, 'SAME_CARD', 'Son la misma tarjeta.');
  const pool = getPool();
  const pre = await one<any>(pool, `SELECT ca.id, ca.customer_id FROM cards ca JOIN programs p ON p.id = ca.program_id WHERE ca.code = $1 AND p.company_id = $2`, [fromCode, ctx.companyId]);
  const preTo = await one<any>(pool, `SELECT ca.id, ca.customer_id FROM cards ca JOIN programs p ON p.id = ca.program_id WHERE ca.code = $1 AND p.company_id = $2`, [toCode, ctx.companyId]);
  if (!pre || !preTo) throw new AppError(404, 'CARD_NOT_FOUND', 'Alguna de las tarjetas no existe en este negocio.');
  let otpId: string | null = null;
  const sameHolder = pre.customer_id && pre.customer_id === preTo.customer_id;
  if (pre.customer_id && !sameHolder) {
    if (!input.verificationCode) throw new AppError(403, 'VERIFICATION_REQUIRED', 'Confirma al titular de la tarjeta que se va a unir: envíale un código y escríbelo aquí.');
    otpId = (await checkOtp({ purpose: 'holder', cardId: pre.id, code: input.verificationCode })).id;
  }
  const result = await tx(async (c) => {
    // Bloqueo en orden fijo para evitar interbloqueos.
    const [a, b] = [fromCode, toCode].sort();
    const ca = await lockCard(c, ctx.companyId, a);
    const cb = await lockCard(c, ctx.companyId, b);
    const from = ca.code === fromCode ? ca : cb;
    const to = ca.code === fromCode ? cb : ca;
    if (from.program_id !== to.program_id) throw new AppError(409, 'DIFFERENT_PROGRAM', 'Solo se unen tarjetas del mismo programa.');
    if (from.status !== 'active' || to.status !== 'active') throw new AppError(409, 'CARD_INACTIVE', 'Ambas tarjetas deben estar activas.');
    if (otpId) await consumeOtp(c, otpId);
    const moved = from.balance;
    const newTo = await transfer(c, ctx, from, to, `Fusión: ${input.reason.trim()}`);
    await c.query(`UPDATE cards SET status = 'merged', replaced_by = $2 WHERE id = $1`, [from.id, to.id]);
    await enqueueWalletSync(c, to.id);
    await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'card.merged', entity: 'card', entityId: from.code, details: { into: to.code, moved, reason: input.reason, verified: !!otpId || sameHolder }, ip: ctx.ip });
    return { status: 'merged', moved, balance: newTo, message: `Se movieron ${moved} puntos de ${from.code} a ${to.code}. ${from.code} quedó inválida.` };
  });
  kickWallet();
  return result;
}

export async function replaceCard(ctx: StaffCtx, input: { code: string; reason: string; verificationCode: string }) {
  requireManager(ctx);
  if (!input.reason || input.reason.trim().length < 10) throw new AppError(400, 'REASON_REQUIRED', 'Escribe el motivo (mínimo 10 caracteres).');
  const pool = getPool();
  const pre = await one<any>(pool, `SELECT ca.id, ca.customer_id FROM cards ca JOIN programs p ON p.id = ca.program_id WHERE ca.code = $1 AND p.company_id = $2`, [normalizeCardCode(input.code), ctx.companyId]);
  if (!pre) throw new AppError(404, 'CARD_NOT_FOUND', 'No encontramos esa tarjeta en este negocio.');
  if (!pre.customer_id) throw new AppError(409, 'NO_VERIFIABLE_HOLDER', 'La tarjeta no tiene titular con contacto verificado: no se puede reponer. Así se informó al emitirla.');
  if (!input.verificationCode) throw new AppError(403, 'VERIFICATION_REQUIRED', 'Envía un código al titular y escríbelo aquí.');
  const otp = await checkOtp({ purpose: 'holder', cardId: pre.id, code: input.verificationCode });
  const result = await tx(async (c) => {
    const old = await lockCard(c, ctx.companyId, input.code);
    if (old.status !== 'active') throw new AppError(409, 'CARD_INACTIVE', 'La tarjeta no está activa.');
    await consumeOtp(c, otp.id);
    await c.query(`UPDATE cards SET status = 'replaced' WHERE id = $1`, [old.id]);
    let fresh: any = null;
    for (let i = 0; i < 5 && !fresh; i++) {
      fresh = await one<any>(
        c,
        `INSERT INTO cards(code, program_id, customer_id, format, issued_branch_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (code) DO NOTHING RETURNING *`,
        [newCardCode(), old.program_id, old.customer_id, old.format, old.issued_branch_id],
      );
    }
    fresh.company_id = old.company_id;
    const balance = await transfer(c, ctx, old, fresh, `Reposición: ${input.reason.trim()}`);
    await c.query(`UPDATE cards SET replaced_by = $2 WHERE id = $1`, [old.id, fresh.id]);
    await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'card.replaced', entity: 'card', entityId: old.code, details: { newCode: fresh.code, reason: input.reason }, ip: ctx.ip });
    return { status: 'replaced', newCode: fresh.code, balance, message: `Tarjeta repuesta. Nuevo número ${fresh.code}; ${old.code} ya no funciona.` };
  });
  return result;
}

// ---------- tarjeta impresa (cliente sin celular) ----------

export async function issuePrintedCard(ctx: StaffCtx, branchId: string) {
  return tx(async (c) => {
    const pb = await one<any>(c, `SELECT program_id FROM program_branches WHERE branch_id = $1`, [branchId]);
    await assertBranch(c, ctx, branchId, pb?.program_id);
    let card: any = null;
    for (let i = 0; i < 5 && !card; i++) {
      card = await one<any>(
        c,
        `INSERT INTO cards(code, program_id, format, issued_branch_id) VALUES ($1,$2,'printed',$3) ON CONFLICT (code) DO NOTHING RETURNING *`,
        [newCardCode(), pb.program_id, branchId],
      );
    }
    await audit(c, { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'card.printed_issued', entity: 'card', entityId: card.code, ip: ctx.ip });
    return {
      code: card.code,
      message: 'Tarjeta impresa creada con 0 puntos. Avisa al cliente: sin contacto registrado funciona al portador y no se puede reponer si se pierde.',
    };
  });
}

// ---------- contingencia sin internet ----------

export async function captureContingency(ctx: StaffCtx, branchId: string, records: { cardCode: string; ticketRef: string; amountCents?: number | null; occurredAt: string }[]) {
  await assertBranch(getPool(), ctx, branchId);
  const out: any[] = [];
  for (const r of records) {
    const ticket = String(r.ticketRef ?? '').trim();
    const occurred = new Date(r.occurredAt);
    if (!ticket || Number.isNaN(occurred.getTime())) {
      out.push({ ticketRef: ticket, status: 'error', message: 'Falta ticket o fecha.' });
      continue;
    }
    const existing = await one(getPool(), `SELECT 1 FROM purchases WHERE branch_id = $1 AND lower(ticket_ref) = lower($2)`, [branchId, ticket]);
    if (existing) {
      out.push({ ticketRef: ticket, status: 'duplicate', message: 'Ese ticket ya está registrado como compra.' });
      continue;
    }
    try {
      const row = await one<any>(
        getPool(),
        `INSERT INTO contingency_records(company_id, branch_id, card_code, ticket_ref, amount_cents, occurred_at, captured_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ctx.companyId, branchId, normalizeCardCode(r.cardCode), ticket, r.amountCents ?? null, occurred.toISOString(), ctx.userId],
      );
      out.push({ ticketRef: ticket, status: 'pending', id: row.id, message: 'Pendiente de revisión del encargado.' });
    } catch (e: any) {
      if (e?.code === '23505') out.push({ ticketRef: ticket, status: 'duplicate', message: 'Ese ticket ya está capturado en contingencia.' });
      else throw e;
    }
  }
  await audit(getPool(), { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'contingency.captured', details: { count: records.length }, ip: ctx.ip });
  return { results: out };
}

export async function applyContingency(ctx: StaffCtx, recordId: string, decision: 'apply' | 'reject', note?: string) {
  requireManager(ctx);
  const rec = await one<any>(getPool(), `SELECT * FROM contingency_records WHERE id = $1 AND company_id = $2`, [recordId, ctx.companyId]);
  if (!rec) throw notFound('Registro de contingencia');
  if (rec.status !== 'pending') throw new AppError(409, 'BAD_STATE', 'Este registro ya fue revisado.');
  if (decision === 'reject') {
    await getPool().query(`UPDATE contingency_records SET status='rejected', note=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`, [rec.id, note ?? null, ctx.userId]);
    await audit(getPool(), { actorKind: 'staff', actorId: ctx.userId, companyId: ctx.companyId, action: 'contingency.rejected', entity: 'contingency', entityId: rec.id, details: { note }, ip: ctx.ip });
    return { status: 'rejected' };
  }
  try {
    const r = await confirmPurchase(
      ctx,
      {
        cardCode: rec.card_code, branchId: rec.branch_id, ticketRef: rec.ticket_ref, amountCents: rec.amount_cents,
        idempotencyKey: `cont:${rec.id}`, source: 'contingency', occurredAt: new Date(rec.occurred_at), actorUserId: rec.captured_by,
      },
    );
    await getPool().query(`UPDATE contingency_records SET status='applied', purchase_id=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`, [rec.id, r.purchase.id, ctx.userId]);
    return { status: 'applied', balance: r.balance, message: r.message };
  } catch (e: any) {
    if (e instanceof AppError) {
      const st = e.code === 'DUPLICATE_TICKET' ? 'duplicate' : 'rejected';
      await getPool().query(`UPDATE contingency_records SET status=$2, note=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1`, [rec.id, st, e.message, ctx.userId]);
      return { status: st, message: e.message };
    }
    throw e;
  }
}

// ---------- vencimiento de puntos ----------

export async function expirePoints(actor: { kind: 'admin' | 'system'; userId?: string | null }) {
  const pool = getPool();
  const candidates = await q<any>(
    pool,
    `SELECT ca.id, ca.code, ca.balance, v.expiration_days
     FROM cards ca
     JOIN LATERAL (SELECT expiration_days FROM program_versions pv WHERE pv.program_id = ca.program_id AND pv.effective_from <= now()
                   ORDER BY version DESC LIMIT 1) v ON true
     WHERE ca.status = 'active' AND ca.balance > 0 AND v.expiration_days IS NOT NULL
       AND ca.last_activity_at < now() - (v.expiration_days || ' days')::interval`,
  );
  let expired = 0;
  for (const cand of candidates) {
    await tx(async (c) => {
      const card = await one<any>(c, `SELECT ca.*, p.company_id FROM cards ca JOIN programs p ON p.id = ca.program_id WHERE ca.id = $1 FOR UPDATE OF ca`, [cand.id]);
      if (!card || card.balance <= 0) return;
      await c.query(`UPDATE cards SET balance = 0 WHERE id = $1`, [card.id]);
      await ledger(c, { card, kind: 'expiration', points: -card.balance, balanceAfter: 0, reason: `Vencimiento por ${cand.expiration_days} días sin compras`, actorKind: actor.kind === 'admin' ? 'admin' : 'system', actorUserId: actor.userId ?? null });
      await enqueueWalletSync(c, card.id);
      expired++;
    });
  }
  if (expired) kickWallet();
  return { checked: candidates.length, expired };
}
