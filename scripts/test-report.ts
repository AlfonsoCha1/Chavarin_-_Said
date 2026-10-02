// Corre todas las pruebas y guarda el resultado REAL en docs/RESULTADOS_PRUEBAS.md.
import { spawnSync } from 'node:child_process';
import { writeFileSync, readdirSync } from 'node:fs';

const files = readdirSync('tests').filter((f) => f.endsWith('.test.ts')).map((f) => `tests/${f}`);
const started = new Date();
const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=spec', ...files], { encoding: 'utf8', env: process.env });
const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
const pg = spawnSync('psql', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? 'psql no disponible';
const summary = out.split('\n').filter((l) => /^ℹ (tests|suites|pass|fail|cancelled|skipped|duration_ms)/.test(l)).join('\n');

const md = `# Resultados de pruebas

- Fecha de ejecución: ${started.toISOString()} (UTC)
- Node.js ${process.version} · ${pg}
- Comando: \`npm test\` (equivalente a \`node --import tsx --test --test-concurrency=1 tests/*.test.ts\`)
- Código de salida: **${r.status}** ${r.status === 0 ? '(todas pasaron)' : '(HAY FALLAS)'}

Estas pruebas usan una base PostgreSQL real (\`TEST_DATABASE_URL\`) que se borra y recarga con datos ficticios, el servidor real (incluido un proceso aparte que se mata y reinicia) y un navegador Chromium real.

## Resumen

\`\`\`
${summary}
\`\`\`

## Verificaciones pedidas en el brief

| Verificación | Prueba |
|---|---|
| Categorías y búsqueda | T01 (API) y "directorio: categorías desplegables con teclado…" (navegador) |
| QR que abre la sucursal correcta | T02 (decodifica el QR impreso en el navegador y sigue la URL) |
| Persistencia tras reiniciar | T03 (mata el servidor con SIGKILL y lo vuelve a arrancar) |
| Separación entre empresas | T04 |
| Compra y canje normales | T05 |
| Saldo insuficiente | T06 |
| Compra duplicada | T07 (incluye 6 envíos simultáneos) |
| Canjes concurrentes | T08 (10 simultáneos desde dos cuentas → 1) |
| Ajustes auditados | T09 (incluye intento de UPDATE/DELETE del historial) |
| Revocación de empleados | T10 |
| Fallo de actualización de Wallet sin pérdida de compra | T11 (falla simulada del adaptador) |

Qué **no** cubren: cámara real del celular, proveedores reales de mensajes o Wallet (no existen aún), carga alta, despliegue en Render y auditoría de seguridad externa.

## Salida completa

\`\`\`
${out.trim()}
\`\`\`
`;
writeFileSync('docs/RESULTADOS_PRUEBAS.md', md);
console.log(summary);
process.exit(r.status ?? 1);
