// Pruebas en navegador real (Chromium). Requiere: npx playwright install chromium (o CHROMIUM_PATH).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { boot } from './helpers.js';
import { startServer, stopServer } from './server-process.js';

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
let env: Awaited<ReturnType<typeof boot>>;
let server: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;
const exe = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

before(async () => {
  env = await boot();
  await env.fresh();
  server = await startServer(PORT);
  browser = await chromium.launch({ executablePath: exe });
});
after(async () => {
  await browser?.close();
  await stopServer(server, 'SIGTERM');
  await env.close();
});

async function decodeQrOnPage(page: any, selector: string): Promise<string | null> {
  await page.addScriptTag({ url: '/vendor/jsQR.js' });
  return page.evaluate(async (sel: string) => {
    const img = document.querySelector(sel) as HTMLImageElement;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 600; c.height = 600;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 600);
    ctx.drawImage(img, 50, 50, 500, 500);
    const d = ctx.getImageData(0, 0, 600, 600);
    return (window as any).jsQR(d.data, 600, 600)?.data ?? null;
  }, selector);
}

describe('T02 QR que abre la sucursal correcta', () => {
  it('el QR impreso de cada sucursal lleva a SU registro y el registro crea la tarjeta con 0 puntos', async () => {
    const page = await browser.newPage();
    for (const code of ['barberia-el-filo-izcalli', 'tacos-del-centro-norte']) {
      await page.goto(`${BASE}/imprimir/qr/${code}`, { waitUntil: 'networkidle' });
      const url = await decodeQrOnPage(page, '#sheet img.qr');
      assert.equal(url, `${BASE}/r/${code}`, `QR de ${code}`);
    }
    await page.goto(`${BASE}/r/barberia-el-filo-izcalli`, { waitUntil: 'networkidle' });
    assert.match(await page.textContent('#branchInfo') ?? '', /Barbería El Filo[\s\S]*Sucursal Izcalli/);
    await page.fill('#name', 'Laura Navegador');
    await page.click('label:has(input[name=channel][value=sms])');
    await page.fill('#phone', '5544556677');
    await page.check('#acceptPrivacy');
    await page.click('#form1 button[type=submit]');
    await page.waitForSelector('#step2:not([hidden])');
    const code = (await env.sql(`SELECT body FROM outbox_messages WHERE destination = '+525544556677' ORDER BY id DESC LIMIT 1`))[0].body.match(/(\d{6})/)[1];
    await page.fill('#code', code);
    await page.click('#form2 button[type=submit]');
    await page.waitForSelector('#done:not([hidden])');
    const done = await page.textContent('#done');
    assert.match(done ?? '', /Tarjeta creada/);
    const cardCode = (await env.sql(`SELECT ca.code, ca.balance, b.code AS branch FROM cards ca JOIN customers cu ON cu.id = ca.customer_id JOIN branches b ON b.id = ca.issued_branch_id WHERE cu.phone = '+525544556677'`))[0];
    assert.equal(cardCode.branch, 'barberia-el-filo-izcalli');
    assert.equal(cardCode.balance, 0);
    // El QR de la tarjeta del cliente identifica la tarjeta (no la sucursal) y escanearlo no suma.
    const cardQr = await decodeQrOnPage(page, '#done img.lcard-qr');
    assert.equal(cardQr, `${BASE}/c/${cardCode.code}`);
    await page.goto(cardQr!, { waitUntil: 'networkidle' });
    assert.match(await page.textContent('main') ?? '', /no suma puntos/);
    assert.equal((await env.sql(`SELECT balance FROM cards WHERE code = $1`, [cardCode.code]))[0].balance, 0);
    await page.close();
  });
});

describe('Flujos de pantalla', () => {
  it('directorio: categorías desplegables con teclado y búsqueda por dirección', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/directorio`, { waitUntil: 'networkidle' });
    const toggle = page.locator('button.cat-toggle[aria-controls="cat-comida-rapida"]');
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await page.fill('#q', 'madero');
    await page.press('#q', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('#results .result').length === 1);
    assert.match(await page.textContent('#results') ?? '', /Música Allegro/);
    await page.click('#results a:has-text("Ver negocio")');
    await page.waitForURL(`${BASE}/s/musica-allegro-centro`);
    assert.match(await page.textContent('main') ?? '', /Obtener mi tarjeta/);
    await page.close();
  });

  it('mostrador: el empleado identifica la tarjeta, confirma compra y el ticket repetido se rechaza', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/entrar`);
    await page.fill('#email', 'empleado.centro@example.com');
    await page.fill('#password', 'demo-12345');
    await page.click('#form button[type=submit]');
    await page.waitForURL(`${BASE}/empleado`);
    await page.fill('#code', 'c-105');
    await page.click('#find button[type=submit]');
    await page.waitForSelector('#buy');
    await page.fill('#ticket', 'UI-1');
    await page.click('#buy button[type=submit]');
    await page.waitForSelector('#op .status-ok');
    assert.match(await page.textContent('#op') ?? '', /Saldo actual: 60/);
    await page.fill('#ticket', 'UI-1');
    await page.click('#buy button[type=submit]');
    await page.waitForSelector('#op .status-err'); // el ticket repetido se rechaza antes de preguntar nada
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.match(await page.textContent('#op') ?? '', /Ticket ya registrado/);
    assert.equal((await env.sql(`SELECT balance FROM cards WHERE code = 'C-105'`))[0].balance, 60);
    await ctx.close();
  });
});
