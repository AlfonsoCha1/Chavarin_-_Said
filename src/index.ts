import { buildApp } from './server.js';
import { config } from './config.js';
import { getPool, one } from './db.js';
import { migrate } from './migrate.js';

async function main() {
  await migrate();
  if (config.seedDemoOnEmpty) {
    const r = await one<{ n: number }>(getPool(), 'SELECT count(*)::int AS n FROM companies');
    if (!r?.n) {
      const { seed } = await import('./seed.js');
      await seed();
      console.log('Base vacía: se cargaron los negocios ficticios de demostración.');
    }
  }
  const app = await buildApp({ logger: true });
  await app.listen({ port: config.port, host: config.host });

  // Despertador interno para Render gratis: el propio servicio visita su URL pública.
  // Solo evita que se duerma mientras está despierto; el respaldo externo está en .github/workflows/keepalive.yml.
  if (config.keepaliveUrl) {
    const ms = Math.max(5, config.keepaliveMinutes) * 60_000;
    const [from, to] = (config.keepaliveHours.match(/^(\d{1,2})-(\d{1,2})$/)?.slice(1).map(Number) ?? [0, 24]) as [number, number];
    const hourNow = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    setInterval(() => {
      const h = hourNow();
      if (h < from || h >= to) return; // fuera de horario se deja dormir para no gastar horas gratis
      fetch(config.keepaliveUrl, { signal: AbortSignal.timeout(20_000) }).catch((e) => app.log.warn(`keepalive falló: ${e.message}`));
    }, ms).unref();
    app.log.info(`keepalive cada ${ms / 60_000} min de ${from}:00 a ${to}:00 (CDMX) → ${config.keepaliveUrl}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
