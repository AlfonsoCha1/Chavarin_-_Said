import { mountChrome, api, esc, $, $$, showStatus, statusHtml, cardHtml, newKey, fmtDateTime, fmtMoney, unit, tabs, confirmDialog, KIND_LABEL } from '../app.js';
mountChrome();

let me = null;
let current = null; // tarjeta consultada
let pendingOp = null; // { type, key, body } operación en curso o incierta

const branchId = () => $('#branch').value;
const PENDING_KEY = 'cs_pending_op';

// ---------- conexión ----------
function netBanner() {
  $('#net').innerHTML = navigator.onLine
    ? ''
    : statusHtml('warn', 'Sin conexión', 'No confirmes canjes. Atiende con la hoja de contingencia y captura los comprobantes al reconectar.');
}
addEventListener('online', netBanner);
addEventListener('offline', netBanner);

async function init() {
  try {
    me = await api('/api/staff/me');
  } catch (e) {
    $('#gate').innerHTML = `<div class="panel empty"><p><b>Entra con tu cuenta para usar el mostrador.</b></p><a class="btn btn-primary" href="/entrar">Entrar</a></div>`;
    return;
  }
  if (!me.company) {
    $('#gate').innerHTML = `<div class="panel empty"><p><b>Tu cuenta no tiene un negocio activo.</b></p><a class="btn btn-primary" href="/admin">Ir a administración</a></div>`;
    return;
  }
  $('#gate').hidden = true;
  $('#ui').hidden = false;
  $('#who').textContent = `${me.company.name} · ${me.user.name} (${{ owner: 'dueño', manager: 'encargado', employee: 'empleado' }[me.membership.role]})`;
  $('#toOwner').hidden = me.membership.role === 'employee';
  $('#branch').innerHTML = me.branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  const saved = localStorageGet('cs_branch');
  if (saved && me.branches.some((b) => b.id === saved)) $('#branch').value = saved;
  if (me.branches.length === 1) $('#branch').disabled = true;
  if (me.company.status !== 'approved') {
    $('#net').innerHTML = statusHtml('warn', 'Negocio no aprobado para operar', me.company.status === 'suspended' ? 'El servicio está suspendido. Los saldos se conservan; contacta a soporte.' : 'Cuando la plataforma apruebe el negocio podrás registrar compras.');
  } else netBanner();
  tabs($('.tabs'), (t) => { if (t === 'turno') loadShift(); });
  restorePending();
  addContRow();
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
$('#branch').addEventListener('change', () => { localStorageSet('cs_branch', branchId()); if (current) lookup(current.card.code); });

$('#logout').addEventListener('click', async () => {
  await api('/api/staff/logout', { method: 'POST', body: {} }).catch(() => {});
  location.href = '/entrar';
});

// ---------- identificar ----------
$('#find').addEventListener('submit', (e) => { e.preventDefault(); lookup($('#code').value); });

async function lookup(raw) {
  const code = String(raw).trim();
  if (!code) return showStatus($('#findMsg'), 'err', 'Escribe el número de la tarjeta.');
  showStatus($('#findMsg'), 'pend', 'Buscando tarjeta…');
  try {
    current = await api(`/api/staff/cards/${encodeURIComponent(code)}`);
    $('#findMsg').innerHTML = '';
    $('#code').value = current.card.code;
    renderCard();
  } catch (e) {
    current = null;
    showStatus($('#findMsg'), 'err', e.status === 404 ? 'Tarjeta no encontrada en este negocio' : 'No se pudo consultar', e.message);
  }
}

function renderCard(opHtml = '') {
  const c = current.card;
  const inBranch = current.branches.some((b) => b.id === branchId());
  const u = (n) => unit(c.kind, n);
  const inactive = c.status !== 'active';
  $('#cardPanel').innerHTML = `
    <div class="panel stack">
      <div class="row between"><h2 style="font-size:1.2rem;margin:0">2. Tarjeta ${esc(c.code)}</h2><button class="btn btn-ghost btn-sm" id="refresh" type="button">Actualizar saldo</button></div>
      ${cardHtml({ company: me.company.name, program: c.programName, balance: c.balance, kind: c.kind, code: c.code, color: me.company.cardColor, rewards: current.rewards, onSurface: true })}
      <p style="margin:0">Titular: <b>${esc(c.holder)}</b>${c.holderVerified ? ' <span class="tag tag-ok">contacto verificado</span>' : ''} · ${c.format === 'printed' ? 'Tarjeta impresa' : 'Tarjeta web'}</p>
      ${inactive ? statusHtml('err', 'Tarjeta no activa', 'No registres operaciones con esta tarjeta; pide la tarjeta vigente del cliente.') : ''}
      ${!inBranch ? statusHtml('warn', 'Esta tarjeta no aplica en esta sucursal', `Vale en: ${current.branches.map((b) => b.name).join(', ')}. Avísale al cliente antes de cobrar.`) : ''}
      <div id="op">${opHtml}</div>
      <form id="buy" class="panel" style="background:var(--paper)" novalidate>
        <h3 style="margin-top:0">3. Confirmar compra (+${current.rules.pointsPerPurchase} ${u(current.rules.pointsPerPurchase)})</h3>
        <p class="small muted" style="margin-top:0">${esc(current.rules.eligible)}${current.rules.minPurchaseCents ? ' Mínimo ' + fmtMoney(current.rules.minPurchaseCents) + '.' : ''}</p>
        <div class="row" style="align-items:flex-end">
          <div style="flex:1;min-width:140px"><label for="ticket">Ticket o nota</label><input id="ticket" autocomplete="off" placeholder="T-208" maxlength="60"></div>
          <div style="width:140px"><label for="amount">Importe${current.rules.minPurchaseCents ? '' : ' (opcional)'}</label><input id="amount" inputmode="decimal" placeholder="0.00"></div>
        </div>
        <button class="btn btn-primary btn-big" type="submit" style="margin-top:12px" ${inactive || !inBranch ? 'disabled' : ''}>Confirmar compra</button>
      </form>
      <div>
        <h3>Canjear premio</h3>
        ${c.redeemVerification === 'otp' ? `<p class="small">Este programa pide confirmar al titular con un código antes de canjear.</p>
          <div class="row" style="margin-bottom:10px"><button class="btn btn-secondary btn-sm" type="button" id="sendCode">Enviar código al cliente</button>
          <label class="sr-only" for="vcode">Código del cliente</label><input id="vcode" inputmode="numeric" maxlength="6" placeholder="Código" style="width:130px;min-height:36px;padding:6px 10px"></div><div id="codeMsg"></div>` : ''}
        <div class="reward-list">${current.rewards.map((r) => {
          const why = !r.available ? 'Agotado' : !r.affordable ? `Faltan ${r.cost - c.balance}` : '';
          return `<div class="reward"><span>${esc(r.name)}<br><span class="small muted">${r.cost} ${u(r.cost)}${r.stock != null ? ` · quedan ${r.stock}` : ''}</span></span>
            <button class="btn ${why ? 'btn-secondary' : 'btn-primary'} btn-sm" type="button" data-redeem="${esc(r.id)}" data-name="${esc(r.name)}" data-cost="${r.cost}" ${why || inactive || !inBranch ? 'disabled' : ''}>${why || 'Canjear'}</button></div>`;
        }).join('') || '<p class="muted">Sin premios activos.</p>'}</div>
        <p class="small muted">El servidor vuelve a revisar saldo y existencias al confirmar. Sin conexión no se canjea.</p>
      </div>
      <details><summary><b>Últimos movimientos</b></summary>
        <div class="table-wrap" style="margin-top:8px"><table><tbody>${current.movements.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(KIND_LABEL[m.kind] ?? m.kind)}${m.branch_name ? `<br><span class="small muted">${esc(m.branch_name)}</span>` : ''}</td><td class="num ${m.points > 0 ? 'pos' : 'neg'}">${m.points > 0 ? '+' : ''}${m.points}</td><td class="num">${m.balance_after}</td></tr>`).join('') || '<tr><td>Sin movimientos.</td></tr>'}</tbody></table></div>
      </details>
    </div>`;
  $('#refresh').addEventListener('click', () => lookup(c.code));
  $('#buy').addEventListener('submit', (e) => { e.preventDefault(); startPurchase(); });
  $$('[data-redeem]').forEach((b) => b.addEventListener('click', () => startRedeem(b.dataset.redeem, b.dataset.name, Number(b.dataset.cost))));
  $('#sendCode')?.addEventListener('click', sendCode);
}

async function sendCode() {
  showStatus($('#codeMsg'), 'pend', 'Enviando código…');
  try {
    const r = await api(`/api/staff/cards/${encodeURIComponent(current.card.code)}/send-code`, { method: 'POST', body: { purpose: 'redeem' } });
    showStatus($('#codeMsg'), 'warn', 'Código enviado (simulado)', r.message, ' <a href="/buzon-demo" target="_blank">Abrir buzón</a>');
  } catch (e) {
    showStatus($('#codeMsg'), 'err', e.message);
  }
}

// ---------- operaciones con clave única (idempotencia) ----------
function savePending(op) {
  pendingOp = op;
  try { op ? sessionStorage.setItem(PENDING_KEY, JSON.stringify(op)) : sessionStorage.removeItem(PENDING_KEY); } catch {}
}
function restorePending() {
  try {
    const op = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    if (op) {
      pendingOp = op;
      $('#findMsg').innerHTML = statusHtml('pend', 'Hay una operación con resultado incierto', `Clave ${op.key}. Consulta su estado antes de repetirla.`, `<div class="row"><button class="btn btn-secondary btn-sm" type="button" id="chkPending">Consultar estado</button></div>`);
      $('#chkPending').addEventListener('click', () => checkStatus(op, $('#findMsg')));
    }
  } catch {}
}

function startPurchase() {
  const ticket = $('#ticket').value.trim();
  if (!ticket) return showStatus($('#op'), 'err', 'Escribe la referencia del ticket o nota de venta.', 'Sin referencia no se puede evitar que una compra se registre dos veces.');
  const body = { cardCode: current.card.code, branchId: branchId(), ticketRef: ticket, amount: $('#amount').value || null, idempotencyKey: newKey() };
  send({ type: 'purchase', key: body.idempotencyKey, body });
}

async function startRedeem(rewardId, name, cost) {
  const ok = await confirmDialog({ title: `¿Canjear ${name}?`, body: `Se descontarán ${cost} ${unit(current.card.kind, cost)} de la tarjeta ${current.card.code}. Entrega el premio y márcalo como entregado.`, confirmText: 'Canjear' });
  if (!ok) return;
  const body = { cardCode: current.card.code, branchId: branchId(), rewardId, idempotencyKey: newKey() };
  const v = $('#vcode')?.value.trim();
  if (v) body.verificationCode = v;
  send({ type: 'redeem', key: body.idempotencyKey, body });
}

async function send(op) {
  savePending(op);
  const box = $('#op');
  showStatus(box, 'pend', op.type === 'purchase' ? 'Registrando compra…' : 'Registrando canje…', `Clave de operación ${op.key}. No cierres esta pantalla.`);
  $$('#cardPanel button').forEach((b) => (b.disabled = true));
  try {
    const r = await api(op.type === 'purchase' ? '/api/staff/purchases' : '/api/staff/redemptions', { method: 'POST', body: op.body });
    savePending(null);
    current.card.balance = r.balance;
    const title = r.status === 'already_confirmed' ? 'Ya estaba registrada' : op.type === 'purchase' ? 'Compra confirmada' : 'Canje confirmado';
    const extra = op.type === 'redeem' && r.status === 'confirmed' ? `<div class="row"><button class="btn btn-primary btn-sm" type="button" id="deliver" data-id="${esc(r.redemption.id)}">Marcar premio como entregado</button></div>` : '';
    await lookup(current.card.code);
    showStatus($('#op'), 'ok', title, `${r.message} Saldo actual: ${r.balance}.`, extra);
    $('#deliver')?.addEventListener('click', (e) => deliver(e.target.dataset.id));
  } catch (e) {
    if (e.code === 'NO_RESPONSE' || e.status >= 500) {
      // Resultado incierto: NO se genera otra clave. Primero se consulta.
      showStatus(box, 'warn', 'No sabemos si se guardó', 'No repitas la operación con otra clave. Consulta su estado; si no existe, reintenta con la misma clave.',
        `<div class="row"><button class="btn btn-primary btn-sm" type="button" id="chk">Consultar estado</button><button class="btn btn-secondary btn-sm" type="button" id="retry">Reintentar (misma clave)</button></div>`);
      $('#chk').addEventListener('click', () => checkStatus(op, box));
      $('#retry').addEventListener('click', () => send(op));
      return;
    }
    if (e.code === 'POSSIBLE_DUPLICATE') {
      renderCard();
      const ok = await confirmDialog({ title: '¿Es otra compra?', body: e.message, confirmText: 'Sí, es otra compra', cancelText: 'No, cancelar' });
      if (ok) return send({ ...op, body: { ...op.body, confirmPossibleDuplicate: true } });
      savePending(null);
      return showStatus($('#op'), 'warn', 'Compra no registrada', 'Se canceló para evitar un duplicado.');
    }
    savePending(null);
    renderCard(statusHtml('err', e.code === 'DUPLICATE_TICKET' ? 'Ticket ya registrado' : e.code === 'INSUFFICIENT_BALANCE' ? 'Saldo insuficiente' : 'No se registró', e.message));
    if (e.code === 'VERIFICATION_REQUIRED') $('#sendCode')?.focus();
  }
}

async function checkStatus(op, box) {
  showStatus(box, 'pend', 'Consultando…');
  try {
    const r = await api(`/api/staff/operations/${encodeURIComponent(op.key)}`);
    if (r.found) {
      savePending(null);
      showStatus(box, 'ok', 'La operación sí se guardó', `${r.type === 'purchase' ? `Compra ticket ${r.ticketRef}, +${r.points}` : `Canje ${r.reward}, −${r.cost}`}. Saldo actual: ${r.balance}. No la repitas.`);
      if (current?.card.code === r.cardCode) lookup(r.cardCode).then(() => showStatus($('#op'), 'ok', 'La operación sí se guardó', `Saldo actual: ${r.balance}. No la repitas.`));
    } else {
      showStatus(box, 'warn', 'No se guardó', r.message, `<div class="row"><button class="btn btn-primary btn-sm" type="button" id="retry2">Reintentar con la misma clave</button><button class="btn btn-secondary btn-sm" type="button" id="drop">Descartar</button></div>`);
      $('#retry2').addEventListener('click', () => { if (current) send(op); else showStatus(box, 'err', 'Abre primero la tarjeta del cliente.'); });
      $('#drop').addEventListener('click', () => { savePending(null); box.innerHTML = ''; });
    }
  } catch (e) {
    showStatus(box, 'err', 'Sigue sin respuesta', 'Espera unos minutos y vuelve a consultar. Mientras tanto usa la hoja de contingencia y no canjees.',
      `<div class="row"><button class="btn btn-secondary btn-sm" type="button" id="chk2">Consultar otra vez</button></div>`);
    $('#chk2').addEventListener('click', () => checkStatus(op, box));
  }
}

async function deliver(id, box = $('#op')) {
  try {
    const r = await api(`/api/staff/redemptions/${id}/deliver`, { method: 'POST', body: {} });
    showStatus(box, 'ok', 'Entregado', r.message);
    if ($('#t-turno').hidden === false) loadShift();
  } catch (e) {
    showStatus(box, 'err', e.message);
  }
}

// ---------- cámara ----------
let stream = null;
let scanning = false;
$('#scan').addEventListener('click', async () => {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return showStatus($('#findMsg'), 'warn', 'La cámara no está disponible aquí', 'El navegador solo permite la cámara en conexiones seguras (https). Escribe el número de la tarjeta.');
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    return showStatus($('#findMsg'), 'warn', 'No se pudo abrir la cámara', 'Revisa el permiso del navegador o escribe el número de la tarjeta.');
  }
  const video = $('#video');
  video.srcObject = stream;
  await video.play();
  $('#camera').hidden = false;
  scanning = true;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (found?.data) {
        const m = found.data.match(/\/c\/(C-[A-Z0-9]+)/i) || found.data.match(/^(C-[A-Z0-9]+)$/i);
        if (m) { stopScan(); lookup(m[1]); return; }
        if (/\/r\//.test(found.data)) $('#scanMsg').textContent = 'Ese es el QR del mostrador (registro). Escanea el QR de la tarjeta del cliente.';
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
function stopScan() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('#camera').hidden = true;
}
$('#stopScan').addEventListener('click', stopScan);

// ---------- turno ----------
async function loadShift() {
  $('#shift').innerHTML = '<div class="skeleton" style="height:200px"></div>';
  try {
    const s = await api(`/api/staff/shift?branchId=${branchId()}`);
    $('#shift').innerHTML = `
      <p class="muted">Antes de completar algo pendiente, revisa aquí su estado y quién lo inició. No repitas compras ni premios.</p>
      <h2>Canjes sin entregar o en revisión</h2>
      ${s.pendingDeliveries.length ? `<div class="table-wrap"><table><thead><tr><th>Hora</th><th>Tarjeta</th><th>Premio</th><th>Registró</th><th>Estado</th><th></th></tr></thead><tbody>${s.pendingDeliveries.map((r) => `
        <tr><td>${fmtDateTime(r.created_at)}</td><td class="mono">${esc(r.code)}</td><td>${esc(r.reward_name)} (−${r.cost})</td><td>${esc(r.actor)}</td>
        <td>${r.status === 'disputed' ? '<span class="tag tag-bad">En revisión</span>' : '<span class="tag tag-pend">Sin entregar</span>'}</td>
        <td>${r.status === 'confirmed' ? `<button class="btn btn-secondary btn-sm" data-deliver="${esc(r.id)}" type="button">Marcar entregado</button>` : ''}</td></tr>`).join('')}</tbody></table></div><div id="shiftMsg" style="margin-top:8px"></div>` : '<p class="muted">Nada pendiente.</p>'}
      <h2 style="margin-top:24px">Compras de las últimas 12 horas</h2>
      ${s.purchases.length ? `<div class="table-wrap"><table><thead><tr><th>Hora</th><th>Ticket</th><th>Tarjeta</th><th class="num">Puntos</th><th>Registró</th><th>Origen</th></tr></thead><tbody>${s.purchases.map((p) => `
        <tr><td>${fmtDateTime(p.created_at)}</td><td>${esc(p.ticket_ref)}</td><td class="mono">${esc(p.code)}</td><td class="num">+${p.points}</td><td>${esc(p.actor)}</td><td>${p.source === 'contingency' ? 'Contingencia' : 'Mostrador'}${p.status === 'refunded' ? ' <span class="tag tag-bad">Devuelta</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin compras en este turno.</p>'}
      <h2 style="margin-top:24px">Comprobantes de contingencia por revisar</h2>
      ${s.contingency.length ? `<ul>${s.contingency.map((c) => `<li>${esc(c.ticket_ref)} · ${esc(c.card_code)} · ${fmtDateTime(c.occurred_at)}</li>`).join('')}</ul>` : '<p class="muted">Ninguno.</p>'}`;
    $$('[data-deliver]').forEach((b) => b.addEventListener('click', () => deliver(b.dataset.deliver, $('#shiftMsg')).then(loadShift)));
  } catch (e) {
    $('#shift').innerHTML = statusHtml('err', 'No se pudo cargar el turno', e.message);
  }
}

// ---------- contingencia ----------
function addContRow() {
  const i = $$('#contRows .cont-row').length;
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('#contRows').insertAdjacentHTML('beforeend', `<fieldset class="cont-row"><legend>Comprobante ${i + 1}</legend>
    <div class="row"><div style="flex:1;min-width:120px"><label>Tarjeta</label><input name="card" class="code-input" placeholder="C-XXXXXX"></div>
    <div style="flex:1;min-width:120px"><label>Ticket</label><input name="ticket"></div></div>
    <div class="row" style="margin-top:8px"><div style="width:140px"><label>Importe</label><input name="amount" inputmode="decimal"></div>
    <div style="flex:1;min-width:190px"><label>Fecha y hora</label><input name="at" type="datetime-local" value="${now}"></div></div></fieldset>`);
}
$('#addRow').addEventListener('click', addContRow);
$('#contForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const records = $$('#contRows .cont-row').map((f) => ({
    cardCode: $('[name=card]', f).value.trim(), ticketRef: $('[name=ticket]', f).value.trim(), amount: $('[name=amount]', f).value || null,
    occurredAt: $('[name=at]', f).value ? new Date($('[name=at]', f).value).toISOString() : '',
  })).filter((r) => r.cardCode || r.ticketRef);
  if (!records.length) return showStatus($('#contMsg'), 'err', 'Captura al menos un comprobante.');
  showStatus($('#contMsg'), 'pend', 'Enviando…');
  try {
    const r = await api('/api/staff/contingency', { method: 'POST', body: { branchId: branchId(), records } });
    $('#contMsg').innerHTML = `<div class="status status-ok"><b>Enviado a revisión del encargado</b><span>Los puntos se suman hasta que se apliquen.</span></div>
      <ul>${r.results.map((x) => `<li><b>${esc(x.ticketRef)}</b>: ${x.status === 'pending' ? 'pendiente' : x.status === 'duplicate' ? 'duplicado, no se agregó' : 'error'} — ${esc(x.message)}</li>`).join('')}</ul>`;
    $('#contRows').innerHTML = '';
    addContRow();
  } catch (err) {
    showStatus($('#contMsg'), 'err', err.message);
  }
});
$('#printSheet').addEventListener('click', () => {
  const b = me.branches.find((x) => x.id === branchId());
  $('#sheet').hidden = false;
  $('#sheet').innerHTML = `<h2>Hoja de contingencia — ${esc(me.company.name)}, ${esc(b?.name ?? '')}</h2>
    <p>Usar solo cuando no hay conexión. No se confirman canjes. Cada renglón queda pendiente de validar.</p>
    <table><thead><tr><th>Hora</th><th>Número de tarjeta</th><th>Ticket</th><th>Importe</th><th>Empleado</th></tr></thead><tbody>${'<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>'.repeat(14)}</tbody></table>`;
  setTimeout(() => print(), 50);
});

// ---------- tarjeta impresa ----------
$('#issue').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'Emitir tarjeta impresa', body: 'Confirma que avisaste al cliente: sin contacto registrado la tarjeta funciona al portador y no se puede reponer.', confirmText: 'Emitir' });
  if (!ok) return;
  showStatus($('#issueMsg'), 'pend', 'Creando…');
  try {
    const r = await api('/api/staff/printed-cards', { method: 'POST', body: { branchId: branchId() } });
    showStatus($('#issueMsg'), 'ok', `Tarjeta ${r.code} creada`, r.message, `<div class="row"><a class="btn btn-primary btn-sm" href="/imprimir/tarjeta/${esc(r.code)}" target="_blank">Imprimir tarjeta</a><button class="btn btn-secondary btn-sm" type="button" id="useNew">Abrir en mostrador</button></div>`);
    $('#useNew').addEventListener('click', () => { $('#tb-mostrador').click(); lookup(r.code); });
  } catch (e) {
    showStatus($('#issueMsg'), 'err', e.message);
  }
});

init();
