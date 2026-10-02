import { mountChrome, api, esc, $, $$, showStatus, formData } from '../app.js';
mountChrome();
api('/api/public/categories').then(({ categories }) => {
  const opts = [];
  const walk = (ns, path) => ns.forEach((n) => (n.children.length ? walk(n.children, [...path, n.name]) : opts.push(`<option value="${n.id}">${esc([...path, n.name].join(' › '))}</option>`)));
  walk(categories, []);
  $('#categoryId').innerHTML = '<option value="">Elige una subcategoría</option>' + opts.join('');
}).catch(() => { $('#categoryId').innerHTML = '<option value="">No se pudieron cargar las categorías</option>'; });

$$('input[name="programKind"]').forEach((r) => r.addEventListener('change', () => {
  const stamps = $('input[name="programKind"]:checked').value === 'stamps';
  $('#pplabel').textContent = stamps ? 'Sellos por compra' : 'Puntos por compra';
  $('#pointsPerPurchase').value = stamps ? 1 : 10;
  $('#rewardCost').value = stamps ? 8 : 50;
}));

$('#geo').addEventListener('click', () => {
  if (!navigator.geolocation) return showStatus($('#geomsg'), 'warn', 'Este navegador no ofrece ubicación. Escríbela a mano o déjala vacía.');
  navigator.geolocation.getCurrentPosition(
    (p) => { $('#lat').value = p.coords.latitude.toFixed(6); $('#lng').value = p.coords.longitude.toFixed(6); showStatus($('#geomsg'), 'ok', 'Ubicación agregada.'); },
    () => showStatus($('#geomsg'), 'warn', 'No se usó la ubicación. Puedes escribirla o dejarla vacía.'),
  );
});

$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = formData(e.target);
  const body = { ...d, lat: d.lat || null, lng: d.lng || null, expirationDays: d.expirationDays || null };
  showStatus($('#msg'), 'pend', 'Enviando solicitud…');
  try {
    const r = await api('/api/public/business-applications', { method: 'POST', body });
    $('#f').hidden = true;
    $('#done').hidden = false;
    $('#done').innerHTML = `<div class="status status-ok"><b>Solicitud recibida</b><span>${esc(r.message)}</span></div>
      <div class="row" style="margin-top:16px"><a class="btn btn-primary" href="/entrar">Entrar al panel del dueño</a><a class="btn btn-secondary" href="/">Volver al inicio</a></div>`;
    scrollTo({ top: 0 });
  } catch (err) {
    showStatus($('#msg'), 'err', 'Revisa los datos', err.message);
  }
});
