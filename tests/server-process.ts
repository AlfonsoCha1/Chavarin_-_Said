// Arranca el servidor real como proceso aparte (para probar reinicios y el navegador).
import { spawn, type ChildProcess } from 'node:child_process';

export async function startServer(port: number, extraEnv: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://lealtad:lealtad_local@localhost:5432/lealtad_test',
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_BASE_URL: `http://localhost:${port}`,
      SEED_DEMO_ON_EMPTY: 'false',
      DEMO_MODE: 'true',
      KEEPALIVE_URL: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (d) => (stderr += d));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return child;
    } catch {}
    if (child.exitCode !== null) throw new Error(`el servidor terminó: ${stderr}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill('SIGKILL');
  throw new Error(`el servidor no arrancó: ${stderr}`);
}

export function stopServer(child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL') {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill(signal);
  });
}

// Cliente HTTP mínimo con cookies.
export class HttpAgent {
  cookie = '';
  constructor(private base: string) {}
  async req(method: string, path: string, body?: unknown) {
    const r = await fetch(this.base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie: this.cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(';')[0];
      const [k] = pair.split('=');
      this.cookie = [...this.cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')), pair].join('; ');
    }
    return { status: r.status, body: await r.json().catch(() => null) };
  }
}
