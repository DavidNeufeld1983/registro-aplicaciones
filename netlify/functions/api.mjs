// Registro de Aplicaciones: API para Netlify Functions.
// Los datos se guardan en Netlify Blobs (incluido en Netlify, sin base de datos aparte).
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const config = { path: '/api/*' };

const SESSION_DAYS = 30;
const store = () => getStore({ name: 'registro-aplicaciones', consistency: 'strong' });

// Campos del registro, en el mismo orden que el formato PDF.
const FIELDS = [
  { key: 'fecha', label: 'Fecha', type: 'date' },
  { key: 'producto', label: 'Nombre comercial del producto', type: 'option' },
  { key: 'tipo_producto', label: 'Tipo de producto', type: 'option' },
  { key: 'ingrediente', label: 'Ingrediente activo', type: 'option' },
  { key: 'rsco', label: 'RSCO / EPA', type: 'option' },
  { key: 'aplicador', label: 'Nombre del aplicador', type: 'option' },
  { key: 'hectareas', label: 'Hectáreas', type: 'number' },
  { key: 'seccion', label: 'Sección válvulas', type: 'option' },
  { key: 'dosis', label: 'Dosis / Ha', type: 'number' },
  { key: 'unidad', label: 'Unidad', type: 'option' },
  { key: 'hora_inicio', label: 'Hora de inicio', type: 'time' },
  { key: 'hora_termino', label: 'Hora de término', type: 'time' },
  { key: 'tipo_aplicacion', label: 'Tipo de aplicación', type: 'option' },
];
const OPTION_FIELDS = FIELDS.filter((f) => f.type === 'option').map((f) => f.key);

const DEFAULT_SETTINGS = {
  titulo: 'REGISTRO DE APLICACIONES 2024 - 2025',
  productor: 'David Neufeld Neufeld',
  localizacion: 'Col. El Capulin',
  campo: 'Campo # 8',
  incluir: 'NUTRICIÓN',
  enviar_a: 'valleazul.bpa@outlook.com, genaro.noriega16@icloud.com, charlibarbozaavila19@gmail.com',
};
const DEFAULT_OPTIONS = {
  tipo_producto: ['Fertilizante', 'Fungicida', 'Insecticida', 'Herbicida', 'Acaricida', 'Bioestimulante', 'Coadyuvante', 'Regulador de crecimiento'],
  unidad: ['L', 'mL', 'kg', 'g'],
  tipo_aplicacion: ['Fertirriego', 'Foliar', 'Drench', 'Al suelo', 'Aspersión'],
};

// ---------- Almacenamiento ----------
// Cada colección es un documento JSON. Las escrituras usan la ETag para no pisar
// cambios hechos al mismo tiempo por otra persona (se reintenta si hubo choque).
async function read(key, fallback) {
  const data = await store().get(key, { type: 'json' });
  return data ?? fallback;
}
async function mutate(key, fallback, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await store().getWithMetadata(key, { type: 'json' });
    const data = current ? current.data : structuredClone(fallback);
    const result = await fn(data);
    const opts = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const { modified } = await store().setJSON(key, data, opts);
    if (modified) return result;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
  }
  throw new HttpError(503, 'El servidor está ocupado, intenta de nuevo');
}
const emptyColl = () => ({ seq: 0, items: [] });
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  if (!(await read('users', null))) {
    const env = (k) => globalThis.Netlify?.env.get(k) ?? process.env[k];
    const username = (env('ADMIN_USER') || 'admin').toLowerCase();
    const password = env('ADMIN_PASSWORD') || 'admin123';
    await store().setJSON('users', {
      seq: 1,
      items: [{ id: 1, username, name: 'Administrador', password_hash: hashPassword(password), role: 'admin', active: true, must_change_password: true, created_at: nowSql() }],
    }, { onlyIfNew: true });
    const opts = emptyColl();
    for (const [field, values] of Object.entries(DEFAULT_OPTIONS)) {
      for (const value of values) opts.items.push({ id: ++opts.seq, field, value, created_by: null, created_at: nowSql() });
    }
    await store().setJSON('options', opts, { onlyIfNew: true });
  }
  await store().setJSON('settings', DEFAULT_SETTINGS, { onlyIfNew: true });
  await store().set('secret', crypto.randomBytes(32).toString('hex'), { onlyIfNew: true });
  initialized = true;
}

// ---------- Contraseñas y sesiones ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  return crypto.timingSafeEqual(expected, crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length));
}
// Sesión firmada: id.expira.huella. La huella cambia al cambiar la contraseña,
// así que restablecerla cierra las sesiones abiertas de esa persona.
let secretCache;
async function secret() { return (secretCache ??= await store().get('secret')); }
const fingerprint = (u) => crypto.createHash('sha256').update(u.password_hash).digest('hex').slice(0, 16);
async function signSession(u) {
  const payload = `${u.id}.${Date.now() + SESSION_DAYS * 864e5}.${fingerprint(u)}`;
  const mac = crypto.createHmac('sha256', await secret()).update(payload).digest('hex');
  return `${payload}.${mac}`;
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
async function currentUser(req, users) {
  const token = parseCookies(req.headers.get('cookie')).sid;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [id, exp, fp, mac] = parts;
  const expected = crypto.createHmac('sha256', await secret()).update(`${id}.${exp}.${fp}`).digest('hex');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  const u = users.items.find((x) => x.id === Number(id));
  if (!u || !u.active || fingerprint(u) !== fp) return null;
  return u;
}
const sessionCookie = (token, maxAge) => `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=${maxAge}`;

// ---------- Utilidades ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
async function body(req) {
  const text = await req.text();
  if (text.length > 1e6) throw new HttpError(413, 'Solicitud demasiado grande');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'JSON inválido'); }
}
const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
const same = (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }) === 0;

function validateRecord(b) {
  const rec = {};
  const missing = [];
  for (const f of FIELDS) {
    let v = b[f.key];
    if (f.type === 'number') {
      v = Number(String(v ?? '').replace(',', '.'));
      if (!Number.isFinite(v) || v < 0 || String(b[f.key] ?? '').trim() === '') { missing.push(f.label); continue; }
    } else {
      v = clean(v);
      if (!v) { missing.push(f.label); continue; }
      if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { missing.push(f.label); continue; }
      if (f.type === 'time' && !/^\d{2}:\d{2}$/.test(v)) { missing.push(f.label); continue; }
    }
    rec[f.key] = v;
  }
  if (missing.length) throw new HttpError(400, `Faltan o son inválidos: ${missing.join(', ')}`);
  return rec;
}
// Agrega al catálogo los valores nuevos que traiga un registro.
async function rememberOptions(rec, userId) {
  await mutate('options', emptyColl(), (opts) => {
    for (const field of OPTION_FIELDS) {
      if (!opts.items.some((o) => o.field === field && same(o.value, rec[field]))) {
        opts.items.push({ id: ++opts.seq, field, value: rec[field], created_by: userId, created_at: nowSql() });
      }
    }
  });
}
function decorate(r, users) {
  const name = (id) => users.items.find((u) => u.id === id)?.name ?? '';
  return { ...r, created_by_name: name(r.created_by), updated_by_name: r.updated_by ? name(r.updated_by) : null };
}
function filterRecords(records, users, user, q) {
  let rows = records.items;
  if (user.role !== 'admin') rows = rows.filter((r) => r.created_by === user.id);
  else if (q.get('usuario')) rows = rows.filter((r) => r.created_by === Number(q.get('usuario')));
  if (q.get('desde')) rows = rows.filter((r) => r.fecha >= q.get('desde'));
  if (q.get('hasta')) rows = rows.filter((r) => r.fecha <= q.get('hasta'));
  if (q.get('buscar')) {
    const s = q.get('buscar').toLowerCase();
    rows = rows.filter((r) => ['producto', 'ingrediente', 'aplicador', 'seccion', 'tipo_aplicacion'].some((k) => String(r[k]).toLowerCase().includes(s)));
  }
  rows = [...rows].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora_inicio.localeCompare(a.hora_inicio) || b.id - a.id);
  return rows.slice(0, 5000).map((r) => decorate(r, users));
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function recordsCsv(rows, includeAuthor) {
  const head = FIELDS.map((f) => f.label.toUpperCase());
  if (includeAuthor) head.push('REGISTRADO POR', 'FECHA DE REGISTRO', 'EDITADO POR', 'FECHA DE EDICIÓN');
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    const row = FIELDS.map((f) => r[f.key]);
    if (includeAuthor) row.push(r.created_by_name, r.created_at, r.updated_by_name || '', r.updated_at || '');
    lines.push(row.map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n');
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active ? 1 : 0, created_at: u.created_at });

// Límite simple de intentos de inicio de sesión (por instancia de la función).
const loginAttempts = new Map();

// ---------- Rutas ----------
async function route(req, context) {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;
  let match;

  await ensureInit();
  const users = await read('users', emptyColl());
  const me = await currentUser(req, users);
  const requireUser = () => {
    if (!me) throw new HttpError(401, 'Inicia sesión para continuar');
    return me;
  };
  const requireAdmin = () => {
    requireUser();
    if (me.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer esto');
    return me;
  };

  if (p === '/api/login' && m === 'POST') {
    const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'x';
    const now = Date.now();
    const list = (loginAttempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
    loginAttempts.set(ip, list);
    if (list.length >= 10) throw new HttpError(429, 'Demasiados intentos. Espera 15 minutos.');
    const { username, password } = await body(req);
    const u = users.items.find((x) => same(x.username, clean(username)));
    if (!u || !u.active || !verifyPassword(String(password || ''), u.password_hash)) {
      list.push(now);
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(await signSession(u), SESSION_DAYS * 86400) });
  }
  if (p === '/api/logout' && m === 'POST') {
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (p === '/api/me' && m === 'GET') {
    const u = requireUser();
    return json(200, { id: u.id, username: u.username, name: u.name, role: u.role, mustChangePassword: !!u.must_change_password });
  }
  if (p === '/api/me/password' && m === 'POST') {
    const u = requireUser();
    const { current, next } = await body(req);
    if (!verifyPassword(String(current || ''), u.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
    if (String(next || '').length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres');
    const updated = await mutate('users', emptyColl(), (doc) => {
      const t = doc.items.find((x) => x.id === u.id);
      t.password_hash = hashPassword(String(next));
      t.must_change_password = false;
      return t;
    });
    // La huella cambió: se entrega una sesión nueva para seguir dentro.
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(await signSession(updated), SESSION_DAYS * 86400) });
  }

  if (p === '/api/meta' && m === 'GET') {
    requireUser();
    return json(200, { fields: FIELDS, settings: { ...DEFAULT_SETTINGS, ...(await read('settings', {})) } });
  }
  if (p === '/api/settings' && m === 'PUT') {
    requireAdmin();
    const b = await body(req);
    await mutate('settings', DEFAULT_SETTINGS, (s) => {
      for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in b) s[k] = String(b[k] ?? '').trim().slice(0, 500);
    });
    return json(200, { ok: true });
  }

  // Opciones de los dropdowns
  if (p === '/api/options' && m === 'GET') {
    requireUser();
    const opts = await read('options', emptyColl());
    const out = Object.fromEntries(OPTION_FIELDS.map((k) => [k, []]));
    for (const o of opts.items) out[o.field]?.push({ id: o.id, value: o.value });
    for (const k of OPTION_FIELDS) out[k].sort((a, b) => a.value.localeCompare(b.value, 'es', { sensitivity: 'base' }));
    return json(200, out);
  }
  if (p === '/api/options' && m === 'POST') {
    const u = requireUser();
    const b = await body(req);
    const field = String(b.field || '');
    const value = clean(b.value);
    if (!OPTION_FIELDS.includes(field)) throw new HttpError(400, 'Campo inválido');
    if (!value) throw new HttpError(400, 'Escribe la nueva opción');
    const row = await mutate('options', emptyColl(), (opts) => {
      let o = opts.items.find((x) => x.field === field && same(x.value, value));
      if (!o) opts.items.push((o = { id: ++opts.seq, field, value, created_by: u.id, created_at: nowSql() }));
      return { id: o.id, value: o.value };
    });
    return json(200, row);
  }
  if ((match = p.match(/^\/api\/options\/(\d+)$/))) {
    requireAdmin();
    const id = Number(match[1]);
    if (m === 'DELETE') {
      await mutate('options', emptyColl(), (opts) => { opts.items = opts.items.filter((o) => o.id !== id); });
      return json(200, { ok: true });
    }
    if (m === 'PUT') {
      const value = clean((await body(req)).value);
      if (!value) throw new HttpError(400, 'Escribe el nuevo texto');
      await mutate('options', emptyColl(), (opts) => {
        const o = opts.items.find((x) => x.id === id);
        if (!o) throw new HttpError(404, 'Opción no encontrada');
        if (opts.items.some((x) => x.id !== id && x.field === o.field && same(x.value, value))) throw new HttpError(400, 'Esa opción ya existe');
        o.value = value;
      });
      return json(200, { ok: true });
    }
  }

  // Autollenado: últimos datos usados por producto y por sección.
  if (p === '/api/autofill' && m === 'GET') {
    requireUser();
    const records = await read('records', emptyColl());
    const productos = {};
    const secciones = {};
    for (const r of [...records.items].sort((a, b) => a.id - b.id)) {
      productos[r.producto] = { tipo_producto: r.tipo_producto, ingrediente: r.ingrediente, rsco: r.rsco, unidad: r.unidad, dosis: r.dosis };
      secciones[r.seccion] = { hectareas: r.hectareas };
    }
    return json(200, { productos, secciones });
  }

  if ((p === '/api/records' || p === '/api/records.csv') && m === 'GET') {
    const u = requireUser();
    const rows = filterRecords(await read('records', emptyColl()), users, u, url.searchParams);
    if (p === '/api/records') return json(200, rows);
    return new Response(recordsCsv(rows.reverse(), u.role === 'admin'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="registro-aplicaciones-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  if (p === '/api/records' && m === 'POST') {
    const u = requireUser();
    const rec = validateRecord(await body(req));
    const saved = await mutate('records', emptyColl(), (doc) => {
      const r = { id: ++doc.seq, ...rec, created_by: u.id, created_at: nowSql(), updated_by: null, updated_at: null };
      doc.items.push(r);
      return r;
    });
    await rememberOptions(rec, u.id);
    return json(201, decorate(saved, users));
  }
  if ((match = p.match(/^\/api\/records\/(\d+)$/))) {
    const id = Number(match[1]);
    const u = requireUser();
    const records = await read('records', emptyColl());
    const existing = records.items.find((r) => r.id === id);
    if (!existing || (u.role !== 'admin' && existing.created_by !== u.id)) throw new HttpError(404, 'Registro no encontrado');
    if (m === 'GET') return json(200, decorate(existing, users));
    if (m === 'PUT') {
      requireAdmin();
      const rec = validateRecord(await body(req));
      const saved = await mutate('records', emptyColl(), (doc) => {
        const r = doc.items.find((x) => x.id === id);
        if (!r) throw new HttpError(404, 'Registro no encontrado');
        Object.assign(r, rec, { updated_by: u.id, updated_at: nowSql() });
        return r;
      });
      await rememberOptions(rec, u.id);
      return json(200, decorate(saved, users));
    }
    if (m === 'DELETE') {
      requireAdmin();
      await mutate('records', emptyColl(), (doc) => { doc.items = doc.items.filter((r) => r.id !== id); });
      return json(200, { ok: true });
    }
  }

  // Usuarios (solo administrador)
  if (p === '/api/users' && m === 'GET') {
    requireAdmin();
    const records = await read('records', emptyColl());
    const list = users.items.map((x) => ({ ...publicUser(x), registros: records.items.filter((r) => r.created_by === x.id).length }));
    list.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    return json(200, list);
  }
  if (p === '/api/users' && m === 'POST') {
    requireAdmin();
    const b = await body(req);
    const username = clean(b.username).toLowerCase().replace(/\s+/g, '');
    const name = clean(b.name);
    const role = b.role === 'admin' ? 'admin' : 'empleado';
    const password = String(b.password || '');
    if (!username || !name) throw new HttpError(400, 'Escribe el nombre y el usuario');
    if (password.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
    const id = await mutate('users', emptyColl(), (doc) => {
      if (doc.items.some((x) => same(x.username, username))) throw new HttpError(400, 'Ese usuario ya existe');
      const nu = { id: ++doc.seq, username, name, password_hash: hashPassword(password), role, active: true, must_change_password: false, created_at: nowSql() };
      doc.items.push(nu);
      return nu.id;
    });
    await mutate('options', emptyColl(), (opts) => {
      if (!opts.items.some((o) => o.field === 'aplicador' && same(o.value, name))) {
        opts.items.push({ id: ++opts.seq, field: 'aplicador', value: name, created_by: null, created_at: nowSql() });
      }
    });
    return json(201, { id });
  }
  if ((match = p.match(/^\/api\/users\/(\d+)$/)) && m === 'PUT') {
    const admin = requireAdmin();
    const id = Number(match[1]);
    const b = await body(req);
    if (id === admin.id && (b.active === false || b.role === 'empleado')) {
      throw new HttpError(400, 'No puedes desactivar ni quitarte el rol de administrador a ti mismo');
    }
    if (b.password && String(b.password).length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
    await mutate('users', emptyColl(), (doc) => {
      const t = doc.items.find((x) => x.id === id);
      if (!t) throw new HttpError(404, 'Usuario no encontrado');
      if ('name' in b && clean(b.name)) t.name = clean(b.name);
      if ('role' in b) t.role = b.role === 'admin' ? 'admin' : 'empleado';
      if ('active' in b) t.active = !!b.active;
      if (b.password) { t.password_hash = hashPassword(String(b.password)); t.must_change_password = true; }
    });
    return json(200, { ok: true });
  }

  throw new HttpError(404, 'No encontrado');
}

export default async (req, context) => {
  try {
    // Protección CSRF básica: las escrituras deben venir de la propia app.
    if (req.method !== 'GET' && req.headers.get('x-requested-with') !== 'registro-app') {
      throw new HttpError(403, 'Solicitud no permitida');
    }
    return await route(req, context);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    return json(err.status || 500, { error: err instanceof HttpError ? err.message : 'Error interno del servidor' });
  }
};
