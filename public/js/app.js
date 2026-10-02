// Utilidades compartidas por todas las pantallas. Sin frameworks: HTML + JS del navegador.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Llamada a la API. Distingue error del servidor, error de negocio y "sin respuesta" (red caída).
export async function api(path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(0, 'NO_RESPONSE', 'No hubo respuesta del servidor (sin internet o servidor caído). El resultado es incierto.');
  } finally {
    clearTimeout(t);
  }
  let data = null;
  try { data = await res.json(); } catch { /* respuesta sin JSON */ }
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'HTTP_' + res.status, e.message ?? 'Error inesperado.', e.details);
  }
  return data;
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

const TZ = 'America/Mexico_City';
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-MX', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('es-MX', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const fmtMoney = (cents) => (cents == null ? '—' : (cents / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }));
export const unit = (kind, n) => (kind === 'stamps' ? (n === 1 ? 'sello' : 'sellos') : n === 1 ? 'punto' : 'puntos');

export const KIND_LABEL = {
  purchase: 'Compra', redemption: 'Canje', adjustment: 'Ajuste autorizado', refund: 'Devolución', redemption_reversal: 'Canje revertido',
  expiration: 'Vencimiento', transfer_out: 'Transferido a otra tarjeta', transfer_in: 'Recibido de otra tarjeta',
};

// ---------- encabezado común ----------
const NAV = [
  ['/directorio', 'Directorio'],
  ['/mis-tarjetas', 'Mis tarjetas'],
  ['/registro-negocio', 'Para negocios'],
  ['/situaciones', 'Situaciones'],
  ['/entrar', 'Entrar personal'],
];

let configPromise = null;
export const getConfig = () => (configPromise ??= api('/api/public/config').catch(() => ({ demoMode: false })));

export async function mountChrome() {
  const here = location.pathname;
  const links = NAV.map(([href, label]) => `<a href="${href}"${here.startsWith(href) ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="wrap">
      <a class="brand" href="/"><b>Chavarín &amp; Said</b><span>lealtad para negocios locales</span></a>
      <nav class="nav" aria-label="Principal">${links}</nav>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="mnav">Menú</button>
    </div>
    <nav id="mnav" class="mobile-nav" aria-label="Principal" hidden>${links}</nav>`;
  document.body.prepend(header);
  const btn = $('.menu-btn', header);
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    $('#mnav').hidden = open;
  });
  const cfg = await getConfig();
  if (cfg.demoMode) {
    const strip = document.createElement('div');
    strip.className = 'demo-strip';
    strip.innerHTML = `<div class="wrap">Demostración con negocios y personas ficticias. Los mensajes (SMS, WhatsApp, correo) y Wallet están simulados: <a href="/buzon-demo">ver buzón simulado</a>. No captures datos reales.</div>`;
    header.after(strip);
  }
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="wrap row between"><span>Chavarín &amp; Said (nombre provisional). Los premios los define, cubre y entrega cada negocio.</span>
    <span class="row"><a href="/privacidad">Aviso de privacidad (borrador)</a><a href="/situaciones">Situaciones y soluciones</a></span></div>`;
  document.body.append(footer);
}

// ---------- tarjeta visual ----------
export function nextGoal(balance, rewards) {
  const costs = (rewards ?? []).filter((r) => r.available !== false).map((r) => r.cost).sort((a, b) => a - b);
  return costs.find((c) => c > balance) ?? costs[costs.length - 1] ?? null;
}

export function cardHtml({ company, program, balance, kind, code, color, rewards, qrSrc, onSurface = false }) {
  const goal = nextGoal(balance, rewards);
  const costs = (rewards ?? []).filter((r) => r.available !== false).map((r) => r.cost);
  const canRedeem = costs.some((c) => c <= balance);
  const goalText = goal && goal > balance
    ? `${canRedeem ? 'Ya alcanza para un premio · ' : ''}Faltan ${goal - balance} para ${goal}`
    : 'Ya alcanza para un premio';
  let progress = '';
  if (kind === 'stamps' && goal && goal <= 12) {
    progress = `<div class="punches" aria-hidden="true">${Array.from({ length: goal }, (_, i) => `<i class="${i < Math.min(balance, goal) ? 'on' : ''}"></i>`).join('')}</div>
      <div class="lcard-goal">${goalText}</div>`;
  } else if (goal) {
    const pct = Math.min(100, Math.round((balance / goal) * 100));
    progress = `<div class="lcard-progress"><div class="lcard-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <div class="lcard-goal">${goalText}</div></div>`;
  }
  return `<div class="lcard${onSurface ? ' on-surface' : ''}" style="--card:${esc(color || '#1c2433')}" role="group" aria-label="Tarjeta de ${esc(company)}: ${balance} ${unit(kind, balance)}">
    <div class="lcard-main">
      <div class="lcard-company">${esc(company)}</div>
      <div class="lcard-program">${esc(program)}</div>
      <div class="lcard-balance"><b>${balance}</b><span>${unit(kind, balance)}</span></div>
      ${progress}
    </div>
    <div class="lcard-stub">
      ${qrSrc ? `<img class="lcard-qr" src="${esc(qrSrc)}" alt="QR de la tarjeta ${esc(code)}">` : ''}
      <div class="lcard-code">${esc(code || '')}</div>
    </div>
  </div>`;
}

// ---------- mensajes de estado ----------
export function statusHtml(type, title, body = '', extra = '') {
  const cls = { ok: 'status-ok', pend: 'status-pend', err: 'status-err', warn: 'status-warn' }[type];
  const role = type === 'err' ? 'alert' : 'status';
  return `<div class="status ${cls}" role="${role}"><b>${type === 'pend' ? '<span class="spinner" aria-hidden="true"></span> ' : ''}${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}${extra}</div>`;
}

export function showStatus(target, type, title, body = '', extra = '') {
  target.innerHTML = statusHtml(type, title, body, extra);
}

export function loadingRows(n = 3) {
  return Array.from({ length: n }, () => '<div class="skeleton" style="height:64px;margin-bottom:10px"></div>').join('');
}

export function errorBlock(e, retryId) {
  return `<div class="status status-err" role="alert"><b>No se pudo cargar</b><span>${esc(e.message)}</span>${retryId ? `<div class="row"><button class="btn btn-secondary btn-sm" id="${retryId}" type="button">Reintentar</button></div>` : ''}</div>`;
}

export function tabs(container, onChange) {
  const buttons = $$('[role="tab"]', container);
  const select = (btn) => {
    buttons.forEach((b) => {
      const on = b === btn;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(b.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    onChange?.(btn.dataset.tab);
    history.replaceState(null, '', `#${btn.dataset.tab}`);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(b));
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
        next.focus();
        select(next);
      }
    });
  });
  const initial = buttons.find((b) => `#${b.dataset.tab}` === location.hash) ?? buttons[0];
  select(initial);
  return select;
}

export function confirmDialog({ title, body, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h2 style="font-size:1.25rem">${esc(title)}</h2><p>${esc(body)}</p>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-secondary" value="no" type="button">${esc(cancelText)}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes" type="button">${esc(confirmText)}</button></div>`;
    document.body.append(d);
    d.addEventListener('click', (e) => {
      const v = e.target.closest('button')?.value;
      if (v) { d.close(); d.remove(); resolve(v === 'yes'); }
    });
    d.addEventListener('cancel', () => { d.remove(); resolve(false); });
    d.showModal();
  });
}

export function formData(form) {
  const o = {};
  for (const [k, v] of new FormData(form).entries()) o[k] = typeof v === 'string' ? v.trim() : v;
  return o;
}
