// Genera docs/SITUACIONES.md desde public/data/situaciones.json y los PDF de los documentos.
// Uso: npm run docs   (requiere Chromium: npx playwright install chromium, o CHROMIUM_PATH)
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { chromium } from 'playwright';

const root = process.cwd();
const ESTADO: Record<string, string> = { implementado: 'Implementado', parcial: 'Parcial', simulado: 'Simulado', procedimiento: 'Procedimiento', pendiente: 'Pendiente' };

function buildSituaciones() {
  const data = JSON.parse(readFileSync(join(root, 'public/data/situaciones.json'), 'utf8'));
  const counts: Record<string, number> = {};
  for (const s of data.situaciones) counts[s.estado] = (counts[s.estado] ?? 0) + 1;
  let md = `---\ntitle: Situaciones y soluciones\nsubtitle: Plataforma de lealtad Chavarín & Said (nombre provisional)\ndate: Versión ${data.version}\n---\n\n# Situaciones y soluciones\n\n`;
  md += `Qué hacer cuando algo sale distinto a lo normal. Cada caso indica situación, pantalla, respuesta, responsable, prevención y estado de implementación. ${data.nota}\n\n`;
  md += `Basado en la guía de 36 situaciones (diseño propuesto) y en la lista del brief; se agregaron ${data.situaciones.length - 36} casos.\n\n`;
  md += `**Estados**: Implementado = el sistema lo hace cumplir · Parcial = parte implementada y parte simulada o pendiente · Simulado = existe solo como simulación etiquetada · Procedimiento = lo cumplen las personas · Pendiente = no existe.\n\n`;
  md += `| Estado | Casos |\n|---|---|\n${Object.entries(ESTADO).map(([k, v]) => `| ${v} | ${counts[k] ?? 0} |`).join('\n')}\n\n`;
  md += `## Índice\n\n| # | Situación | Estado |\n|---|---|---|\n${data.situaciones.map((s: any) => `| ${String(s.id).padStart(2, '0')} | ${s.titulo} | ${ESTADO[s.estado]} |`).join('\n')}\n\n`;
  for (const s of data.situaciones) {
    md += `## ${String(s.id).padStart(2, '0')}. ${s.titulo}\n\n`;
    md += `- **Situación:** ${s.situacion}\n- **Pantalla:** ${s.pantalla}\n- **Respuesta:** ${s.respuesta}\n- **Responsable:** ${s.responsable}\n- **Prevención:** ${s.prevencion}\n- **Estado:** ${s.estado_detalle.startsWith(ESTADO[s.estado]) ? '' : ESTADO[s.estado] + '. '}${s.estado_detalle}${s.prueba ? ` Prueba: ${s.prueba}.` : ''}\n\n`;
  }
  writeFileSync(join(root, 'docs/SITUACIONES.md'), md);
  console.log(`docs/SITUACIONES.md: ${data.situaciones.length} situaciones`);
}

const CSS = (fontUrl: string) => `
@font-face { font-family: 'Archivo'; src: url('${fontUrl}') format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
@page { size: Letter; margin: 18mm 16mm 18mm 16mm; }
body { font-family: 'Archivo', sans-serif; color: #1c2433; font-size: 10.5pt; line-height: 1.5; }
.cover { border-bottom: 3px solid #17785f; padding-bottom: 10px; margin-bottom: 18px; }
.cover .t { font-size: 24pt; font-weight: 800; font-stretch: 118%; line-height: 1.1; }
.cover .s { color: #4b5568; margin-top: 6px; }
h1 { display: none; }
h2 { font-stretch: 115%; font-size: 14pt; margin: 18px 0 6px; break-after: avoid; color: #0f5c48; }
h3 { font-size: 11.5pt; margin: 12px 0 4px; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
ul { padding-left: 18px; }
li { margin: 2px 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 9pt; break-inside: auto; }
th, td { border: 1px solid #d9dee6; padding: 4px 6px; text-align: left; vertical-align: top; }
th { background: #eef1f4; }
tr { break-inside: avoid; }
code, pre { font-family: Menlo, monospace; font-size: 8.5pt; }
pre { background: #f4f5f7; padding: 8px; border-radius: 4px; white-space: pre-wrap; }
blockquote { border-left: 4px solid #f2b134; background: #fff5dc; margin: 8px 0; padding: 6px 10px; }
a { color: #0f5c48; }
`;

async function buildPdfs() {
  const exe = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: exe });
  const outDir = join(root, 'docs/pdf');
  mkdirSync(outDir, { recursive: true });
  const fontUrl = pathToFileURL(resolve(root, 'public/fonts/archivo.woff2')).href;
  const docs = ['REGLAS_OPERATIVAS', 'SITUACIONES', 'FUNCIONES', 'GUION_PRESENTACION', 'RESULTADOS_PRUEBAS'];
  for (const name of docs) {
    const src = join(root, 'docs', `${name}.md`);
    if (!existsSync(src)) continue;
    let text = readFileSync(src, 'utf8');
    let title = name.replace(/_/g, ' ');
    let subtitle = '';
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (fm) {
      const meta = Object.fromEntries(fm[1].split('\n').map((l) => [l.split(':')[0].trim(), l.slice(l.indexOf(':') + 1).trim()]));
      title = meta.title ?? title;
      subtitle = [meta.subtitle, meta.date].filter(Boolean).join(' · ');
      text = text.slice(fm[0].length);
    } else {
      const h1 = text.match(/^# (.+)$/m);
      if (h1) title = h1[1];
      subtitle = 'Plataforma de lealtad Chavarín & Said (nombre provisional)';
    }
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${CSS(fontUrl)}</style></head><body>
      <div class="cover"><div class="t">${title}</div><div class="s">${subtitle}</div></div>${await marked.parse(text)}</body></html>`;
    const tmp = join(outDir, `.${name}.html`);
    writeFileSync(tmp, html);
    const page = await browser.newPage();
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: join(outDir, `${name}.pdf`), format: 'Letter', printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:7pt;color:#6f798b;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>${title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    await page.close();
    rmSync(tmp);
    console.log(`docs/pdf/${name}.pdf`);
  }
  await browser.close();
}

buildSituaciones();
if (!process.argv.includes('--solo-md')) await buildPdfs();
