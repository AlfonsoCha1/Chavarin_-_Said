import { mountChrome, api, esc, $, $$, loadingRows, errorBlock } from '../app.js';
mountChrome();

const state = { q: '', city: '', category: '', categoryName: '' };
const params = new URLSearchParams(location.search);
state.q = params.get('q') ?? '';
state.city = params.get('ciudad') ?? '';
state.category = params.get('categoria') ?? '';
$('#q').value = state.q;

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function highlight(text, q) {
  const safe = esc(text);
  const terms = fold(q).split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return safe;
  // Resalta coincidencias sin acentos sobre el texto original.
  const plain = fold(text);
  const marks = new Array(text.length).fill(false);
  for (const t of terms) {
    let i = plain.indexOf(t);
    while (i >= 0) { for (let k = i; k < i + t.length; k++) marks[k] = true; i = plain.indexOf(t, i + t.length); }
  }
  let out = '';
  let open = false;
  [...text].forEach((ch, i) => {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += esc(ch);
  });
  return out + (open ? '</mark>' : '');
}

function treeHtml(nodes, depth = 0) {
  return nodes.map((n) => {
    const hasKids = n.children?.length;
    const id = `cat-${n.slug}`;
    // En computadora las categorías principales arrancan abiertas; en celular solo la rama elegida.
    const wide = matchMedia('(min-width: 900px)').matches;
    const expanded = (depth === 0 && wide) || containsSlug(n, state.category);
    return `<li class="${depth === 0 ? 'cat-root' : ''}">
      <div class="cat-row">
        ${hasKids ? `<button type="button" class="cat-toggle" aria-expanded="${expanded}" aria-controls="${id}" aria-label="${expanded ? 'Contraer' : 'Expandir'} ${esc(n.name)}"><span class="chev" aria-hidden="true">›</span></button>` : '<span class="cat-spacer"></span>'}
        <button type="button" class="cat-link" data-slug="${esc(n.slug)}" data-name="${esc(n.name)}" aria-pressed="${state.category === n.slug}"><span>${esc(n.name)}</span><span class="n">${n.count}</span></button>
      </div>
      ${hasKids ? `<ul id="${id}" data-collapsed="${!expanded}" ${expanded ? '' : 'hidden'}>${treeHtml(n.children, depth + 1)}</ul>` : ''}
    </li>`;
  }).join('');
}
function containsSlug(n, slug) {
  if (!slug) return false;
  if (n.slug === slug) return true;
  return (n.children ?? []).some((c) => containsSlug(c, slug));
}
function findName(nodes, slug) {
  for (const n of nodes) {
    if (n.slug === slug) return n.name;
    const r = findName(n.children ?? [], slug);
    if (r) return r;
  }
  return '';
}

let tree = [];
async function loadTree() {
  try {
    const [{ categories }, { cities }] = await Promise.all([api('/api/public/categories'), api('/api/public/cities')]);
    tree = categories;
    state.categoryName = findName(tree, state.category);
    $('#tree').innerHTML = `<li><div class="cat-row"><span class="cat-spacer"></span><button type="button" class="cat-link" data-slug="" aria-pressed="${!state.category}"><span>Todas las categorías</span></button></div></li>${treeHtml(tree)}`;
    $('#city').innerHTML = '<option value="">Todas las ciudades</option>' + cities.map((c) => `<option ${c === state.city ? 'selected' : ''}>${esc(c)}</option>`).join('');
  } catch (e) {
    $('#tree').innerHTML = `<li>${errorBlock(e)}</li>`;
  }
}

$('#tree').addEventListener('click', (e) => {
  const tog = e.target.closest('.cat-toggle');
  if (tog) {
    const ul = document.getElementById(tog.getAttribute('aria-controls'));
    const open = tog.getAttribute('aria-expanded') === 'true';
    tog.setAttribute('aria-expanded', String(!open));
    ul.hidden = open;
    ul.dataset.collapsed = String(open);
    return;
  }
  const link = e.target.closest('.cat-link');
  if (link) {
    state.category = link.dataset.slug;
    state.categoryName = link.dataset.name ?? '';
    $$('.cat-link').forEach((b) => b.setAttribute('aria-pressed', String(b === link)));
    // Al elegir una categoría con subcategorías, se despliegan.
    const li = link.closest('li');
    const tg = li.querySelector(':scope > .cat-row .cat-toggle');
    if (tg && tg.getAttribute('aria-expanded') === 'false') tg.click();
    search();
  }
});

$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  state.q = $('#q').value.trim();
  state.city = $('#city').value;
  search();
});
$('#city').addEventListener('change', () => { state.city = $('#city').value; search(); });
$('#clear').addEventListener('click', () => {
  Object.assign(state, { q: '', city: '', category: '', categoryName: '' });
  $('#q').value = '';
  $('#city').value = '';
  $$('.cat-link').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.slug === '')));
  search();
});

let seq = 0;
async function search() {
  const my = ++seq;
  const qs = new URLSearchParams();
  if (state.q) qs.set('q', state.q);
  if (state.city) qs.set('ciudad', state.city);
  if (state.category) qs.set('categoria', state.category);
  history.replaceState(null, '', `/directorio${qs.toString() ? '?' + qs : ''}`);
  $('#clear').hidden = !(state.q || state.city || state.category);
  $('#results').innerHTML = loadingRows(4);
  $('#summary').textContent = 'Buscando…';
  try {
    const p = new URLSearchParams({ q: state.q, city: state.city, category: state.category });
    const { results } = await api(`/api/public/directory?${p}`);
    if (my !== seq) return;
    const filters = [state.categoryName, state.city, state.q && `“${state.q}”`].filter(Boolean).join(', ');
    $('#summary').textContent = `${results.length} ${results.length === 1 ? 'sucursal' : 'sucursales'}${filters ? ' · ' + filters : ''}`;
    if (!results.length) {
      $('#results').innerHTML = `<div class="panel empty"><p><b>No hay negocios participantes con esa búsqueda.</b></p><p>Prueba con otra palabra, otra ciudad o quita los filtros.</p><button class="btn btn-secondary" type="button" id="clear2">Quitar filtros</button></div>`;
      $('#clear2').addEventListener('click', () => $('#clear').click());
      return;
    }
    $('#results').innerHTML = results.map((r) => `
      <article class="result" style="--card:${esc(r.card_color)}">
        <span class="swatch" aria-hidden="true"></span>
        <div>
          <h3>${highlight(r.company, state.q)}</h3>
          <div class="meta">${esc(r.parent_category ? r.parent_category + ' › ' : '')}${esc(r.category)} · ${highlight(r.branch, state.q)}</div>
          <div class="addr">${highlight([r.street, r.neighborhood].filter(Boolean).join(', '), state.q)}, ${highlight(r.city, state.q)}</div>
          <div class="small muted">${r.program ? `${esc(r.program)} · ${r.kind === 'stamps' ? 'sellos' : 'puntos'}` : 'Sin programa activo'}</div>
        </div>
        <div class="result-actions">
          <a class="btn btn-primary btn-sm" href="/s/${esc(r.code)}">Ver negocio</a>
        </div>
      </article>`).join('');
  } catch (e) {
    if (my !== seq) return;
    $('#summary').textContent = '';
    $('#results').innerHTML = errorBlock(e, 'retry');
    $('#retry').addEventListener('click', search);
  }
}

loadTree().then(search);
