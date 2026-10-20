'use strict';

// ---------- Estado y utilidades ----------
const state = { me: null, meta: null, options: null, autofill: null };
const $app = document.getElementById('app');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'registro-app' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (res.status === 401 && path !== '/api/login') {
    state.me = null;
    renderLogin();
    throw new Error(data?.error || 'Sesión expirada');
  }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const isAdmin = () => state.me?.role === 'admin';
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)}-${MESES[Number(m) - 1]}-${y.slice(2)}`;
}
function fmtStamp(sqlUtc) {
  if (!sqlUtc) return '';
  const d = new Date(sqlUtc.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}
const fmtNum = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: 3 }));
// Campos vacíos de un registro (se puede guardar incompleto y completarlo después).
const emptyFields = (r) => (state.meta?.fields || []).filter((f) => r[f.key] == null || r[f.key] === '');

function confirmDialog(message, okText = 'Aceptar') {
  return new Promise((resolve) => {
    const close = (v) => { back.remove(); resolve(v); };
    const back = h('div', { class: 'modal-back', onclick: (e) => e.target === back && close(false) },
      h('div', { class: 'modal' },
        h('p', {}, message),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => close(true) }, okText),
          h('button', { class: 'btn', onclick: () => close(false) }, 'Cancelar'))));
    document.body.append(back);
  });
}

// ---------- Dropdown con búsqueda y botón + para agregar opciones ----------
let openCombo = null;
document.addEventListener('click', (e) => {
  if (openCombo && !openCombo.root.contains(e.target)) openCombo.close();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openCombo) openCombo.close(); });

function combo({ field, label, value = '', onChange }) {
  let current = value;
  const valEl = h('span', { class: 'val' });
  const btn = h('button', { type: 'button', class: 'combo-btn', 'aria-haspopup': 'listbox', 'aria-label': label });
  btn.append(valEl);
  const root = h('div', { class: 'combo' }, btn);
  const paint = () => {
    valEl.textContent = current || 'Seleccionar…';
    valEl.className = current ? 'val' : 'val ph';
  };
  paint();

  let panel, backdrop;
  const api_ = {
    root,
    get value() { return current; },
    set value(v) { current = v || ''; paint(); },
    close() {
      panel?.remove(); backdrop?.remove(); panel = backdrop = null;
      if (openCombo === api_) openCombo = null;
    },
  };

  function choose(v) {
    current = v; paint(); api_.close(); btn.focus();
    onChange?.(v);
  }

  function open() {
    if (openCombo) openCombo.close();
    openCombo = api_;
    const search = h('input', { class: 'input search', type: 'search', placeholder: 'Buscar…', autocomplete: 'off' });
    const list = h('div', { class: 'combo-list', role: 'listbox' });
    const addArea = h('div', { class: 'combo-add' });

    const renderList = () => {
      const q = search.value.trim().toLowerCase();
      const opts = (state.options[field] || []).filter((o) => o.value.toLowerCase().includes(q));
      list.replaceChildren(...(opts.length
        ? opts.map((o) => h('button', { type: 'button', class: 'combo-opt' + (o.value === current ? ' sel' : ''), role: 'option', onclick: () => choose(o.value) }, o.value))
        : [h('div', { class: 'combo-empty' }, q ? 'Sin coincidencias. Usa el + para agregarla.' : 'Todavía no hay opciones. Agrega una con el +.')]));
    };

    const showAddButton = () => {
      addArea.replaceChildren(h('button', { type: 'button', class: 'plus', onclick: showAddInput }, h('b', {}, '+'), 'Agregar otra opción'));
    };
    function showAddInput() {
      const inp = h('input', { class: 'input', placeholder: `Nueva opción para ${label.toLowerCase()}`, value: search.value.trim(), maxlength: 200 });
      const save = async () => {
        const v = inp.value.trim();
        if (!v) return inp.focus();
        try {
          const row = await api('/api/options', { method: 'POST', body: { field, value: v } });
          const listRef = state.options[field];
          if (!listRef.some((o) => o.id === row.id)) {
            listRef.push(row);
            listRef.sort((a, b) => a.value.localeCompare(b.value, 'es', { sensitivity: 'base' }));
          }
          toast(`Agregado: ${row.value}`);
          choose(row.value);
        } catch (err) { toast(err.message); }
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      addArea.replaceChildren(inp,
        h('button', { type: 'button', class: 'btn sm primary', onclick: save }, 'Agregar'),
        h('button', { type: 'button', class: 'btn sm', onclick: showAddButton }, '✕'));
      inp.focus();
    }

    search.addEventListener('input', renderList);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = list.querySelector('.combo-opt');
        if (first) first.click(); else showAddInput();
      }
    });
    renderList();
    showAddButton();
    backdrop = h('div', { class: 'combo-backdrop', onclick: () => api_.close() });
    panel = h('div', { class: 'combo-panel' }, search, list, addArea);
    root.append(backdrop, panel);
    // En celular no abrimos el teclado de inmediato para que se vea la lista completa.
    if (window.matchMedia('(min-width: 641px)').matches) search.focus();
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); panel ? api_.close() : open(); });
  root.addEventListener('click', (e) => e.stopPropagation());
  return api_;
}

// ---------- Estructura de la app ----------
function routes() {
  const r = [
    { hash: '#/nuevo', label: 'Nuevo registro' },
    { hash: '#/registros', label: isAdmin() ? 'Todos los registros' : 'Mis registros' },
  ];
  if (isAdmin()) {
    r.push({ hash: '#/empleados', label: 'Empleados' }, { hash: '#/catalogos', label: 'Opciones' }, { hash: '#/formato', label: 'Datos del formato' });
  }
  r.push({ hash: '#/cuenta', label: 'Mi cuenta' });
  return r;
}

function shell(content, wide = false) {
  const current = location.hash.split('?')[0] || '#/nuevo';
  const top = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'Registro de Aplicaciones'),
    h('div', { class: 'who' }, state.me.name, h('br'), h('span', { class: 'small' }, isAdmin() ? 'Admin' : 'Empleado')),
    h('button', { onclick: logout }, 'Salir'));
  const nav = h('nav', { class: 'nav' }, routes().map((r) =>
    h('a', { href: r.hash, class: current.startsWith(r.hash) ? 'active' : '' }, r.label)));
  const main = h('main', { class: wide ? 'wide' : '' }, content);
  $app.replaceChildren(top, nav, main);
  window.scrollTo(0, 0);
}

async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  state.me = null;
  renderLogin();
}

async function loadCommon() {
  const [meta, options, autofill] = await Promise.all([api('/api/meta'), api('/api/options'), api('/api/autofill')]);
  Object.assign(state, { meta, options, autofill });
}

async function router() {
  if (!state.me) return;
  if (state.me.mustChangePassword) return renderChangePassword(true);
  const [path, qs] = (location.hash || '#/nuevo').split('?');
  const params = new URLSearchParams(qs || '');
  try {
    if (path === '#/nuevo') return renderForm();
    const edit = path.match(/^#\/editar\/(\d+)$/);
    if (edit && isAdmin()) return renderForm(Number(edit[1]));
    if (path === '#/registros') return renderRecords(params);
    if (path === '#/imprimir') return renderPrint(params);
    if (path === '#/cuenta') return renderChangePassword(false);
    if (isAdmin() && path === '#/empleados') return renderUsers();
    if (isAdmin() && path === '#/catalogos') return renderCatalogs();
    if (isAdmin() && path === '#/formato') return renderSettings();
    location.hash = '#/nuevo';
  } catch (err) {
    shell(h('div', { class: 'error' }, err.message));
  }
}
window.addEventListener('hashchange', router);

// ---------- Inicio de sesión ----------
function renderLogin() {
  const err = h('div');
  const user = h('input', { class: 'input', autocomplete: 'username', autocapitalize: 'none', required: true });
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const form = h('form', { class: 'card' },
    err,
    h('div', { class: 'field' }, h('label', {}, 'Usuario'), user),
    h('div', { class: 'field', style: 'margin-top:12px' }, h('label', {}, 'Contraseña'), pass),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', style: 'width:100%' }, 'Entrar')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.replaceChildren();
    try {
      await api('/api/login', { method: 'POST', body: { username: user.value, password: pass.value } });
      await start();
    } catch (ex) { err.replaceChildren(h('div', { class: 'error' }, ex.message)); }
  });
  $app.replaceChildren(h('div', { class: 'login' },
    h('img', { class: 'logo', src: '/icon.svg', alt: '' }),
    h('h1', {}, 'Registro de Aplicaciones'),
    form));
  user.focus();
}

function renderChangePassword(forced) {
  const err = h('div');
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const rep = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const form = h('form', { class: 'card', style: 'max-width:460px' },
    forced ? h('p', {}, 'Por seguridad, cambia tu contraseña antes de continuar.') : null,
    err,
    h('div', { class: 'field' }, h('label', {}, 'Contraseña actual'), cur),
    h('div', { class: 'field', style: 'margin-top:12px' }, h('label', {}, 'Nueva contraseña (mínimo 6)'), next),
    h('div', { class: 'field', style: 'margin-top:12px' }, h('label', {}, 'Repite la nueva contraseña'), rep),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary' }, 'Guardar contraseña')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (next.value !== rep.value) return err.replaceChildren(h('div', { class: 'error' }, 'Las contraseñas no coinciden'));
    try {
      await api('/api/me/password', { method: 'POST', body: { current: cur.value, next: next.value } });
      state.me.mustChangePassword = false;
      toast('Contraseña actualizada');
      if (forced) { location.hash = '#/nuevo'; router(); } else form.reset();
    } catch (ex) { err.replaceChildren(h('div', { class: 'error' }, ex.message)); }
  });
  shell([h('h1', {}, 'Mi cuenta'),
    h('p', { class: 'muted' }, `Usuario: ${state.me.username}`),
    form]);
}

// ---------- Formulario de registro (nuevo o edición) ----------
async function renderForm(editId) {
  await loadCommon();
  let rec = null;
  if (editId) rec = await api(`/api/records/${editId}`);
  const fields = state.meta.fields;
  const inputs = {};
  const err = h('div');

  const fieldEls = fields.map((f) => {
    let control;
    if (f.type === 'option') {
      const c = combo({ field: f.key, label: f.label, value: rec?.[f.key] || '', onChange: (v) => autofillFrom(f.key, v) });
      inputs[f.key] = c;
      control = c.root;
    } else {
      const attrs = { class: 'input', name: f.key };
      if (f.type === 'number') Object.assign(attrs, { type: 'text', inputmode: 'decimal', placeholder: '0' });
      else attrs.type = f.type;
      const el = h('input', attrs);
      el.value = rec?.[f.key] ?? (f.key === 'fecha' ? todayISO() : '');
      inputs[f.key] = el;
      control = el;
    }
    return h('div', { class: 'field', 'data-key': f.key }, h('label', {}, f.label), control);
  });

  // Al elegir un producto o sección ya usados, llena los datos que se repiten.
  function autofillFrom(key, v) {
    const fill = (k, val) => {
      if (val == null || val === '') return;
      const inp = inputs[k];
      if (inp && !inp.value) inp.value = String(val);
    };
    if (key === 'producto' && state.autofill.productos[v]) {
      const p = state.autofill.productos[v];
      fill('tipo_producto', p.tipo_producto); fill('ingrediente', p.ingrediente); fill('rsco', p.rsco);
      fill('unidad', p.unidad); fill('dosis', p.dosis);
    }
    if (key === 'seccion' && state.autofill.secciones[v]) fill('hectareas', state.autofill.secciones[v].hectareas);
  }

  const saveBtn = h('button', { type: 'submit', class: 'btn primary' }, rec ? 'Guardar cambios' : 'Guardar registro');
  const form = h('form', { class: 'card', novalidate: true },
    err,
    h('div', { class: 'grid' }, fieldEls),
    h('div', { class: 'actions' },
      saveBtn,
      rec ? h('a', { class: 'btn', href: '#/registros', style: 'text-decoration:none' }, 'Cancelar') : null,
      rec ? h('button', { type: 'button', class: 'btn danger', onclick: () => deleteRecord(rec.id) }, 'Eliminar') : null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const f of fields) body[f.key] = inputs[f.key].value;
    const missing = fields.filter((f) => String(body[f.key] ?? '').trim() === '');
    if (fields.every((f) => f.key === 'fecha' || missing.includes(f))) {
      err.replaceChildren(h('div', { class: 'error' }, 'Llena al menos un dato además de la fecha.'));
      return window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    saveBtn.disabled = true;
    try {
      if (rec) {
        await api(`/api/records/${rec.id}`, { method: 'PUT', body });
        toast('Cambios guardados');
        location.hash = '#/registros';
      } else {
        await api('/api/records', { method: 'POST', body });
        toast(missing.length ? `Registro guardado (quedaron ${missing.length} campos vacíos)` : 'Registro guardado');
        renderForm(); // formulario limpio para el siguiente registro
      }
    } catch (ex) {
      err.replaceChildren(h('div', { class: 'error' }, ex.message));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { saveBtn.disabled = false; }
  });

  shell([
    h('h1', {}, rec ? 'Editar registro' : 'Nuevo registro'),
    rec ? h('p', { class: 'muted small' },
      `Registrado por ${rec.created_by_name} el ${fmtStamp(rec.created_at)}`,
      rec.updated_by_name ? ` · Editado por ${rec.updated_by_name} el ${fmtStamp(rec.updated_at)}` : '') : null,
    form,
  ]);
}

async function deleteRecord(id) {
  if (!(await confirmDialog('¿Eliminar este registro? No se puede deshacer.', 'Eliminar'))) return;
  try {
    await api(`/api/records/${id}`, { method: 'DELETE' });
    toast('Registro eliminado');
    if (location.hash.startsWith('#/registros')) router(); else location.hash = '#/registros';
  } catch (ex) { toast(ex.message); }
}

// ---------- Lista de registros ----------
function incompleteBadge(r) {
  const empty = emptyFields(r);
  return empty.length ? h('span', { class: 'badge warn', title: empty.map((f) => f.label).join(', ') }, `Incompleto (${empty.length})`) : null;
}
async function renderRecords(params) {
  const [rows, users, meta] = await Promise.all([
    api('/api/records?' + params.toString()),
    isAdmin() ? api('/api/users') : Promise.resolve([]),
    state.meta ? Promise.resolve(state.meta) : api('/api/meta'),
  ]);
  state.meta = meta;
  const fields = meta.fields;

  const desde = h('input', { class: 'input', type: 'date', value: params.get('desde') || '' });
  const hasta = h('input', { class: 'input', type: 'date', value: params.get('hasta') || '' });
  const buscar = h('input', { class: 'input', type: 'search', placeholder: 'Producto, aplicador, sección…', value: params.get('buscar') || '' });
  const usuario = isAdmin()
    ? h('select', { class: 'input' }, h('option', { value: '' }, 'Todos'),
      users.map((u) => h('option', { value: u.id, selected: String(u.id) === params.get('usuario') }, u.name)))
    : null;
  const apply = (e) => {
    e?.preventDefault();
    const q = new URLSearchParams();
    if (desde.value) q.set('desde', desde.value);
    if (hasta.value) q.set('hasta', hasta.value);
    if (buscar.value.trim()) q.set('buscar', buscar.value.trim());
    if (usuario?.value) q.set('usuario', usuario.value);
    location.hash = '#/registros' + (q.toString() ? '?' + q : '');
  };
  const filters = h('form', { class: 'card filters', onsubmit: apply },
    h('div', { class: 'field' }, h('label', {}, 'Desde'), desde),
    h('div', { class: 'field' }, h('label', {}, 'Hasta'), hasta),
    usuario ? h('div', { class: 'field' }, h('label', {}, 'Registrado por'), usuario) : null,
    h('div', { class: 'field' }, h('label', {}, 'Buscar'), buscar),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary' }, 'Filtrar'),
      params.toString() ? h('a', { class: 'btn', href: '#/registros', style: 'text-decoration:none' }, 'Limpiar') : null));

  const showAuthor = isAdmin();
  const head = [...(showAuthor ? ['Registrado por'] : []), ...fields.map((f) => f.label), ...(isAdmin() ? [''] : [])];
  const cell = (r, f) => {
    if (f.key === 'fecha') return [fmtDate(r.fecha), ' ', incompleteBadge(r)];
    if (f.type === 'number') return fmtNum(r[f.key]);
    return r[f.key];
  };
  const table = h('div', { class: 'table-wrap responsive card', style: 'padding:0' },
    h('table', { class: 'records' },
      h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        showAuthor ? h('td', {}, h('div', { style: 'font-weight:600' }, r.created_by_name),
          h('div', { class: 'muted small' }, fmtStamp(r.created_at)),
          r.updated_by_name ? h('div', { class: 'muted small' }, `Editado: ${r.updated_by_name}`) : null) : null,
        fields.map((f) => h('td', { class: f.type === 'number' ? 'num' : f.type === 'date' || f.type === 'time' ? 'nowrap' : '' }, cell(r, f))),
        isAdmin() ? h('td', {}, h('div', { class: 'row', style: 'flex-wrap:nowrap' },
          h('a', { class: 'btn sm', href: `#/editar/${r.id}`, style: 'text-decoration:none' }, 'Editar'),
          h('button', { class: 'btn sm danger', onclick: () => deleteRecord(r.id) }, 'Eliminar'))) : null)))));

  const cards = h('div', { class: 'cards' }, rows.map((r) => h('div', { class: 'rec-card' },
    h('div', { class: 'top' }, h('span', {}, r.producto || 'Sin producto', ' ', incompleteBadge(r)), h('span', { class: 'muted' }, fmtDate(r.fecha))),
    h('dl', {}, fields.filter((f) => f.key !== 'producto' && f.key !== 'fecha').map((f) => [h('dt', {}, f.label), h('dd', {}, cell(r, f))]),
      showAuthor ? [h('dt', {}, 'Registrado por'), h('dd', {}, `${r.created_by_name} · ${fmtStamp(r.created_at)}`)] : null,
      showAuthor && r.updated_by_name ? [h('dt', {}, 'Editado por'), h('dd', {}, `${r.updated_by_name} · ${fmtStamp(r.updated_at)}`)] : null),
    isAdmin() ? h('div', { class: 'actions', style: 'margin-top:10px' },
      h('a', { class: 'btn sm', href: `#/editar/${r.id}`, style: 'text-decoration:none' }, 'Editar'),
      h('button', { class: 'btn sm danger', onclick: () => deleteRecord(r.id) }, 'Eliminar')) : null)));

  const qs = params.toString();
  const tools = h('div', { class: 'row', style: 'margin-bottom:12px' },
    h('span', { class: 'muted', style: 'flex:1' }, `${rows.length} registro${rows.length === 1 ? '' : 's'}`),
    h('a', { class: 'btn sm', href: '/api/records.csv' + (qs ? '?' + qs : ''), style: 'text-decoration:none' }, 'Descargar Excel (CSV)'),
    h('a', { class: 'btn sm', href: '#/imprimir' + (qs ? '?' + qs : ''), style: 'text-decoration:none' }, 'Imprimir formato / PDF'));

  shell([
    h('h1', {}, isAdmin() ? 'Todos los registros' : 'Mis registros'),
    filters,
    tools,
    rows.length ? [table, cards] : h('div', { class: 'card muted' }, 'No hay registros con estos filtros.'),
  ], true);
}

// ---------- Vista de impresión con el formato del PDF ----------
async function renderPrint(params) {
  const [rows, meta] = await Promise.all([api('/api/records?' + params.toString()), api('/api/meta')]);
  const s = meta.settings;
  const fields = meta.fields;
  rows.reverse(); // del más antiguo al más reciente, como en el formato
  const minRows = Math.max(rows.length, 25);
  const body = [];
  for (let i = 0; i < minRows; i++) {
    const r = rows[i];
    body.push(h('tr', {}, fields.map((f) => h('td', {},
      !r ? ' ' : f.key === 'fecha' ? fmtDate(r.fecha) : f.type === 'number' ? fmtNum(r[f.key]) : r[f.key]))));
  }
  // La hoja se puede corregir a mano antes de imprimir; esos cambios no se guardan en los registros.
  const tbody = h('tbody', {}, body);
  const sheet = h('div', { class: 'print-sheet', contenteditable: 'true', spellcheck: 'false' },
    h('h3', {}, s.titulo), h('h3', {}, 'INCLUIR TODOS LOS TRATAMIENTOS'),
    h('div', { class: 'hdr' },
      h('b', {}, 'PRODUCTOR:'), h('div', { class: 'line' }, s.productor), h('div'),
      h('b', {}, 'LOCALIZACIÓN:'), h('div', { class: 'line' }, s.localizacion), h('div', { class: 'line' }, s.campo)),
    h('div', { style: 'margin-bottom:10px' }, h('b', {}, 'Incluir aplicaciones de: '), s.incluir),
    h('table', {},
      h('thead', {}, h('tr', {}, fields.map((f) => h('th', {}, f.label.toUpperCase())))),
      tbody),
    h('div', { class: 'foot' },
      h('b', {}, 'Firma del productor:'), h('div', { class: 'line' }),
      h('b', {}, 'Fecha:'), h('div', { class: 'line' }, fmtDate(todayISO()))),
    h('p', { class: 'small' }, 'Favor de entregar el reporte en este formato y sin dejar espacios vacíos.'));
  shell([
    h('div', { class: 'row no-print', style: 'margin-bottom:12px' },
      h('a', { class: 'btn', href: '#/registros' + (params.toString() ? '?' + params : ''), style: 'text-decoration:none' }, '← Volver'),
      h('button', { class: 'btn primary', onclick: () => window.print() }, 'Imprimir o guardar como PDF'),
      h('button', { class: 'btn', onclick: () => tbody.append(h('tr', {}, fields.map(() => h('td', {}, '\u00a0')))) }, '+ Renglón'),
      h('button', { class: 'btn', onclick: () => tbody.lastElementChild?.remove() }, '− Renglón'),
      h('button', { class: 'btn', onclick: () => renderPrint(params) }, 'Deshacer cambios')),
    h('p', { class: 'muted small no-print' },
      `${rows.length} registro${rows.length === 1 ? '' : 's'}. Toca cualquier texto de la hoja para corregirlo antes de imprimir. `,
      'Estos cambios son solo para esta hoja y no modifican los registros guardados.'),
    h('div', { class: 'card', style: 'padding:0;overflow-x:auto' }, sheet),
  ]);
}

// ---------- Administración: empleados ----------
async function renderUsers() {
  const users = await api('/api/users');
  const err = h('div');
  const name = h('input', { class: 'input', placeholder: 'Ej. Juan Pérez' });
  const username = h('input', { class: 'input', placeholder: 'Ej. juan', autocapitalize: 'none' });
  const password = h('input', { class: 'input', placeholder: 'Mínimo 6 caracteres' });
  const role = h('select', { class: 'input' }, h('option', { value: 'empleado' }, 'Empleado'), h('option', { value: 'admin' }, 'Administrador'));
  const form = h('form', { class: 'card' },
    h('h2', {}, 'Agregar cuenta'),
    err,
    h('div', { class: 'grid' },
      h('div', { class: 'field' }, h('label', {}, 'Nombre completo'), name),
      h('div', { class: 'field' }, h('label', {}, 'Usuario para entrar'), username),
      h('div', { class: 'field' }, h('label', {}, 'Contraseña'), password),
      h('div', { class: 'field' }, h('label', {}, 'Tipo de cuenta'), role)),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary' }, 'Crear cuenta')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/users', { method: 'POST', body: { name: name.value, username: username.value, password: password.value, role: role.value } });
      toast('Cuenta creada');
      renderUsers();
    } catch (ex) { err.replaceChildren(h('div', { class: 'error' }, ex.message)); }
  });

  const update = async (u, body, msg) => {
    try { await api(`/api/users/${u.id}`, { method: 'PUT', body }); toast(msg); renderUsers(); }
    catch (ex) { toast(ex.message); }
  };
  const resetPw = (u) => {
    const inp = h('input', { class: 'input', placeholder: 'Nueva contraseña (mínimo 6)' });
    const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal' },
      h('h2', {}, `Nueva contraseña para ${u.name}`),
      h('p', { class: 'muted small' }, 'Se le pedirá cambiarla la próxima vez que entre.'),
      inp,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: async () => { back.remove(); await update(u, { password: inp.value }, 'Contraseña restablecida'); } }, 'Guardar'),
        h('button', { class: 'btn', onclick: () => back.remove() }, 'Cancelar'))));
    document.body.append(back);
    inp.focus();
  };

  const list = h('div', { class: 'card table-wrap', style: 'padding:0' }, h('table', { class: 'records' },
    h('thead', {}, h('tr', {}, ['Nombre', 'Usuario', 'Tipo', 'Registros', 'Estado', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, users.map((u) => h('tr', {},
      h('td', {}, u.name), h('td', {}, u.username),
      h('td', {}, u.role === 'admin' ? 'Administrador' : 'Empleado'),
      h('td', { class: 'num' }, u.registros),
      h('td', {}, h('span', { class: 'badge' + (u.active ? '' : ' off') }, u.active ? 'Activa' : 'Desactivada')),
      h('td', {}, h('div', { class: 'row', style: 'flex-wrap:nowrap' },
        h('a', { class: 'btn sm', href: `#/registros?usuario=${u.id}`, style: 'text-decoration:none' }, 'Ver registros'),
        h('button', { class: 'btn sm', onclick: () => resetPw(u) }, 'Contraseña'),
        u.id !== state.me.id ? h('button', { class: 'btn sm' + (u.active ? ' danger' : ''), onclick: () => update(u, { active: !u.active }, u.active ? 'Cuenta desactivada' : 'Cuenta activada') }, u.active ? 'Desactivar' : 'Activar') : null)))))));

  shell([h('h1', {}, 'Empleados'), form, list]);
}

// ---------- Administración: opciones de los dropdowns ----------
async function renderCatalogs() {
  await loadCommon();
  const sections = state.meta.fields.filter((f) => f.type === 'option').map((f) => {
    const opts = state.options[f.key];
    return h('div', { class: 'card' },
      h('h2', {}, `${f.label} `, h('span', { class: 'muted small' }, `(${opts.length})`)),
      opts.length ? h('div', {}, opts.map((o) => h('div', { class: 'row', style: 'padding:6px 0;border-bottom:1px solid var(--border)' },
        h('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, o.value),
        h('button', { class: 'btn sm', onclick: async () => {
          const inp = h('input', { class: 'input', value: o.value });
          const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal' },
            h('h2', {}, 'Cambiar texto'), inp,
            h('p', { class: 'muted small' }, 'Los registros ya guardados no cambian.'),
            h('div', { class: 'actions' },
              h('button', { class: 'btn primary', onclick: async () => {
                try { await api(`/api/options/${o.id}`, { method: 'PUT', body: { value: inp.value } }); back.remove(); toast('Opción actualizada'); renderCatalogs(); }
                catch (ex) { toast(ex.message); }
              } }, 'Guardar'),
              h('button', { class: 'btn', onclick: () => back.remove() }, 'Cancelar'))));
          document.body.append(back); inp.focus();
        } }, 'Editar'),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!(await confirmDialog(`¿Quitar "${o.value}" de la lista? Los registros ya guardados no cambian.`, 'Quitar'))) return;
          await api(`/api/options/${o.id}`, { method: 'DELETE' }); toast('Opción quitada'); renderCatalogs();
        } }, 'Quitar')))) : h('p', { class: 'muted' }, 'Sin opciones todavía. Se agregan con el + al llenar un registro.'));
  });
  shell([h('h1', {}, 'Opciones de las listas'),
    h('p', { class: 'muted' }, 'Aquí puedes corregir o quitar opciones. Para agregar, usa el + dentro de cualquier lista del formulario.'),
    sections]);
}

// ---------- Administración: datos del encabezado del formato ----------
async function renderSettings() {
  const meta = await api('/api/meta');
  const s = meta.settings;
  const defs = [
    ['titulo', 'Título del reporte'], ['productor', 'Productor'], ['localizacion', 'Localización'],
    ['campo', 'Campo'], ['incluir', 'Incluir aplicaciones de'],
  ];
  const inputs = {};
  const form = h('form', { class: 'card' },
    h('div', { class: 'grid' }, defs.map(([k, label]) => {
      inputs[k] = h('input', { class: 'input', value: s[k] || '' });
      return h('div', { class: 'field' }, h('label', {}, label), inputs[k]);
    })),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary' }, 'Guardar')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(defs.map(([k]) => [k, inputs[k].value]));
    try { await api('/api/settings', { method: 'PUT', body }); toast('Datos guardados'); }
    catch (ex) { toast(ex.message); }
  });
  shell([h('h1', {}, 'Datos del formato'),
    h('p', { class: 'muted' }, 'Estos datos aparecen en el encabezado del reporte impreso.'), form]);
}

// ---------- Arranque ----------
async function start() {
  try {
    state.me = await api('/api/me');
  } catch { return; }
  if (!location.hash) location.hash = '#/nuevo';
  router();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
start();
