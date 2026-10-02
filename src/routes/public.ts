import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { getPool, one, q, tx } from '../db.js';
import { config } from '../config.js';
import { AppError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { hashPassword, newCardCode } from '../lib/security.js';
import { createSession } from '../lib/auth.js';
import { integrationStatus } from '../lib/messaging.js';
import { walletStatus } from '../services/wallet.js';
import { activeVersion, effectiveCost } from '../services/loyalty.js';
import { checkOtp, consumeOtp, issueOtp, maskDestination, normalizeContact } from '../services/otp.js';

export const PRIVACY_VERSION = '2026-10-borrador';

// Búsqueda sin acentos ni mayúsculas.
const FOLD_FROM = 'ÁÉÍÓÚÜÑáéíóúüñ';
const FOLD_TO = 'AEIOUUNaeiouun';
const fold = (sql: string) => `lower(translate(${sql}, '${FOLD_FROM}', '${FOLD_TO}'))`;
const foldJs = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export async function publicRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    let db = false;
    try {
      await getPool().query('SELECT 1');
      db = true;
    } catch {}
    return { ok: db, db, time: new Date().toISOString() };
  });

  app.get('/api/public/config', async () => ({
    demoMode: config.demoMode,
    integrations: { ...integrationStatus(), wallet: walletStatus() },
  }));

  app.get('/api/public/categories', async () => {
    const rows = await q<any>(
      getPool(),
      `SELECT c.id, c.parent_id, c.name, c.slug, c.sort_order,
              (SELECT count(*)::int FROM branches b JOIN companies co ON co.id = b.company_id
               WHERE b.category_id = c.id AND b.status = 'active' AND co.status = 'approved') AS direct_count
       FROM categories c WHERE c.active ORDER BY c.sort_order, c.name`,
    );
    // Arma el árbol y suma conteos de subcategorías.
    const byId = new Map<number, any>(rows.map((r) => [r.id, { ...r, children: [] as any[], count: r.direct_count }]));
    const roots: any[] = [];
    for (const n of byId.values()) {
      if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id).children.push(n);
      else if (!n.parent_id) roots.push(n);
    }
    const total = (n: any): number => (n.count = n.direct_count + n.children.reduce((a: number, ch: any) => a + total(ch), 0));
    roots.forEach(total);
    return { categories: roots };
  });

  app.get('/api/public/directory', async (req) => {
    const { q: text = '', category = '', city = '' } = req.query as Record<string, string>;
    const params: unknown[] = [];
    const where = [`co.status = 'approved'`, `b.status = 'active'`];
    if (category) {
      params.push(category);
      where.push(`b.category_id IN (
        WITH RECURSIVE t AS (SELECT id FROM categories WHERE slug = $${params.length} AND active
          UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id WHERE c.active)
        SELECT id FROM t)`);
    }
    if (city) {
      params.push(foldJs(city));
      where.push(`${fold('b.city')} = $${params.length}`);
    }
    const terms = foldJs(String(text)).split(/\s+/).filter(Boolean).slice(0, 6);
    for (const t of terms) {
      params.push(`%${t.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
      const p = `$${params.length}`;
      where.push(`(${fold('co.name')} LIKE ${p} OR ${fold('b.name')} LIKE ${p} OR ${fold('b.street')} LIKE ${p}
               OR ${fold("coalesce(b.neighborhood,'')")} LIKE ${p} OR ${fold('b.city')} LIKE ${p} OR ${fold('cat.name')} LIKE ${p})`);
    }
    const rows = await q<any>(
      getPool(),
      `SELECT co.name AS company, co.slug AS company_slug, co.card_color, b.code, b.name AS branch, b.street, b.neighborhood, b.city, b.state,
              cat.name AS category, parent.name AS parent_category, p.kind, p.name AS program
       FROM branches b
       JOIN companies co ON co.id = b.company_id
       JOIN categories cat ON cat.id = b.category_id
       LEFT JOIN categories parent ON parent.id = cat.parent_id
       LEFT JOIN program_branches pb ON pb.branch_id = b.id
       LEFT JOIN programs p ON p.id = pb.program_id
       WHERE ${where.join(' AND ')}
       ORDER BY co.name, b.name LIMIT 100`,
      params,
    );
    return { results: rows };
  });

  app.get('/api/public/cities', async () => {
    const rows = await q<any>(
      getPool(),
      `SELECT DISTINCT b.city FROM branches b JOIN companies co ON co.id = b.company_id WHERE co.status='approved' AND b.status='active' ORDER BY b.city`,
    );
    return { cities: rows.map((r) => r.city) };
  });

  app.get('/api/public/companies/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const co = await one<any>(getPool(), `SELECT id, name, slug, description, logo_url, card_color FROM companies WHERE slug = $1 AND status = 'approved'`, [slug]);
    if (!co) throw notFound('Negocio');
    const branches = await q<any>(
      getPool(),
      `SELECT b.code, b.name, b.street, b.neighborhood, b.city, b.state, b.hours, b.phone, cat.name AS category, p.id AS program_id, p.name AS program
       FROM branches b JOIN categories cat ON cat.id = b.category_id
       LEFT JOIN program_branches pb ON pb.branch_id = b.id LEFT JOIN programs p ON p.id = pb.program_id
       WHERE b.company_id = $1 AND b.status = 'active' ORDER BY b.name`,
      [co.id],
    );
    const programs = await q<any>(getPool(), `SELECT id, name, kind FROM programs WHERE company_id = $1 AND status = 'active'`, [co.id]);
    return { company: { name: co.name, slug: co.slug, description: co.description, logoUrl: co.logo_url, cardColor: co.card_color }, branches, programs: programs.map((p) => ({ name: p.name, kind: p.kind, branches: branches.filter((b) => b.program_id === p.id).map((b) => b.name) })) };
  });

  app.get('/api/public/branches/:code', async (req) => {
    const { code } = req.params as { code: string };
    const b = await one<any>(
      getPool(),
      `SELECT b.*, co.name AS company, co.slug AS company_slug, co.description, co.logo_url, co.card_color,
              cat.name AS category, parent.name AS parent_category
       FROM branches b JOIN companies co ON co.id = b.company_id
       JOIN categories cat ON cat.id = b.category_id LEFT JOIN categories parent ON parent.id = cat.parent_id
       WHERE b.code = $1 AND co.status = 'approved' AND b.status = 'active'`,
      [code],
    );
    if (!b) throw notFound('Sucursal');
    const pb = await one<any>(getPool(), `SELECT p.* FROM program_branches pb JOIN programs p ON p.id = pb.program_id WHERE pb.branch_id = $1`, [b.id]);
    let program: any = null;
    if (pb) {
      const v = await activeVersion(getPool(), pb.id);
      const upcoming = await one<any>(getPool(), `SELECT * FROM program_versions WHERE program_id = $1 AND effective_from > now() ORDER BY version LIMIT 1`, [pb.id]);
      const rewards = await q<any>(getPool(), `SELECT * FROM rewards WHERE program_id = $1 AND active ORDER BY sort_order, cost`, [pb.id]);
      const shared = await q<any>(
        getPool(),
        `SELECT b2.code, b2.name, b2.street, b2.city FROM program_branches pb2 JOIN branches b2 ON b2.id = pb2.branch_id
         WHERE pb2.program_id = $1 AND b2.id <> $2 AND b2.status = 'active' ORDER BY b2.name`,
        [pb.id, b.id],
      );
      program = {
        name: pb.name,
        kind: pb.kind,
        status: pb.status,
        transferable: pb.card_transferable,
        pointsPerPurchase: v.points_per_purchase,
        minPurchaseCents: v.min_purchase_cents,
        expirationDays: v.expiration_days,
        eligible: v.eligible_description,
        terms: v.terms,
        version: v.version,
        upcoming: upcoming ? { effectiveFrom: upcoming.effective_from, pointsPerPurchase: upcoming.points_per_purchase, terms: upcoming.terms } : null,
        rewards: rewards.map((r) => ({
          name: r.name, description: r.description, cost: effectiveCost(r),
          upcomingCost: r.pending_cost && new Date(r.pending_cost_from) > new Date() ? { cost: r.pending_cost, from: r.pending_cost_from } : null,
          available: r.stock === null || r.stock > 0,
        })),
        sharedWith: shared,
      };
    }
    return {
      branch: {
        code: b.code, name: b.name, street: b.street, neighborhood: b.neighborhood, city: b.city, state: b.state, postalCode: b.postal_code,
        hours: b.hours, phone: b.phone, category: b.category, parentCategory: b.parent_category,
      },
      company: { name: b.company, slug: b.company_slug, description: b.description, logoUrl: b.logo_url, cardColor: b.card_color },
      program,
    };
  });

  // QR del mostrador: abre directamente el registro de esa sucursal. No suma puntos.
  app.get('/api/public/branches/:code/qr.svg', async (req, reply) => {
    const { code } = req.params as { code: string };
    const b = await one(getPool(), `SELECT 1 FROM branches WHERE code = $1`, [code]);
    if (!b) throw notFound('Sucursal');
    const svg = await QRCode.toString(`${config.publicBaseUrl}/r/${code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    reply.type('image/svg+xml').header('cache-control', 'public, max-age=300').send(svg);
  });

  // ---------- registro de cliente desde la sucursal ----------
  const startSchema = z.object({
    branchCode: z.string().min(3).max(60),
    name: z.string().trim().min(2, 'Escribe tu nombre').max(60),
    contactType: z.enum(['phone', 'email']),
    contact: z.string().min(5).max(120),
    channel: z.enum(['sms', 'whatsapp', 'email']),
    acceptPrivacy: z.literal(true, { message: 'Debes aceptar el aviso de privacidad para crear la tarjeta.' }),
    marketing: z.boolean().default(false),
  });

  app.post('/api/public/register/start', async (req) => {
    const body = startSchema.parse(req.body);
    if (body.contactType === 'email' && body.channel !== 'email') throw new AppError(400, 'BAD_CHANNEL', 'Con correo, el código llega por correo.');
    if (body.contactType === 'phone' && body.channel === 'email') throw new AppError(400, 'BAD_CHANNEL', 'Con teléfono, elige SMS o WhatsApp.');
    const b = await one<any>(
      getPool(),
      `SELECT b.id, b.company_id, pb.program_id, p.status AS program_status FROM branches b JOIN companies co ON co.id = b.company_id
       LEFT JOIN program_branches pb ON pb.branch_id = b.id LEFT JOIN programs p ON p.id = pb.program_id
       WHERE b.code = $1 AND co.status = 'approved' AND b.status = 'active'`,
      [body.branchCode],
    );
    if (!b) throw notFound('Sucursal');
    if (!b.program_id || b.program_status !== 'active') throw new AppError(409, 'NO_PROGRAM', 'Esta sucursal no tiene un programa activo.');
    const destination = normalizeContact(body.contactType, body.contact);
    const { otpId } = await issueOtp(getPool(), {
      purpose: 'register', channel: body.channel, destination,
      payload: { branchCode: body.branchCode, name: body.name, contactType: body.contactType, channel: body.channel, marketing: body.marketing },
    });
    return { otpId, to: maskDestination(destination), channel: body.channel, simulated: config.messagingProvider === 'simulated' };
  });

  app.post('/api/public/register/verify', async (req, reply) => {
    const body = z.object({ otpId: z.string().uuid(), code: z.string().min(4).max(8) }).parse(req.body);
    const otp = await checkOtp({ purpose: 'register', otpId: body.otpId, code: body.code });
    const pl = otp.payload as any;
    const result = await tx(async (c) => {
      await consumeOtp(c, otp.id);
      const b = await one<any>(
        c,
        `SELECT b.id, b.company_id, b.name, pb.program_id FROM branches b JOIN program_branches pb ON pb.branch_id = b.id WHERE b.code = $1`,
        [pl.branchCode],
      );
      if (!b) throw notFound('Sucursal');
      const field = pl.contactType === 'email' ? 'email' : 'phone';
      let customer = await one<any>(c, `SELECT * FROM customers WHERE ${field} = $1 AND status = 'active' FOR UPDATE`, [otp.destination]);
      if (!customer) {
        customer = await one<any>(
          c,
          `INSERT INTO customers(display_name, ${field}, preferred_channel, contact_verified_at, privacy_accepted_at, privacy_version)
           VALUES ($1,$2,$3, now(), now(), $4) RETURNING *`,
          [pl.name, otp.destination, pl.channel, PRIVACY_VERSION],
        );
      } else {
        await c.query(`UPDATE customers SET contact_verified_at = coalesce(contact_verified_at, now()), privacy_accepted_at = now(), privacy_version = $2 WHERE id = $1`, [customer.id, PRIVACY_VERSION]);
      }
      let card = await one<any>(c, `SELECT * FROM cards WHERE program_id = $1 AND customer_id = $2 AND status = 'active'`, [b.program_id, customer.id]);
      let existed = true;
      if (!card) {
        existed = false;
        for (let i = 0; i < 5 && !card; i++) {
          card = await one<any>(
            c,
            `INSERT INTO cards(code, program_id, customer_id, format, issued_branch_id) VALUES ($1,$2,$3,'web',$4) ON CONFLICT (code) DO NOTHING RETURNING *`,
            [newCardCode(), b.program_id, customer.id, b.id],
          );
        }
      }
      await c.query(
        `INSERT INTO marketing_consents(customer_id, company_id, granted) VALUES ($1,$2,$3)
         ON CONFLICT (customer_id, company_id) DO UPDATE SET granted = EXCLUDED.granted, updated_at = now()`,
        [customer.id, b.company_id, !!pl.marketing],
      );
      await audit(c, { actorKind: 'customer', actorId: customer.id, companyId: b.company_id, action: existed ? 'card.register_existing' : 'card.registered', entity: 'card', entityId: card.code, details: { branch: pl.branchCode, marketing: !!pl.marketing } });
      return { customerId: customer.id, card: { code: card.code, balance: card.balance }, existed };
    });
    await createSession(reply, req, 'customer', { customerId: result.customerId });
    return {
      card: result.card,
      existed: result.existed,
      message: result.existed
        ? 'Ya tenías una tarjeta en este programa. Te mostramos la misma; no se creó otra.'
        : 'Tarjeta creada con 0 puntos. Los puntos se suman cuando el personal confirma una compra.',
    };
  });

  // ---------- solicitud de alta de negocio (queda pendiente de revisión) ----------
  const bizSchema = z.object({
    ownerName: z.string().trim().min(2).max(80),
    ownerEmail: z.string().trim().toLowerCase().email('Correo inválido'),
    ownerPassword: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres').max(100),
    ownerPhone: z.string().max(20).optional().default(''),
    companyName: z.string().trim().min(2).max(80),
    description: z.string().max(400).optional().default(''),
    logoUrl: z.string().url().max(300).optional().or(z.literal('')).default(''),
    cardColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#1C2433'),
    categoryId: z.coerce.number().int(),
    branchName: z.string().trim().min(2).max(60),
    street: z.string().trim().min(3).max(120),
    neighborhood: z.string().max(80).optional().default(''),
    city: z.string().trim().min(2).max(80),
    state: z.string().max(80).optional().default(''),
    postalCode: z.string().max(10).optional().default(''),
    hours: z.string().max(120).optional().default(''),
    lat: z.coerce.number().min(-90).max(90).optional().nullable(),
    lng: z.coerce.number().min(-180).max(180).optional().nullable(),
    programKind: z.enum(['points', 'stamps']),
    pointsPerPurchase: z.coerce.number().int().min(1).max(10000),
    minPurchase: z.coerce.number().min(0).max(100000).default(0),
    eligible: z.string().trim().min(5).max(300),
    rewardName: z.string().trim().min(2).max(80),
    rewardCost: z.coerce.number().int().min(1).max(100000),
    expirationDays: z.coerce.number().int().min(30).max(1095).optional().nullable(),
    plan: z.enum(['basico', 'pro']).default('basico'),
  });

  app.post('/api/public/business-applications', async (req) => {
    const b = bizSchema.parse(req.body);
    const cat = await one<any>(getPool(), `SELECT id FROM categories WHERE id = $1 AND active AND NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = categories.id AND ch.active)`, [b.categoryId]);
    if (!cat) throw new AppError(400, 'BAD_CATEGORY', 'Elige una subcategoría de la lista.');
    const exists = await one(getPool(), `SELECT 1 FROM users WHERE email = $1`, [b.ownerEmail]);
    if (exists) throw new AppError(409, 'EMAIL_TAKEN', 'Ese correo ya tiene una cuenta. Entra con ella o usa otro correo.');
    const baseSlug = foldJs(b.companyName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'negocio';
    const passwordHash = await hashPassword(b.ownerPassword);
    const out = await tx(async (c) => {
      let slug = baseSlug;
      for (let i = 2; await one(c, `SELECT 1 FROM companies WHERE slug = $1`, [slug]); i++) slug = `${baseSlug}-${i}`;
      const user = await one<any>(c, `INSERT INTO users(email, name, phone, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`, [b.ownerEmail, b.ownerName, b.ownerPhone || null, passwordHash]);
      const co = await one<any>(
        c,
        `INSERT INTO companies(slug, name, description, logo_url, card_color, contact_email, contact_phone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [slug, b.companyName, b.description || null, b.logoUrl || null, b.cardColor, b.ownerEmail, b.ownerPhone || null],
      );
      let code = `${slug}-${foldJs(b.branchName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 60).replace(/-$/, '');
      for (let i = 2; await one(c, `SELECT 1 FROM branches WHERE code = $1`, [code]); i++) code = `${code.slice(0, 55)}-${i}`;
      const br = await one<any>(
        c,
        `INSERT INTO branches(company_id, code, name, street, neighborhood, city, state, postal_code, category_id, hours, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [co.id, code, b.branchName, b.street, b.neighborhood || null, b.city, b.state || null, b.postalCode || null, b.categoryId, b.hours || null, b.lat ?? null, b.lng ?? null],
      );
      await c.query(`INSERT INTO memberships(user_id, company_id, role, created_by) VALUES ($1,$2,'owner',$1)`, [user.id, co.id]);
      const pr = await one<any>(c, `INSERT INTO programs(company_id, name, kind) VALUES ($1,$2,$3) RETURNING id`, [co.id, `Programa ${b.companyName}`, b.programKind]);
      await c.query(
        `INSERT INTO program_versions(program_id, version, points_per_purchase, min_purchase_cents, expiration_days, eligible_description, terms, effective_from, created_by)
         VALUES ($1,1,$2,$3,$4,$5,$6, now(), $7)`,
        [pr.id, b.pointsPerPurchase, Math.round(b.minPurchase * 100), b.expirationDays ?? null, b.eligible,
         'El negocio define, cubre y entrega los premios. Los puntos solo se suman cuando el personal confirma una compra elegible.', user.id],
      );
      await c.query(`INSERT INTO program_branches(program_id, branch_id) VALUES ($1,$2)`, [pr.id, br.id]);
      await c.query(`INSERT INTO rewards(program_id, name, cost) VALUES ($1,$2,$3)`, [pr.id, b.rewardName, b.rewardCost]);
      await c.query(
        `INSERT INTO subscriptions(company_id, plan, status, monthly_price_cents, installation_fee_cents) VALUES ($1,$2,'trial',$3,$4)`,
        [co.id, b.plan, b.plan === 'pro' ? 34900 : 19900, 30000],
      );
      await audit(c, { actorKind: 'public', actorId: user.id, companyId: co.id, action: 'company.applied', entity: 'company', entityId: co.id, ip: req.ip });
      return { companyId: co.id, slug, branchCode: code };
    });
    return {
      ...out,
      status: 'pending',
      message: 'Solicitud recibida. Revisamos la información antes de publicarla en el directorio. Ya puedes entrar al panel del dueño para configurar empleados y premios.',
    };
  });
}
