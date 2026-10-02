import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fstatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { publicRoutes } from './routes/public.js';
import { customerRoutes } from './routes/customer.js';
import { staffRoutes } from './routes/staff.js';
import { ownerRoutes } from './routes/owner.js';
import { adminRoutes } from './routes/admin.js';

function publicDir() {
  for (const p of [join(process.cwd(), 'public'), new URL('../public', import.meta.url).pathname, new URL('../../public', import.meta.url).pathname]) {
    if (existsSync(p)) return p;
  }
  throw new Error('No se encontró la carpeta public');
}

// Páginas: rutas limpias → archivo HTML.
const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/directorio': 'directorio.html',
  '/n/:slug': 'negocio.html',
  '/s/:code': 'sucursal.html',
  '/r/:code': 'registro.html',
  '/c/:code': 'tarjeta-qr.html',
  '/mis-tarjetas': 'mis-tarjetas.html',
  '/entrar': 'entrar.html',
  '/empleado': 'empleado.html',
  '/dueno': 'dueno.html',
  '/admin': 'admin.html',
  '/registro-negocio': 'registro-negocio.html',
  '/situaciones': 'situaciones.html',
  '/buzon-demo': 'buzon.html',
  '/privacidad': 'privacidad.html',
  '/imprimir/qr/:code': 'imprimir-qr.html',
  '/imprimir/tarjeta/:code': 'imprimir-tarjeta.html',
};

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 256 * 1024 });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.publicBaseUrl.startsWith('https://') ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.publicBaseUrl.startsWith('https://'),
  });

  // Protección CSRF básica: las peticiones que cambian datos deben ser JSON y venir del mismo sitio.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const ct = String(req.headers['content-type'] ?? '');
    if (!ct.startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'Las operaciones deben enviarse como JSON.');
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers['x-forwarded-host'] ?? req.headers.host;
      try {
        if (new URL(origin).host !== host) throw new AppError(403, 'BAD_ORIGIN', 'Origen no permitido.');
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(403, 'BAD_ORIGIN', 'Origen no permitido.');
      }
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('cache-control', reply.getHeader('cache-control') ?? 'no-store');
    return payload;
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const field = first?.path?.join('.') || 'datos';
      return reply.status(400).send({ ok: false, error: { code: 'VALIDATION', message: `Revisa el campo "${field}": ${first?.message ?? 'valor inválido'}.`, details: { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) } } });
    }
    if (err?.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ ok: false, error: { code: err.code ?? 'BAD_REQUEST', message: 'Petición inválida.' } });
    }
    req.log.error(err);
    if (!opts.logger) console.error(err);
    return reply.status(500).send({ ok: false, error: { code: 'SERVER_ERROR', message: 'Error del servidor. La operación no se confirmó; consulta su estado antes de repetirla.' } });
  });

  await app.register(publicRoutes);
  await app.register(customerRoutes);
  await app.register(staffRoutes);
  await app.register(ownerRoutes);
  await app.register(adminRoutes);

  const root = publicDir();
  await app.register(fstatic, { root, index: false, wildcard: true, maxAge: config.isProduction ? 3600_000 : 0 });
  for (const [route, file] of Object.entries(PAGES)) {
    app.get(route, (req, reply) => reply.header('cache-control', 'no-cache').sendFile(file));
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
    return reply.status(404).type('text/html').sendFile('404.html');
  });
  return app;
}
