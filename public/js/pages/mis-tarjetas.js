import { mountChrome, api, esc, $, $$, showStatus, cardHtml, fmtDate, fmtDateTime, unit, KIND_LABEL, fmtMoney, errorBlock, loadingRows } from '../app.js';
mountChrome();

let contactType = 'phone';
function syncChannel() {
  const ch = $('input[name="channel"]:checked').value;
  contactType = ch === 'email' ? 'email' : 'phone';
  const inp = $('#contact');
  $('#contactLabel').textContent = contactType === 'email' ? 'Correo' : 'Celular (10 dígitos)';
  inp.type = contactType === 'email' ? 'email' : 'tel';
  inp.inputMode = contactType === 'email' ? 'email' : 'numeric';
  inp.autocomplete = contactType === 'email' ? 'email' : 'tel-national';
}
$$('input[name="channel"]').forEach((r) => r.addEventListener('change', syncChannel));

$('#lform').addEventListener('submit', async (e) => {
  e.preventDefault();
  const contact = $('#contact').value.trim();
  if (!contact) return showStatus($('#lmsg'), 'err', 'Escribe tu contacto.');
  showStatus($('#lmsg'), 'pend', 'Enviando…');
  try {
    const r = await api('/api/customer/login/start', { method: 'POST', body: { contactType, contact, channel: $('input[name="channel"]:checked').value } });
    $('#lmsg').innerHTML = '';
    $('#cform').hidden = false;
    $('#lsent').textContent = `${r.message} (${r.to})`;
    if (r.simulated) $('#lsim').innerHTML = `<p class="sim"><strong>Simulación:</strong> revisa el <a href="/buzon-demo" target="_blank">buzón simulado</a> para ver el código.</p>`;
    $('#lcode').focus();
  } catch (err) {
    showStatus($('#lmsg'), 'err', err.message);
  }
});

$('#cform').addEventListener('submit', async (e) => {
  e.preventDefault();
  showStatus($('#cmsg'), 'pend', 'Verificando…');
  try {
    await api('/api/customer/login/verify', { method: 'POST', body: { contactType, contact: $('#contact').value.trim(), code: $('#lcode').value.replace(/\D/g, '') } });
    location.reload();
  } catch (err) {
    showStatus($('#cmsg'), 'err', err.message);
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/customer/logout', { method: 'POST', body: {} }).catch(() => {});
  location.reload();
});

let me = null;
async function load() {
  try {
    me = await api('/api/customer/me');
  } catch (e) {
    if (e.status === 401) { $('#login').hidden = false; syncChannel(); return; }
    $('#login').hidden = false;
    $('#login').insertAdjacentHTML('afterbegin', errorBlock(e));
    return;
  }
  $('#app').hidden = false;
  $('#cards').innerHTML = loadingRows(2);
  try {
    const { cards } = await api('/api/customer/cards');
    if (!cards.length) {
      $('#cards').innerHTML = `<div class="panel empty"><p><b>Aún no tienes tarjetas.</b></p><p>Escanea el QR del mostrador de un negocio participante o búscalo en el directorio.</p><a class="btn btn-primary" href="/directorio">Ir al directorio</a></div>`;
      return;
    }
    $('#cards').innerHTML = cards.map((c, i) => `
      <article class="panel" style="margin-bottom:18px" id="card-${esc(c.code)}">
        <div class="grid-2">
          <div>${cardHtml({ company: c.company, program: c.program, balance: c.balance, kind: c.kind, code: c.code, color: c.cardColor, rewards: c.rewards, qrSrc: `/api/customer/cards/${c.code}/qr.svg`, onSurface: true })}
            <p class="small muted" style="margin-top:10px">Muestra el QR o di tu número <b class="mono">${esc(c.code)}</b>. Mostrarlo no suma puntos: el personal debe confirmar tu compra. El saldo que ves viene del servidor.</p>
          </div>
          <div>
            <h2 style="margin-bottom:4px">${esc(c.company)}</h2>
            <p class="muted">${esc(c.program)} · tarjeta ${c.transferable ? 'transferible' : 'personal'} ${c.format === 'printed' ? '(impresa)' : '(web)'}</p>
            <p><b>Cada compra elegible suma ${c.rules.pointsPerPurchase} ${unit(c.kind, c.rules.pointsPerPurchase)}.</b> ${esc(c.rules.eligible)}${c.rules.minPurchaseCents ? ' Mínimo ' + fmtMoney(c.rules.minPurchaseCents) + '.' : ''}</p>
            <div class="reward-list">${c.rewards.map((r) => `<div class="reward"><span>${esc(r.name)}${r.available ? '' : ' <span class="tag tag-bad">Agotado</span>'}</span><span class="cost">${r.cost} ${unit(c.kind, r.cost)}</span></div>`).join('')}</div>
            <p class="small" style="margin-top:10px">${c.expiresAt ? `Tu saldo vence el <b>${fmtDate(c.expiresAt)}</b> si no registras compras antes.` : c.rules.expirationDays ? `Vence tras ${c.rules.expirationDays} días sin compras.` : 'Este programa no tiene vencimiento.'}
              Vale en: ${c.branches.map((b) => esc(b.name)).join(', ')}.</p>
            <div class="row">
              <button class="btn btn-sim btn-sm" type="button" data-wallet="${esc(c.code)}">Añadir a Google Wallet (simulación)</button>
              <button class="btn btn-secondary btn-sm" type="button" disabled title="Fase posterior">Apple Wallet: fase posterior</button>
            </div>
            ${c.wallet.length ? `<p class="sim small" style="margin-top:8px"><strong>Pase simulado:</strong> registrado. Saldo mostrado en el pase: ${c.wallet[0].displayed_balance ?? 'pendiente de actualizar'}. Si difiere, vale el saldo del servidor (${c.balance}).</p>` : ''}
            <div id="wmsg-${esc(c.code)}"></div>
            <details style="margin-top:14px"><summary><b>Movimientos</b></summary><div data-mov="${esc(c.code)}" style="margin-top:10px">${loadingRows(1)}</div></details>
            <details style="margin-top:10px"><summary><b>Promociones de este negocio</b></summary>
              <div style="margin-top:10px"><label class="check"><input type="checkbox" data-mkt="${esc(c.companyId)}" ${me.consents.find((x) => x.company_id === c.companyId)?.granted ? 'checked' : ''}><span>Acepto recibir promociones de ${esc(c.company)}. No afecta mi tarjeta.</span></label><div data-mktmsg="${esc(c.companyId)}"></div></div>
            </details>
          </div>
        </div>
      </article>`).join('') + privacyBlock();

    $$('details').forEach((d) => d.addEventListener('toggle', () => {
      const box = d.querySelector('[data-mov]');
      if (d.open && box && !box.dataset.loaded) loadMovements(box);
    }));
    $$('[data-wallet]').forEach((b) => b.addEventListener('click', async () => {
      const code = b.dataset.wallet;
      showStatus($(`#wmsg-${CSS.escape(code)}`), 'pend', 'Registrando pase simulado…');
      try {
        const r = await api(`/api/customer/cards/${code}/wallet`, { method: 'POST', body: { provider: 'google' } });
        showStatus($(`#wmsg-${CSS.escape(code)}`), 'warn', 'Simulación', r.message);
      } catch (e) {
        showStatus($(`#wmsg-${CSS.escape(code)}`), 'err', e.message);
      }
    }));
    $$('[data-mkt]').forEach((cb) => cb.addEventListener('change', async () => {
      const box = $(`[data-mktmsg="${cb.dataset.mkt}"]`);
      try {
        const r = await api('/api/customer/marketing', { method: 'POST', body: { companyId: cb.dataset.mkt, granted: cb.checked } });
        showStatus(box, 'ok', r.message);
      } catch (e) {
        cb.checked = !cb.checked;
        showStatus(box, 'err', e.message);
      }
    }));
    $('#pform')?.addEventListener('submit', sendPrivacy);
  } catch (e) {
    $('#cards').innerHTML = errorBlock(e);
  }
}

async function loadMovements(box) {
  box.dataset.loaded = '1';
  try {
    const { movements } = await api(`/api/customer/cards/${box.dataset.mov}/movements`);
    box.innerHTML = movements.length
      ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th class="num">Cambio</th><th class="num">Saldo</th></tr></thead><tbody>${movements.map((m) => `
        <tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(KIND_LABEL[m.kind] ?? m.kind)}${m.reward_name ? ': ' + esc(m.reward_name) : ''}${m.ticket_ref ? ` <span class="muted">(${esc(m.ticket_ref)})</span>` : ''}${m.branch ? `<br><span class="small muted">${esc(m.branch)}</span>` : ''}${m.reason ? `<br><span class="small muted">${esc(m.reason)}</span>` : ''}</td>
        <td class="num ${m.points > 0 ? 'pos' : 'neg'}">${m.points > 0 ? '+' : ''}${m.points}</td><td class="num">${m.balance_after}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Sin movimientos todavía.</p>';
  } catch (e) {
    box.innerHTML = errorBlock(e);
    box.dataset.loaded = '';
  }
}

function privacyBlock() {
  return `<section class="panel" style="margin-top:18px"><h2>Tus datos</h2>
    <p>Registrado: ${esc(me.customer.name ?? '')} · ${esc(me.customer.email ?? me.customer.phone ?? '')}. Solo guardamos lo necesario para tu tarjeta y su recuperación.</p>
    <form id="pform" class="row" style="align-items:flex-end">
      <div style="flex:1;min-width:220px"><label for="pkind">Solicitud sobre tus datos</label>
        <select id="pkind"><option value="acceso">Ver qué datos tienen de mí</option><option value="rectificacion">Corregir mis datos</option><option value="cancelacion">Borrar mis datos</option><option value="oposicion">Oponerme a un uso</option><option value="baja_publicidad">Dejar de recibir publicidad de todos</option></select></div>
      <button class="btn btn-secondary" type="submit">Enviar solicitud</button>
    </form><div id="pmsg" style="margin-top:10px"></div>
    <p class="small muted">Las solicitudes se atienden según el <a href="/privacidad">aviso de privacidad</a> (borrador sujeto a revisión legal).</p></section>`;
}

async function sendPrivacy(e) {
  e.preventDefault();
  try {
    const r = await api('/api/customer/privacy-requests', { method: 'POST', body: { kind: $('#pkind').value } });
    showStatus($('#pmsg'), 'ok', `Folio ${r.id.slice(0, 8)}`, r.message);
  } catch (err) {
    showStatus($('#pmsg'), 'err', err.message);
  }
}

load();
