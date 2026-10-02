import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { getPool, one, q, tx } from '../db.js';
import { config } from '../config.js';
import { AppError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { createSession, destroySession, requireCustomer } from '../lib/auth.js';
import { normalizeCardCode } from '../lib/security.js';
import { activeVersion, effectiveCost } from '../services/loyalty.js';
import { checkOtp, consumeOtp, issueOtp, maskDestination, normalizeContact } from '../services/otp.js';
import { enqueueWalletSync, processWalletJobs } from '../services/wallet.js';

export async function customerRoutes(app: FastifyInstance) {
  // Recuperación / entrada: código al contacto registrado (SMS, WhatsApp o correo).
  app.post('/api/customer/login/start', async (req) => {
    const b = z
      .object({ contactType: z.enum(['phone', 'email']), contact: z.string().min(5).max(120), channel: z.enum(['sms', 'whatsapp', 'email']) })
      .parse(req.body);
    const destination = normalizeContact(b.contactType, b.contact);
    const channel = b.contactType === 'email' ? 'email' : b.channel === 'email' ? 'sms' : b.channel;
    const field = b.contactType === 'email' ? 'email' : 'phone';
    const customer = await one<any>(getPool(), `SELECT id FROM customers WHERE ${field} = $1 AND status = 'active' AND contact_verified_at IS NOT NULL`, [destination]);
    if (customer) await issueOtp(getPool(), { purpose: 'login', channel, destination, customerId: customer.id });
    // Misma respuesta exista o no la cuenta, para no revelar quién está registrado.
    return { to: maskDestination(destination), channel, message: 'Si ese contacto tiene tarjetas, te enviamos un código.', simulated: config.messagingProvider === 'simulated' };
  });

  app.post('/api/customer/login/verify', async (req, reply) => {
    const b = z.object({ contactType: z.enum(['phone', 'email']), contact: z.string().min(5).max(120), code: z.string().min(4).max(8) }).parse(req.body);
    const destination = normalizeContact(b.contactType, b.contact);
    const otp = await checkOtp({ purpose: 'login', destination, code: b.code });
    await tx(async (c) => {
      await consumeOtp(c, otp.id);
      await audit(c, { actorKind: 'customer', actorId: otp.customer_id, action: 'customer.login', ip: req.ip });
    });
    await createSession(reply, req, 'customer', { customerId: otp.customer_id });
    return { ok: true };
  });

  app.post('/api/customer/logout', async (req, reply) => {
    await destroySession(req, reply, 'customer');
    return { ok: true };
  });

  app.get('/api/customer/me', async (req) => {
    const c = await requireCustomer(req);
    const consents = await q<any>(
      getPool(),
      `SELECT mc.company_id, co.name, mc.granted, mc.updated_at FROM marketing_consents mc JOIN companies co ON co.id = mc.company_id WHERE mc.customer_id = $1 ORDER BY co.name`,
      [c.id],
    );
    return {
      customer: { name: c.display_name, email: c.email, phone: c.phone, channel: c.preferred_channel, verified: !!c.contact_verified_at, privacyVersion: c.privacy_version },
      consents,
    };
  });

  app.get('/api/customer/cards', async (req) => {
    const c = await requireCustomer(req);
    const cards = await q<any>(
      getPool(),
      `SELECT ca.id, ca.code, ca.balance, ca.status, ca.format, ca.last_activity_at, ca.created_at, ca.program_id,
              p.name AS program, p.kind, p.card_transferable, co.id AS company_id, co.name AS company, co.slug AS company_slug, co.card_color,
              ib.name AS issued_branch
       FROM cards ca JOIN programs p ON p.id = ca.program_id JOIN companies co ON co.id = p.company_id
       LEFT JOIN branches ib ON ib.id = ca.issued_branch_id
       WHERE ca.customer_id = $1 AND ca.status = 'active' ORDER BY ca.created_at`,
      [c.id],
    );
    const out = [];
    for (const card of cards) {
      const v = await activeVersion(getPool(), card.program_id);
      const rewards = await q<any>(getPool(), `SELECT * FROM rewards WHERE program_id = $1 AND active ORDER BY sort_order, cost`, [card.program_id]);
      const branches = await q<any>(
        getPool(),
        `SELECT b.code, b.name, b.street, b.city FROM program_branches pb JOIN branches b ON b.id = pb.branch_id WHERE pb.program_id = $1 AND b.status='active' ORDER BY b.name`,
        [card.program_id],
      );
      const wallet = await q<any>(getPool(), `SELECT provider, mode, displayed_balance, last_synced_at FROM wallet_passes WHERE card_id = $1`, [card.id]);
      const expiresAt = v.expiration_days && card.balance > 0 ? new Date(new Date(card.last_activity_at).getTime() + v.expiration_days * 86400000) : null;
      out.push({
        code: card.code, balance: card.balance, kind: card.kind, program: card.program, company: card.company, companySlug: card.company_slug,
        companyId: card.company_id, cardColor: card.card_color, format: card.format, transferable: card.card_transferable, issuedBranch: card.issued_branch,
        rules: { pointsPerPurchase: v.points_per_purchase, minPurchaseCents: v.min_purchase_cents, eligible: v.eligible_description, terms: v.terms, expirationDays: v.expiration_days },
        expiresAt,
        rewards: rewards.map((r) => ({ name: r.name, cost: effectiveCost(r), available: r.stock === null || r.stock > 0 })),
        branches,
        wallet,
      });
    }
    return { cards: out };
  });

  async function ownCard(customerId: string, code: string) {
    const card = await one<any>(
      getPool(),
      `SELECT ca.*, p.company_id FROM cards ca JOIN programs p ON p.id = ca.program_id WHERE ca.code = $1 AND ca.customer_id = $2`,
      [normalizeCardCode(code), customerId],
    );
    if (!card) throw notFound('Tarjeta');
    return card;
  }

  app.get('/api/customer/cards/:code/movements', async (req) => {
    const c = await requireCustomer(req);
    const card = await ownCard(c.id, (req.params as any).code);
    const rows = await q<any>(
      getPool(),
      `SELECT le.id, le.kind, le.points, le.balance_after, le.created_at, le.reason, b.name AS branch,
              pu.ticket_ref, re.reward_name
       FROM ledger_entries le LEFT JOIN branches b ON b.id = le.branch_id
       LEFT JOIN purchases pu ON pu.id = le.purchase_id LEFT JOIN redemptions re ON re.id = le.redemption_id
       WHERE le.card_id = $1 ORDER BY le.id DESC LIMIT 100`,
      [card.id],
    );
    return { movements: rows };
  });

  // QR de la tarjeta: solo identifica la tarjeta. Mostrarlo no suma puntos.
  app.get('/api/customer/cards/:code/qr.svg', async (req, reply) => {
    const c = await requireCustomer(req);
    const card = await ownCard(c.id, (req.params as any).code);
    const svg = await QRCode.toString(`${config.publicBaseUrl}/c/${card.code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    reply.type('image/svg+xml').header('cache-control', 'private, max-age=300').send(svg);
  });

  // Wallet: SOLO simulación. No crea un pase real en Google ni Apple.
  app.post('/api/customer/cards/:code/wallet', async (req) => {
    const c = await requireCustomer(req);
    const { provider } = z.object({ provider: z.enum(['google', 'apple']) }).parse(req.body);
    const card = await ownCard(c.id, (req.params as any).code);
    if (provider === 'apple') {
      throw new AppError(501, 'NOT_IMPLEMENTED', 'Apple Wallet está planeado para una fase posterior. Usa la tarjeta web.');
    }
    await tx(async (cx) => {
      await cx.query(
        `INSERT INTO wallet_passes(card_id, provider, mode) VALUES ($1,'google','simulated') ON CONFLICT (card_id, provider) DO NOTHING`,
        [card.id],
      );
      await enqueueWalletSync(cx, card.id);
      await audit(cx, { actorKind: 'customer', actorId: c.id, companyId: card.company_id, action: 'wallet.simulated_added', entity: 'card', entityId: card.code });
    });
    await processWalletJobs();
    return {
      simulated: true,
      message: 'Simulación: se registró un pase de Google Wallet de prueba. No aparece en tu teléfono porque la integración real no está configurada.',
    };
  });

  app.post('/api/customer/marketing', async (req) => {
    const c = await requireCustomer(req);
    const b = z.object({ companyId: z.string().uuid(), granted: z.boolean() }).parse(req.body);
    const has = await one(getPool(), `SELECT 1 FROM cards ca JOIN programs p ON p.id = ca.program_id WHERE ca.customer_id = $1 AND p.company_id = $2`, [c.id, b.companyId]);
    if (!has) throw notFound('Negocio');
    await getPool().query(
      `INSERT INTO marketing_consents(customer_id, company_id, granted) VALUES ($1,$2,$3)
       ON CONFLICT (customer_id, company_id) DO UPDATE SET granted = EXCLUDED.granted, updated_at = now()`,
      [c.id, b.companyId, b.granted],
    );
    await audit(getPool(), { actorKind: 'customer', actorId: c.id, companyId: b.companyId, action: b.granted ? 'marketing.granted' : 'marketing.revoked' });
    return { ok: true, message: b.granted ? 'Aceptaste recibir promociones de este negocio.' : 'Listo: ya no recibirás promociones de este negocio. Tu tarjeta sigue funcionando igual.' };
  });

  app.post('/api/customer/privacy-requests', async (req) => {
    const c = await requireCustomer(req);
    const b = z
      .object({ kind: z.enum(['acceso', 'rectificacion', 'cancelacion', 'oposicion', 'baja_publicidad']), details: z.string().max(1000).optional().default(''), companyId: z.string().uuid().optional() })
      .parse(req.body);
    const r = await one<any>(
      getPool(),
      `INSERT INTO privacy_requests(customer_id, company_id, kind, details) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [c.id, b.companyId ?? null, b.kind, b.details],
    );
    await audit(getPool(), { actorKind: 'customer', actorId: c.id, companyId: b.companyId ?? null, action: 'privacy.request', entity: 'privacy_request', entityId: r.id, details: { kind: b.kind } });
    return { id: r.id, message: 'Solicitud registrada con folio. Te responderemos por tu contacto registrado dentro del plazo que marque el aviso de privacidad.' };
  });

  app.get('/api/customer/privacy-requests', async (req) => {
    const c = await requireCustomer(req);
    return { requests: await q(getPool(), `SELECT id, kind, status, created_at, resolution FROM privacy_requests WHERE customer_id = $1 ORDER BY created_at DESC`, [c.id]) };
  });
}
