// Datos FICTICIOS de demostración. Ningún negocio, persona o dirección corresponde a un cliente real.
import type pg from 'pg';
import { getPool, closePool, one, tx } from './db.js';
import { hashPassword } from './lib/security.js';
import { migrate } from './migrate.js';

export const DEMO_PASSWORD = 'demo-12345';

const CATEGORIES: [string, string, string | null, number][] = [
  // [nombre, slug, slug_padre, orden]
  ['Comida y bebidas', 'comida-y-bebidas', null, 1],
  ['Restaurantes', 'restaurantes', 'comida-y-bebidas', 1],
  ['Cafeterías', 'cafeterias', 'comida-y-bebidas', 2],
  ['Comida rápida', 'comida-rapida', 'comida-y-bebidas', 3],
  ['Taquerías', 'taquerias', 'comida-rapida', 1],
  ['Hamburguesas', 'hamburguesas', 'comida-rapida', 2],
  ['Pizzerías', 'pizzerias', 'comida-rapida', 3],
  ['Panaderías y reposterías', 'panaderias-y-reposterias', 'comida-y-bebidas', 4],
  ['Tiendas', 'tiendas', null, 2],
  ['Ropa y accesorios', 'ropa-y-accesorios', 'tiendas', 1],
  ['Instrumentos musicales', 'instrumentos-musicales', 'tiendas', 2],
  ['Tecnología', 'tecnologia', 'tiendas', 3],
  ['Otras tiendas', 'otras-tiendas', 'tiendas', 4],
  ['Servicios', 'servicios', null, 3],
  ['Barberías y estéticas', 'barberias-y-esteticas', 'servicios', 1],
  ['Lavado de autos', 'lavado-de-autos', 'servicios', 2],
  ['Otros servicios', 'otros-servicios', 'servicios', 3],
];

interface BranchDef { code: string; name: string; street: string; neighborhood: string; city: string; state: string; hours: string; category: string }
interface ProgramDef {
  name: string; kind: 'points' | 'stamps'; pts: number; minCents?: number; expiration?: number | null; eligible: string;
  rewards: { name: string; cost: number; stock?: number | null; description?: string }[];
  branches: string[]; redeemVerification?: 'none' | 'otp'; transferable?: boolean;
}
interface CompanyDef {
  slug: string; name: string; description: string; color: string; status?: string; plan: 'basico' | 'pro';
  branches: BranchDef[]; programs: ProgramDef[];
  staff: { email: string; name: string; role: 'owner' | 'manager' | 'employee'; branch?: string }[];
  pilot?: boolean;
}

const TERMS = 'El negocio define, cubre y entrega los premios. Los puntos solo se suman cuando el personal confirma una compra elegible; mostrar el QR no suma. La tarjeta es personal.';

const COMPANIES: CompanyDef[] = [
  {
    slug: 'tacos-del-centro', name: 'Tacos del Centro', color: '#8C2F1B', plan: 'pro', pilot: true,
    description: 'Taquería familiar de pastor, suadero y campechanos.',
    branches: [
      { code: 'tacos-del-centro-centro', name: 'Sucursal Centro', street: 'Av. Domingo 10', neighborhood: 'Centro', city: 'Tepotzotlán', state: 'Estado de México', hours: 'Lun a dom, 13:00 a 23:00', category: 'taquerias' },
      { code: 'tacos-del-centro-norte', name: 'Sucursal Norte', street: 'Calle Fresno 45', neighborhood: 'Los Pinos', city: 'Tepotzotlán', state: 'Estado de México', hours: 'Mar a dom, 18:00 a 01:00', category: 'taquerias' },
    ],
    programs: [{
      name: 'Club Taquero', kind: 'points', pts: 10, expiration: 180, eligible: 'Cualquier consumo en mesa o para llevar con ticket.',
      rewards: [{ name: 'Orden de 5 tacos al pastor', cost: 50 }, { name: 'Agua fresca grande', cost: 30 }],
      branches: ['tacos-del-centro-centro', 'tacos-del-centro-norte'],
    }],
    staff: [
      { email: 'dueno.tacos@example.com', name: 'Rogelio Saldaña', role: 'owner' },
      { email: 'encargada.tacos@example.com', name: 'Marisol Peña', role: 'manager' },
      { email: 'empleado.centro@example.com', name: 'Iván Ortega', role: 'employee', branch: 'tacos-del-centro-centro' },
      { email: 'empleado.norte@example.com', name: 'Daniela Ruiz', role: 'employee', branch: 'tacos-del-centro-norte' },
    ],
  },
  {
    slug: 'cafe-aurora', name: 'Café Aurora', color: '#3B5249', plan: 'basico',
    description: 'Café de especialidad y pan de la casa frente al jardín.',
    branches: [{ code: 'cafe-aurora-jardin', name: 'Sucursal Jardín', street: 'Plaza Virreinal 3', neighborhood: 'Centro', city: 'Tepotzotlán', state: 'Estado de México', hours: 'Lun a sáb, 8:00 a 21:00', category: 'cafeterias' }],
    programs: [{
      name: 'Sellos Aurora', kind: 'stamps', pts: 1, expiration: null, eligible: 'Una bebida preparada por visita.', redeemVerification: 'otp',
      rewards: [{ name: 'Bebida mediana de la casa', cost: 8 }], branches: ['cafe-aurora-jardin'],
    }],
    staff: [
      { email: 'dueno.cafe@example.com', name: 'Lucía Herrera', role: 'owner' },
      { email: 'barista.cafe@example.com', name: 'Tomás Aguilar', role: 'employee' },
    ],
  },
  {
    slug: 'la-brasa-burger', name: 'La Brasa Burger', color: '#B4541A', plan: 'basico',
    description: 'Hamburguesas a la parrilla y papas en corte rústico.',
    branches: [{ code: 'la-brasa-burger-arcos', name: 'Sucursal Arcos', street: 'Blvd. de los Arcos 210, local 4', neighborhood: 'Arcos del Alba', city: 'Cuautitlán Izcalli', state: 'Estado de México', hours: 'Diario, 13:00 a 22:30', category: 'hamburguesas' }],
    programs: [{
      name: 'Puntos Brasa', kind: 'points', pts: 10, minCents: 12000, expiration: 120, eligible: 'Compras desde $120 con ticket.',
      rewards: [{ name: 'Papas medianas', cost: 40 }, { name: 'Hamburguesa clásica', cost: 100 }], branches: ['la-brasa-burger-arcos'],
    }],
    staff: [{ email: 'dueno.brasa@example.com', name: 'Héctor Lozano', role: 'owner' }],
  },
  {
    slug: 'pizzeria-forno-norte', name: 'Pizzería Forno Norte', color: '#6B3E26', plan: 'basico',
    description: 'Pizza al horno de leña, por rebanada o entera.',
    branches: [{ code: 'pizzeria-forno-norte-alamos', name: 'Sucursal Álamos', street: 'Av. Constituyentes 1180', neighborhood: 'Álamos 2a Sección', city: 'Querétaro', state: 'Querétaro', hours: 'Mié a lun, 14:00 a 23:00', category: 'pizzerias' }],
    programs: [{ name: 'Rebanadas Forno', kind: 'stamps', pts: 1, expiration: 365, eligible: 'Una pizza entera por visita.', rewards: [{ name: 'Pizza mediana de un ingrediente', cost: 6 }], branches: ['pizzeria-forno-norte-alamos'] }],
    staff: [{ email: 'dueno.forno@example.com', name: 'Valeria Campos', role: 'owner' }],
  },
  {
    slug: 'panaderia-la-espiga', name: 'Panadería La Espiga', color: '#A0763A', plan: 'basico',
    description: 'Pan dulce, bolillo y pasteles por encargo.',
    branches: [{ code: 'panaderia-la-espiga-mirador', name: 'Sucursal Mirador', street: 'Calle Cedros 18', neighborhood: 'El Mirador', city: 'Cuautitlán Izcalli', state: 'Estado de México', hours: 'Diario, 7:00 a 21:00', category: 'panaderias-y-reposterias' }],
    programs: [{ name: 'Sellos Espiga', kind: 'stamps', pts: 1, expiration: null, eligible: 'Compras de pan desde $60.', minCents: 6000, rewards: [{ name: 'Seis piezas de pan dulce surtido', cost: 10 }], branches: ['panaderia-la-espiga-mirador'] }],
    staff: [{ email: 'dueno.espiga@example.com', name: 'Ernesto Villa', role: 'owner' }],
  },
  {
    slug: 'casa-jacaranda', name: 'Casa Jacaranda', color: '#5B3A6E', plan: 'pro',
    description: 'Cocina mexicana de temporada, comida corrida y cenas.',
    branches: [{ code: 'casa-jacaranda-coyoacan', name: 'Sucursal Coyoacán', street: 'Calle Higuera 77', neighborhood: 'La Concepción', city: 'Ciudad de México', state: 'CDMX', hours: 'Mar a dom, 13:00 a 22:00', category: 'restaurantes' }],
    programs: [{ name: 'Mesa Jacaranda', kind: 'points', pts: 20, minCents: 30000, expiration: 365, eligible: 'Consumos desde $300 por mesa.', rewards: [{ name: 'Postre de la casa', cost: 60 }, { name: 'Comida corrida para una persona', cost: 160 }], branches: ['casa-jacaranda-coyoacan'] }],
    staff: [{ email: 'dueno.jacaranda@example.com', name: 'Paula Medina', role: 'owner' }],
  },
  {
    slug: 'musica-allegro', name: 'Música Allegro', color: '#23395B', plan: 'pro',
    description: 'Instrumentos, accesorios y servicio de calibración.',
    branches: [{ code: 'musica-allegro-centro', name: 'Sucursal Centro Histórico', street: 'Calle Madero 52', neighborhood: 'Centro', city: 'Querétaro', state: 'Querétaro', hours: 'Lun a sáb, 10:00 a 20:00', category: 'instrumentos-musicales' }],
    programs: [{
      name: 'Puntos Allegro', kind: 'points', pts: 25, minCents: 20000, expiration: 365, eligible: 'Compras de accesorios o servicios desde $200. No aplica en instrumentos en oferta.',
      rewards: [
        { name: 'Juego de cuerdas para guitarra', cost: 100, stock: 5 },
        { name: 'Calibración de guitarra o bajo', cost: 150 },
        { name: 'Funda acolchada para ukulele', cost: 120, stock: 0 },
      ],
      branches: ['musica-allegro-centro'],
    }],
    staff: [
      { email: 'dueno.allegro@example.com', name: 'Andrés Galindo', role: 'owner' },
      { email: 'vendedor.allegro@example.com', name: 'Sofía Treviño', role: 'employee' },
    ],
  },
  {
    slug: 'boutique-lirio', name: 'Boutique Lirio', color: '#7A2E4D', plan: 'basico',
    description: 'Ropa casual y accesorios para dama.',
    branches: [{ code: 'boutique-lirio-del-valle', name: 'Sucursal Del Valle', street: 'Av. Coyoacán 1530, local 2', neighborhood: 'Del Valle', city: 'Ciudad de México', state: 'CDMX', hours: 'Lun a sáb, 11:00 a 20:00', category: 'ropa-y-accesorios' }],
    programs: [{ name: 'Club Lirio', kind: 'points', pts: 15, minCents: 25000, expiration: 365, eligible: 'Compras desde $250.', rewards: [{ name: 'Descuento de $150 en tu siguiente compra', cost: 90 }], branches: ['boutique-lirio-del-valle'] }],
    staff: [{ email: 'dueno.lirio@example.com', name: 'Gabriela Soto', role: 'owner' }],
  },
  {
    slug: 'tecnopunto', name: 'TecnoPunto', color: '#24546E', plan: 'basico', status: 'pending',
    description: 'Accesorios de celular y reparación básica. (Solicitud pendiente de revisión)',
    branches: [{ code: 'tecnopunto-plaza', name: 'Sucursal Plaza', street: 'Av. Hidalgo 400, local 11', neighborhood: 'Centro', city: 'Cuautitlán Izcalli', state: 'Estado de México', hours: 'Lun a sáb, 10:00 a 19:00', category: 'tecnologia' }],
    programs: [{ name: 'Puntos TecnoPunto', kind: 'points', pts: 10, eligible: 'Compras de accesorios.', rewards: [{ name: 'Mica de cristal templado', cost: 60 }], branches: ['tecnopunto-plaza'] }],
    staff: [{ email: 'dueno.tecno@example.com', name: 'Ramiro Cruz', role: 'owner' }],
  },
  {
    slug: 'barberia-el-filo', name: 'Barbería El Filo', color: '#2B2D42', plan: 'pro',
    description: 'Cortes clásicos, fade y arreglo de barba. Cada sucursal tiene su propia tarjeta.',
    branches: [
      { code: 'barberia-el-filo-centro', name: 'Sucursal Centro', street: 'Calle Insurgentes 8', neighborhood: 'Centro', city: 'Tepotzotlán', state: 'Estado de México', hours: 'Lun a sáb, 10:00 a 20:00', category: 'barberias-y-esteticas' },
      { code: 'barberia-el-filo-izcalli', name: 'Sucursal Izcalli', street: 'Av. Chalma 315', neighborhood: 'Ensueños', city: 'Cuautitlán Izcalli', state: 'Estado de México', hours: 'Mar a dom, 11:00 a 21:00', category: 'barberias-y-esteticas' },
    ],
    programs: [
      { name: 'Sellos Filo Centro', kind: 'stamps', pts: 1, expiration: 180, eligible: 'Un corte de cabello pagado.', rewards: [{ name: 'Corte gratis', cost: 5 }], branches: ['barberia-el-filo-centro'] },
      { name: 'Sellos Filo Izcalli', kind: 'stamps', pts: 1, expiration: 180, eligible: 'Un corte de cabello pagado.', rewards: [{ name: 'Corte gratis', cost: 6 }, { name: 'Arreglo de barba', cost: 4 }], branches: ['barberia-el-filo-izcalli'] },
    ],
    staff: [
      { email: 'dueno.filo@example.com', name: 'Mauricio Ibarra', role: 'owner' },
      { email: 'barbero.centro@example.com', name: 'Kevin Salas', role: 'employee', branch: 'barberia-el-filo-centro' },
    ],
  },
  {
    slug: 'autolavado-brillo-express', name: 'Autolavado Brillo Express', color: '#145DA0', plan: 'basico',
    description: 'Lavado exterior, interior y encerado.',
    branches: [{ code: 'autolavado-brillo-express-perinorte', name: 'Sucursal Perinorte', street: 'Av. Primero de Mayo 92', neighborhood: 'San Martín Obispo', city: 'Cuautitlán Izcalli', state: 'Estado de México', hours: 'Diario, 8:00 a 18:00', category: 'lavado-de-autos' }],
    programs: [{ name: 'Lavados Brillo', kind: 'stamps', pts: 1, expiration: 365, eligible: 'Un lavado pagado por vehículo.', rewards: [{ name: 'Lavado exterior gratis', cost: 6 }], branches: ['autolavado-brillo-express-perinorte'] }],
    staff: [{ email: 'dueno.brillo@example.com', name: 'Jorge Navarro', role: 'owner' }],
  },
  {
    slug: 'estetica-dalia', name: 'Estética Dalia', color: '#9C4F96', plan: 'basico',
    description: 'Corte, color y peinado.',
    branches: [{ code: 'estetica-dalia-narvarte', name: 'Sucursal Narvarte', street: 'Calle Uxmal 240', neighborhood: 'Narvarte', city: 'Ciudad de México', state: 'CDMX', hours: 'Mar a sáb, 10:00 a 19:00', category: 'barberias-y-esteticas' }],
    programs: [{ name: 'Puntos Dalia', kind: 'points', pts: 10, minCents: 25000, expiration: 365, eligible: 'Servicios desde $250.', rewards: [{ name: 'Tratamiento hidratante', cost: 50 }], branches: ['estetica-dalia-narvarte'] }],
    staff: [{ email: 'dueno.dalia@example.com', name: 'Dalia Fuentes', role: 'owner' }],
  },
  {
    slug: 'lavanderia-burbuja', name: 'Lavandería Burbuja', color: '#2E7D7A', plan: 'basico',
    description: 'Lavado por kilo y planchado.',
    branches: [{ code: 'lavanderia-burbuja-centro', name: 'Sucursal Centro', street: 'Calle Morelos 31', neighborhood: 'Centro', city: 'Tepotzotlán', state: 'Estado de México', hours: 'Lun a sáb, 8:00 a 20:00', category: 'otros-servicios' }],
    programs: [{ name: 'Sellos Burbuja', kind: 'stamps', pts: 1, expiration: null, eligible: 'Servicios desde 3 kg.', rewards: [{ name: '3 kg de lavado gratis', cost: 8 }], branches: ['lavanderia-burbuja-centro'] }],
    staff: [{ email: 'dueno.burbuja@example.com', name: 'Rocío Bautista', role: 'owner' }],
  },
  {
    slug: 'papeleria-trazo', name: 'Papelería Trazo', color: '#4E6E2E', plan: 'basico',
    description: 'Papelería, copias e impresiones.',
    branches: [{ code: 'papeleria-trazo-jurica', name: 'Sucursal Juriquilla', street: 'Blvd. Juriquilla 2003', neighborhood: 'Jurica', city: 'Querétaro', state: 'Querétaro', hours: 'Lun a sáb, 9:00 a 20:00', category: 'otras-tiendas' }],
    programs: [{ name: 'Puntos Trazo', kind: 'points', pts: 10, minCents: 10000, expiration: 365, eligible: 'Compras desde $100.', rewards: [{ name: 'Juego de plumas de gel', cost: 70 }], branches: ['papeleria-trazo-jurica'] }],
    staff: [{ email: 'dueno.trazo@example.com', name: 'Felipe Rangel', role: 'owner' }],
  },
];

const CUSTOMERS = [
  ['Ana Martínez', 'ana.martinez@example.com', '+525500000101'],
  ['Luis Romero', null, '+525500000102'],
  ['Carmen Delgado', 'carmen.delgado@example.com', null],
  ['Óscar Fuentes', null, '+525500000104'],
  ['Brenda Sánchez', 'brenda.sanchez@example.com', '+525500000105'],
  ['Raúl Jiménez', null, '+525500000106'],
  ['Patricia Lara', 'patricia.lara@example.com', null],
  ['Miguel Ángel Torres', null, '+525500000108'],
  ['Fernanda Ríos', 'fernanda.rios@example.com', null],
  ['Jesús Morales', null, '+525500000110'],
  ['Karla Domínguez', 'karla.dominguez@example.com', null],
  ['Ricardo Vega', null, '+525500000112'],
  ['Elena Castro', 'elena.castro@example.com', null],
  ['Diego Navarro', null, '+525500000114'],
  ['Mónica Reyes', 'monica.reyes@example.com', null],
  ['Alberto Peña', null, '+525500000116'],
  ['Silvia Ortega', 'silvia.ortega@example.com', null],
  ['Hugo Mendoza', null, '+525500000118'],
] as const;

// Generador pseudoaleatorio con semilla: la demo siempre arranca igual.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

async function addPurchase(c: pg.PoolClient, o: { company: string; branch: string; program: string; card: any; ticket: string; amount: number | null; points: number; actor: string; at: Date }) {
  const p = await one<any>(
    c,
    `INSERT INTO purchases(company_id, branch_id, program_id, card_id, ticket_ref, amount_cents, points, program_version, idempotency_key, occurred_at, actor_user_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$9) RETURNING id`,
    [o.company, o.branch, o.program, o.card.id, o.ticket, o.amount, o.points, `seed:${o.ticket}:${o.branch}`, o.at.toISOString(), o.actor],
  );
  o.card.balance += o.points;
  await c.query(
    `INSERT INTO ledger_entries(company_id, program_id, card_id, branch_id, kind, points, balance_after, purchase_id, program_version, actor_kind, actor_user_id, created_at)
     VALUES ($1,$2,$3,$4,'purchase',$5,$6,$7,1,'staff',$8,$9)`,
    [o.company, o.program, o.card.id, o.branch, o.points, o.card.balance, p.id, o.actor, o.at.toISOString()],
  );
  await c.query(`UPDATE cards SET balance = $2, last_activity_at = $3 WHERE id = $1`, [o.card.id, o.card.balance, o.at.toISOString()]);
}

async function addRedemption(c: pg.PoolClient, o: { company: string; branch: string; program: string; card: any; reward: any; actor: string; at: Date; key: string }) {
  const r = await one<any>(
    c,
    `INSERT INTO redemptions(company_id, branch_id, program_id, card_id, reward_id, reward_name, cost, idempotency_key, status, actor_user_id, created_at, delivered_at, delivered_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'delivered',$9,$10,$10,$9) RETURNING id`,
    [o.company, o.branch, o.program, o.card.id, o.reward.id, o.reward.name, o.reward.cost, o.key, o.actor, o.at.toISOString()],
  );
  o.card.balance -= o.reward.cost;
  await c.query(
    `INSERT INTO ledger_entries(company_id, program_id, card_id, branch_id, kind, points, balance_after, redemption_id, actor_kind, actor_user_id, created_at)
     VALUES ($1,$2,$3,$4,'redemption',$5,$6,$7,'staff',$8,$9)`,
    [o.company, o.program, o.card.id, o.branch, -o.reward.cost, o.card.balance, r.id, o.actor, o.at.toISOString()],
  );
  await c.query(`UPDATE cards SET balance = $2, last_activity_at = $3 WHERE id = $1`, [o.card.id, o.card.balance, o.at.toISOString()]);
}

export async function seed() {
  const pw = await hashPassword(DEMO_PASSWORD);
  await tx(async (c) => {
    await c.query(`INSERT INTO settings(key, value) VALUES ('wallet_simulate_failure', 'false') ON CONFLICT (key) DO NOTHING`);
    const catId = new Map<string, number>();
    for (const [name, slug, parent, order] of CATEGORIES) {
      const r = await one<any>(c, `INSERT INTO categories(name, slug, parent_id, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`, [name, slug, parent ? catId.get(parent) : null, order]);
      catId.set(slug, r.id);
    }

    const admin = await one<any>(c, `INSERT INTO users(email, name, password_hash, is_platform_admin) VALUES ('admin@example.com','Administración Chavarín & Said',$1,true) RETURNING id`, [pw]);

    const customerIds: string[] = [];
    for (const [name, email, phone] of CUSTOMERS) {
      const r = await one<any>(
        c,
        `INSERT INTO customers(display_name, email, phone, preferred_channel, contact_verified_at, privacy_accepted_at, privacy_version)
         VALUES ($1,$2,$3,$4, now(), now(), '2026-10-borrador') RETURNING id`,
        [name, email, phone, email ? 'email' : 'whatsapp'],
      );
      customerIds.push(r.id);
    }

    const ctx: Record<string, any> = {};
    for (const co of COMPANIES) {
      const company = await one<any>(
        c,
        `INSERT INTO companies(slug, name, description, card_color, status, is_demo, pilot, approved_at, contact_email)
         VALUES ($1,$2,$3,$4,$5,true,$6, CASE WHEN $5 = 'approved' THEN now() END, $7) RETURNING id`,
        [co.slug, co.name, co.description, co.color, co.status ?? 'approved', !!co.pilot, co.staff[0].email],
      );
      const branchId = new Map<string, string>();
      for (const b of co.branches) {
        const r = await one<any>(
          c,
          `INSERT INTO branches(company_id, code, name, street, neighborhood, city, state, hours, category_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [company.id, b.code, b.name, b.street, b.neighborhood, b.city, b.state, b.hours, catId.get(b.category)],
        );
        branchId.set(b.code, r.id);
      }
      const userIds: Record<string, string> = {};
      for (const s of co.staff) {
        const u = await one<any>(c, `INSERT INTO users(email, name, password_hash) VALUES ($1,$2,$3) RETURNING id`, [s.email, s.name, pw]);
        userIds[s.role === 'employee' ? `employee:${s.branch ?? 'any'}` : s.role] = u.id;
        await c.query(`INSERT INTO memberships(user_id, company_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [u.id, company.id, s.role, s.branch ? branchId.get(s.branch) : null]);
      }
      const programs: any[] = [];
      for (const p of co.programs) {
        const pr = await one<any>(
          c,
          `INSERT INTO programs(company_id, name, kind, redeem_verification, card_transferable) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [company.id, p.name, p.kind, p.redeemVerification ?? 'none', !!p.transferable],
        );
        await c.query(
          `INSERT INTO program_versions(program_id, version, points_per_purchase, min_purchase_cents, expiration_days, eligible_description, terms, effective_from, created_by)
           VALUES ($1,1,$2,$3,$4,$5,$6, now() - interval '120 days', $7)`,
          [pr.id, p.pts, p.minCents ?? 0, p.expiration ?? null, p.eligible, TERMS, userIds.owner],
        );
        const rewards = [];
        let order = 0;
        for (const r of p.rewards) {
          rewards.push(await one<any>(c, `INSERT INTO rewards(program_id, name, description, cost, stock, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [pr.id, r.name, r.description ?? null, r.cost, r.stock ?? null, order++]));
        }
        for (const bc of p.branches) await c.query(`INSERT INTO program_branches(program_id, branch_id) VALUES ($1,$2)`, [pr.id, branchId.get(bc)]);
        programs.push({ id: pr.id, def: p, rewards });
      }
      await c.query(
        `INSERT INTO subscriptions(company_id, plan, status, monthly_price_cents, installation_fee_cents, paid_through)
         VALUES ($1,$2,$3,$4,30000, (now() + interval '20 days')::date)`,
        [company.id, co.plan, co.status === 'pending' ? 'trial' : 'active', co.plan === 'pro' ? 34900 : 19900],
      );
      ctx[co.slug] = { company: company.id, branchId, userIds, programs };
    }

    // ---- Historial ficticio de Tacos del Centro: 6 semanas de compras y algunos canjes ----
    const t = ctx['tacos-del-centro'];
    const prog = t.programs[0];
    const centro = t.branchId.get('tacos-del-centro-centro');
    const norte = t.branchId.get('tacos-del-centro-norte');
    const rand = rng(42);
    let ticket = 1000;
    const now = Date.now();
    const cards: any[] = [];
    for (let i = 0; i < 16; i++) {
      const code = i === 0 ? 'C-104' : i === 1 ? 'C-105' : `C-T${String(200 + i)}`;
      const created = new Date(now - (42 - i) * 86400000);
      const card = await one<any>(c, `INSERT INTO cards(code, program_id, customer_id, issued_branch_id, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [code, prog.id, customerIds[i], i % 3 ? centro : norte, created.toISOString()]);
      card.balance = 0;
      cards.push(card);
    }
    const printed = await one<any>(c, `INSERT INTO cards(code, program_id, format, issued_branch_id, created_at) VALUES ('C-106',$1,'printed',$2, now() - interval '20 days') RETURNING *`, [prog.id, centro]);
    printed.balance = 0;
    const events: { at: Date; card: any; branch: string }[] = [];
    cards.forEach((card, i) => {
      const visits = i === 0 ? 3 : i === 1 ? 5 : 1 + Math.floor(rand() * 7);
      for (let v = 0; v < visits; v++) {
        const at = new Date(now - Math.floor(rand() * (40 - Math.min(i, 30))) * 86400000 - Math.floor(rand() * 8) * 3600000 - 3 * 3600000);
        events.push({ at, card, branch: rand() < 0.7 ? centro : norte });
      }
    });
    events.push({ at: new Date(now - 15 * 86400000), card: printed, branch: centro }, { at: new Date(now - 6 * 86400000), card: printed, branch: centro });
    events.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const e of events) {
      const actor = e.branch === centro ? t.userIds['employee:tacos-del-centro-centro'] : t.userIds['employee:tacos-del-centro-norte'];
      await addPurchase(c, { company: t.company, branch: e.branch, program: prog.id, card: e.card, ticket: `T-${ticket++}`, amount: 12000 + Math.floor(rand() * 30000), points: 10, actor, at: e.at });
      // Canje cuando alcanza 60 o más, excepto las tarjetas de ejemplo C-104 (30) y C-105 (50).
      if (e.card.balance >= 60 && !['C-104', 'C-105'].includes(e.card.code)) {
        await addRedemption(c, { company: t.company, branch: e.branch, program: prog.id, card: e.card, reward: prog.rewards[0], actor, at: new Date(e.at.getTime() + 60000), key: `seed:r:${e.card.code}:${ticket}` });
      }
    }

    // ---- Tarjetas de ejemplo en otros sectores ----
    const sample = async (slug: string, programIdx: number, customerIdx: number, code: string, visits: number, branchCode?: string) => {
      const s = ctx[slug];
      const p = s.programs[programIdx];
      const bcode = branchCode ?? p.def.branches[0];
      const bid = s.branchId.get(bcode);
      const actor = s.userIds['employee:any'] ?? s.userIds[`employee:${bcode}`] ?? s.userIds.owner;
      const card = await one<any>(c, `INSERT INTO cards(code, program_id, customer_id, issued_branch_id, created_at) VALUES ($1,$2,$3,$4, now() - interval '30 days') RETURNING *`, [code, p.id, customerIds[customerIdx], bid]);
      card.balance = 0;
      for (let v = 0; v < visits; v++) {
        await addPurchase(c, { company: s.company, branch: bid, program: p.id, card, ticket: `${code}-V${v + 1}`, amount: (p.def.minCents ?? 5000) + 5000, points: p.def.pts, actor, at: new Date(now - (25 - v * 3) * 86400000) });
      }
    };
    await sample('cafe-aurora', 0, 0, 'C-AUR01', 7);
    await sample('cafe-aurora', 0, 4, 'C-AUR02', 3);
    await sample('musica-allegro', 0, 0, 'C-ALG01', 5);
    await sample('musica-allegro', 0, 2, 'C-ALG02', 2);
    await sample('barberia-el-filo', 0, 1, 'C-FIL01', 4, 'barberia-el-filo-centro');
    await sample('barberia-el-filo', 1, 1, 'C-FIL02', 2, 'barberia-el-filo-izcalli');
    await sample('autolavado-brillo-express', 0, 3, 'C-BRI01', 5);
    await sample('la-brasa-burger', 0, 5, 'C-BRA01', 3);
    await sample('panaderia-la-espiga', 0, 6, 'C-ESP01', 6);
    await sample('casa-jacaranda', 0, 7, 'C-JAC01', 2);

    await c.query(
      `INSERT INTO payments(company_id, amount_cents, concept, method, reference, period_month, recorded_by)
       VALUES ($1, 30000, 'instalacion', 'transferencia', 'DEMO-001', NULL, $3), ($1, 34900, 'mensualidad', 'efectivo', 'DEMO-002', to_char(now(), 'YYYY-MM'), $3),
              ($2, 19900, 'mensualidad', 'transferencia', 'DEMO-003', to_char(now(), 'YYYY-MM'), $3)`,
      [t.company, ctx['cafe-aurora'].company, admin.id],
    );
    await c.query(
      `INSERT INTO incidents(company_id, kind, priority, status, title, description, created_by)
       VALUES ($1,'soporte','media','abierto','Cómo imprimir el QR de la Sucursal Norte','Ejemplo de solicitud de soporte en la demostración.', $2)`,
      [t.company, admin.id],
    );
  });
}

export async function resetAndSeed() {
  const pool = getPool();
  const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`)).rows.map((r) => `"${r.tablename}"`);
  if (tables.length) await pool.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  await seed();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    await migrate();
    const reset = process.argv.includes('--reset');
    const r = await one<{ n: number }>(getPool(), 'SELECT count(*)::int AS n FROM companies');
    if (reset) {
      await resetAndSeed();
      console.log('Base reiniciada con datos ficticios.');
    } else if (r?.n) {
      console.log('La base ya tiene datos. Usa "npm run db:reset" para borrar y volver a cargar la demo.');
    } else {
      await seed();
      console.log('Datos ficticios cargados.');
    }
    console.log(`Contraseña de todas las cuentas demo: ${DEMO_PASSWORD}`);
  })()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
