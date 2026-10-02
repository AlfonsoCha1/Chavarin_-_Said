// Maquetas: capturas reales de cada pantalla, en celular y computadora, con estados de carga, vacío, error y éxito.
// Uso: npm run screens  (usa TEST_DATABASE_URL, la reinicia; requiere Chromium)
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { chromium, type Page, type BrowserContext } from 'playwright';
import { startServer, stopServer } from '../tests/server-process.js';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://lealtad:lealtad_local@localhost:5432/lealtad_test';
const { migrate } = await import('../src/migrate.js');
const { resetAndSeed } = await import('../src/seed.js');
const { closePool, getPool } = await import('../src/db.js');

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const OUT = 'docs/maquetas';
mkdirSync(OUT, { recursive: true });
await migrate(false);
await resetAndSeed();
const server = await startServer(PORT);
const exe = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath: exe });
const index: { file: string; title: string; note: string }[] = [];

const VIEWPORTS = { escritorio: { width: 1280, height: 860 }, celular: { width: 390, height: 844 } } as const;

async function shot(page: Page, file: string, title: string, note = '', fullPage = true) {
  if (fullPage) await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage });
  index.push({ file: `${file}.png`, title, note });
  console.log(file);
}

async function ctxFor(vp: keyof typeof VIEWPORTS, mobile = vp === 'celular'): Promise<BrowserContext> {
  return browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
}

async function login(page: Page, email: string, path: string) {
  await page.goto(`${BASE}/entrar`);
  await page.fill('#email', email);
  await page.fill('#password', 'demo-12345');
  await page.click('#form button[type=submit]');
  await page.waitForURL(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
}

for (const vp of ['escritorio', 'celular'] as const) {
  const ctx = await ctxFor(vp);
  const page = await ctx.newPage();
  const go = async (p: string) => { await page.goto(BASE + p, { waitUntil: 'networkidle' }); };

  await go('/');
  await shot(page, `01-presentacion-${vp}`, `Página de presentación (${vp})`);

  await go('/directorio?categoria=comida-rapida');
  await shot(page, `02-directorio-categorias-${vp}`, `Directorio con categorías desplegadas (${vp})`, 'Comida y bebidas › Comida rápida abierta; las ramas se abren con clic, teclado o mouse.');

  await go('/directorio?q=centro');
  await shot(page, `03-busqueda-${vp}`, `Búsqueda de negocios y sucursales (${vp})`, 'Búsqueda "centro": coincide en nombre de sucursal, colonia y dirección; se resalta la coincidencia.');

  await go('/directorio?q=veterinaria');
  await shot(page, `03b-busqueda-vacia-${vp}`, `Búsqueda sin resultados — estado vacío (${vp})`);

  await go('/s/tacos-del-centro-centro');
  await shot(page, `04-sucursal-${vp}`, `Página de sucursal (${vp})`, 'Dirección, programa, premios, condiciones, sucursales que comparten saldo y botón "Obtener mi tarjeta".');

  await go('/r/tacos-del-centro-centro');
  await shot(page, `04b-registro-cliente-qr-${vp}`, `Registro del cliente desde el QR del mostrador (${vp})`);

  await go('/registro-negocio');
  await shot(page, `05-registro-negocio-${vp}`, `Registro del negocio (${vp})`);

  await go('/situaciones');
  await shot(page, `09-situaciones-${vp}`, `Centro de situaciones y soluciones (${vp})`, '', vp === 'celular' ? false : false);
  await ctx.close();
}

// ---- Cliente: Mis tarjetas ----
for (const vp of ['escritorio', 'celular'] as const) {
  const ctx = await ctxFor(vp);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/mis-tarjetas`, { waitUntil: 'networkidle' });
  await page.click('label:has(input[name=channel][value=email])');
  await page.fill('#contact', 'ana.martinez@example.com');
  await page.click('#lform button[type=submit]');
  await page.waitForSelector('#cform:not([hidden])');
  const code = (await getPool().query(`SELECT body FROM outbox_messages WHERE destination = 'ana.martinez@example.com' ORDER BY id DESC LIMIT 1`)).rows[0].body.match(/(\d{6})/)[1];
  if (vp === 'escritorio') await shot(page, `08a-mis-tarjetas-codigo-${vp}`, 'Mis tarjetas: entrada con código (simulado)');
  await page.fill('#lcode', code);
  await page.click('#cform button[type=submit]');
  await page.waitForSelector('#cards article');
  await page.waitForLoadState('networkidle');
  await shot(page, `08-mis-tarjetas-${vp}`, `Mis tarjetas del cliente (${vp})`, 'Tres sectores distintos; QR + número; saldo del servidor; Wallet marcado como simulación.');
  await ctx.close();
}

// ---- Empleado ----
for (const vp of ['escritorio', 'celular'] as const) {
  const ctx = await ctxFor(vp);
  const page = await ctx.newPage();
  await login(page, 'empleado.centro@example.com', '/empleado');
  await shot(page, `07a-empleado-inicio-${vp}`, `Panel del empleado: sin tarjeta seleccionada — estado vacío (${vp})`);
  await page.fill('#code', vp === 'escritorio' ? 'C-104' : 'C-T205');
  await page.click('#find button[type=submit]');
  await page.waitForSelector('#buy');
  await page.fill('#ticket', vp === 'escritorio' ? 'T-208' : 'T-301');
  await page.fill('#amount', '145.50');
  await page.click('#buy button[type=submit]');
  await page.waitForSelector('#op .status-ok');
  await shot(page, `07-empleado-compra-exito-${vp}`, `Panel del empleado: compra confirmada — éxito (${vp})`);
  if (vp === 'escritorio') {
    await page.fill('#ticket', 'T-208');
    await page.click('#buy button[type=submit]');
    await page.waitForSelector('#op .status-err');
    await shot(page, `07b-empleado-ticket-duplicado-${vp}`, 'Panel del empleado: ticket repetido — error');
    // Resultado incierto: se corta la red justo al confirmar.
    await page.route('**/api/staff/purchases', (r) => r.abort('failed'));
    await page.fill('#ticket', 'T-210');
    await page.click('#buy button[type=submit]');
    await page.waitForSelector('#op .status-warn');
    await shot(page, `07c-empleado-resultado-incierto-${vp}`, 'Panel del empleado: respuesta interrumpida — pendiente de consultar');
    await page.unroute('**/api/staff/purchases');
    await page.click('#chk');
    await page.waitForSelector('#op .status-warn, #op .status-ok');
    await shot(page, `07d-empleado-consulta-estado-${vp}`, 'Panel del empleado: consulta de estado — "No se guardó; reintenta con la misma clave"');
    await page.click('[data-tab=contingencia]');
    await shot(page, `07e-empleado-sin-internet-${vp}`, 'Panel del empleado: contingencia sin internet');
    // Carga: se retrasa la respuesta para ver el estado "Buscando".
    await page.click('[data-tab=mostrador]');
    await page.route('**/api/staff/cards/**', async (r) => { await new Promise((x) => setTimeout(x, 3000)); await r.continue(); });
    await page.fill('#code', 'C-105');
    await page.click('#find button[type=submit]');
    await page.waitForTimeout(300);
    await shot(page, `07f-empleado-cargando-${vp}`, 'Panel del empleado: buscando tarjeta — carga', '', false);
    await page.unroute('**/api/staff/cards/**');
  }
  await ctx.close();
}

// ---- Dueño ----
for (const vp of ['escritorio', 'celular'] as const) {
  const ctx = await ctxFor(vp);
  const page = await ctx.newPage();
  await login(page, 'dueno.tacos@example.com', '/dueno');
  await shot(page, `06-dueno-resumen-${vp}`, `Panel del dueño: resumen y recurrencia (${vp})`);
  if (vp === 'escritorio') {
    for (const [tab, title] of [['tarjeta', 'tarjetas y ajustes'], ['empleados', 'empleados y permisos'], ['programa', 'programa y premios'], ['sucursales', 'sucursales y QR'], ['canjes', 'canjes']] as const) {
      await page.click(`[data-tab=${tab}]`);
      await page.waitForLoadState('networkidle');
      if (tab === 'tarjeta') {
        await page.fill('#ccode', 'C-105');
        await page.click('#cq button[type=submit]');
        await page.waitForSelector('#adj');
      }
      await shot(page, `06-dueno-${tab}-${vp}`, `Panel del dueño: ${title}`);
    }
    // Error de carga: el servidor no responde.
    await page.route('**/api/owner/audit', (r) => r.abort('failed'));
    await page.click('[data-tab=bitacora]');
    await page.waitForSelector('#p-bitacora .status-err');
    await shot(page, `06-dueno-error-carga-${vp}`, 'Panel del dueño: error de carga con reintento', '', false);
  }
  await ctx.close();
}

// ---- Administración y QR ----
{
  const ctx = await ctxFor('escritorio');
  const page = await ctx.newPage();
  await login(page, 'admin@example.com', '/admin');
  for (const tab of ['negocios', 'categorias', 'integraciones']) {
    await page.click(`[data-tab=${tab}]`);
    await page.waitForLoadState('networkidle');
    await shot(page, `10-admin-${tab}-escritorio`, `Administración: ${tab}`);
  }
  await page.goto(`${BASE}/imprimir/qr/tacos-del-centro-centro`, { waitUntil: 'networkidle' });
  await shot(page, `11-qr-mostrador-escritorio`, 'QR de mostrador para imprimir');
  await page.goto(`${BASE}/buzon-demo`, { waitUntil: 'networkidle' });
  await shot(page, `12-buzon-simulado-escritorio`, 'Buzón simulado de la demostración');
  await ctx.close();
}

await browser.close();
await stopServer(server, 'SIGTERM');
await closePool();

writeFileSync(`${OUT}/README.md`, `# Maquetas\n\nCapturas reales de la aplicación funcionando con datos ficticios (generadas con \`npm run screens\`). No son diseños aparte: son las pantallas tal como corren hoy.\n\n${index.map((i) => `## ${i.title}\n\n${i.note ? i.note + '\n\n' : ''}![${i.title}](${i.file})\n`).join('\n')}`);
writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1));
console.log(`${index.length} capturas en ${OUT}`);
