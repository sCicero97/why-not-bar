// ═══════════════════════════════════════════════════════════════════════════
// admin.js — Panel de Administración
// ═══════════════════════════════════════════════════════════════════════════
console.log('ADMIN v4 2026-04-22 (Apple UI)');

// ─── SVG icon helper ──────────────────────────────────────────────────────────
// Returns inline <svg> that references the sprite defined in admin.html
function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Labels de rol sin emoji (los íconos los ponemos con SVG al costado)
const ROLE_ICON = { admin: 'user-gear', bar: 'glass', door: 'door' };

let activeEvent    = null;
let viewingEvent   = null;   // evento que estoy viendo (puede ser !== activeEvent)
let groupByStatus  = true;   // toggle: agrupar por estado o por nro de cuenta
let attendees      = [];
let barAccounts    = [];
let barClosures    = [];
let expenses       = [];
let events         = [];
let tasks          = [];
let taskChecks     = [];
let eventSettings  = { door_can_charge: false, blocked_slots: [] };
let profiles       = [];
let reminderTimers = {};
let appUsers       = [];   // usuarios del sistema (cargados on-demand)
let blacklist      = [];   // entradas de la black list (cross-event)
let allAttendeesXE = [];   // asistentes de todos los eventos (para Estadísticas)

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const user = await requireAuth(['admin']);
    if (!user) return;
    const displayName = user.displayName || user.email;
    const chip = document.getElementById('userChip');
    if (chip) chip.innerHTML = `${icon('user-gear', 16)}<span>${displayName}</span>`;
    setupUserDropdown();
    setupNotifChannel('Admin', displayName);
    document.getElementById('app').style.display = 'grid';

    activeEvent = await getActiveEvent();
    viewingEvent = activeEvent; // arranca viendo el activo
    if (activeEvent) {
      document.getElementById('eventName').textContent = activeEvent.name;
    }

    await loadAll();
    setupRealtime();
    setupUI();
    // Routing por hash: #barra, #tareas, etc. — abrir la pestaña si es válida.
    const applyHashTab = () => {
      const h = (location.hash || '').replace(/^#/, '');
      if (h && TAB_TITLES && TAB_TITLES[h]) activateTab(h, { skipHash: true });
    };
    window.addEventListener('hashchange', applyHashTab);
    applyHashTab();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  } catch (e) {
    if (e.message !== 'SETUP_REQUIRED') console.error('Admin init error:', e);
  }
}

// Helper: el evento en foco (el que se está viendo actualmente)
function currentEvent() {
  return viewingEvent || activeEvent;
}

async function loadAll() {
  const db = getDb();
  const eventId = currentEvent()?.id;

  const queries = [
    db.from('events').select('*').order('date', { ascending: false }),
    db.from('profiles').select('id,display_name,role'),
    db.from('blacklist').select('*').order('created_at', { ascending: false }),
    // Asistentes de todos los eventos (para stats de Personas)
    db.from('attendees').select('id,event_id,name,cedula,email,phone,entry_amount,amount_paid,bar_account_slot,created_at'),
  ];
  if (eventId) {
    queries.push(
      db.from('attendees').select('*').eq('event_id', eventId).order('name'),
      db.from('bar_accounts').select('*, attendees(name)').eq('event_id', eventId).order('slot'),
      db.from('bar_closures').select('*, attendees(name)').eq('event_id', eventId).order('closed_at', { ascending: false }),
      db.from('expenses').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
      db.from('tasks').select('*, task_checks(id,checked_by,checked_at)').eq('event_id', eventId).order('created_at'),
      db.from('event_settings').select('*').eq('event_id', eventId).maybeSingle(),
    );
  }

  const results = await Promise.all(queries);
  if (results[0].data) events = results[0].data;
  if (results[1].data) profiles = results[1].data;
  // blacklist puede fallar si la tabla no existe todavía (pre-migración) — manejar
  if (results[2] && !results[2].error && results[2].data) blacklist = results[2].data;
  else if (results[2]?.error) { blacklist = []; console.warn('[blacklist]', results[2].error.message); }
  if (results[3]?.data) allAttendeesXE = results[3].data;
  if (results[4]?.data) attendees = results[4].data;
  if (results[5]?.data) barAccounts = results[5].data;
  if (results[6]?.data) barClosures = results[6].data;
  if (results[7]?.data) expenses = results[7].data;
  if (results[8]?.data) tasks = results[8].data;
  if (results[9]?.data) {
    eventSettings = results[9].data || { door_can_charge: false, blocked_slots: [] };
    if (!Array.isArray(eventSettings.blocked_slots)) eventSettings.blocked_slots = [];
  }

  // Self-heal: asistentes con bar_account_slot cuya bar_account está sin attendee_id
  // (bug histórico: crew creado antes de corregir el event_id).
  await healDanglingBarAccountLinks();

  renderAll();
}

async function healDanglingBarAccountLinks() {
  if (!currentEvent()) return;
  const toFix = attendees.filter(a => {
    if (!a.bar_account_slot) return false;
    const acc = barAccounts.find(b => b.slot === a.bar_account_slot);
    return acc && !acc.attendee_id;
  });
  if (!toFix.length) return;
  const db = getDb();
  for (const a of toFix) {
    await db.from('bar_accounts')
      .update({ attendee_id: a.id })
      .eq('event_id', currentEvent().id)
      .eq('slot', a.bar_account_slot);
    // Actualizar estado local
    const acc = barAccounts.find(b => b.slot === a.bar_account_slot);
    if (acc) { acc.attendee_id = a.id; acc.attendees = { name: a.name }; }
  }
}

function setupRealtime() {
  if (!currentEvent()) return;
  const db = getDb();
  const eid = currentEvent().id;

  db.channel('admin-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendees', filter: `event_id=eq.${eid}` },
      (p) => { applyChange(attendees, p); renderAll(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bar_accounts', filter: `event_id=eq.${eid}` },
      (p) => { applyChange(barAccounts, p); renderAll(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bar_closures', filter: `event_id=eq.${eid}` },
      (p) => { applyChange(barClosures, p); renderAll(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `event_id=eq.${eid}` },
      (p) => { applyChange(expenses, p); renderAll(); })
    .subscribe();

  // Polling fallback: reload all data every 8s para mantener info siempre fresca
  setInterval(() => loadAll(), 8000);

  // Recargar al volver a la pestaña
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadAll();
  });
}

function applyChange(arr, payload) {
  if (payload.eventType === 'INSERT') arr.push(payload.new);
  else if (payload.eventType === 'UPDATE') {
    const i = arr.findIndex(x => x.id === payload.new.id);
    if (i >= 0) arr[i] = { ...arr[i], ...payload.new };
  } else if (payload.eventType === 'DELETE') {
    const i = arr.findIndex(x => x.id === payload.old.id);
    if (i >= 0) arr.splice(i, 1);
  }
}

// ─── Render all ───────────────────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderAttendeesTable();
  renderBarTable();
  renderAdminBarCounters();
  renderExpenses();
  renderEvents();
  renderTasks();
  renderBlockedCards();
  renderEventPicker();
  renderPersonas();
  renderBlacklist();
}

// ─── Personas (estadísticas cross-event) ──────────────────────────────────────
// Agrupa por cédula (si existe) o por nombre normalizado.
const BL_REASONS = {
  no_devolvio_tarjeta: 'No devolvió tarjeta',
  no_pago_bar:         'No pagó en el bar',
  entrada_bloqueada:   'Su entrada fue bloqueada',
};

function personKey(att) {
  if (att.cedula && att.cedula.trim()) return 'ced:' + att.cedula.trim().toLowerCase();
  return 'name:' + (att.name || '').trim().toLowerCase();
}

function aggregatePersonas() {
  const byKey = new Map();
  for (const att of allAttendeesXE) {
    const k = personKey(att);
    if (!byKey.has(k)) {
      byKey.set(k, {
        key: k,
        name: att.name,
        cedula: att.cedula || null,
        email: att.email || null,
        phone: att.phone || null,
        events: new Set(),
        lastAt: null,
        totalSpent: 0,
      });
    }
    const p = byKey.get(k);
    // Preferir valores no vacíos en el match
    if (att.cedula) p.cedula = att.cedula;
    if (att.email)  p.email  = att.email;
    if (att.phone)  p.phone  = att.phone;
    if (att.event_id) p.events.add(att.event_id);
    const when = att.created_at ? new Date(att.created_at) : null;
    if (when && (!p.lastAt || when > p.lastAt)) p.lastAt = when;
    p.totalSpent += Number(att.amount_paid || 0);
  }
  return Array.from(byKey.values()).sort((a, b) => (b.events.size - a.events.size) || String(a.name).localeCompare(b.name, 'es'));
}

function renderPersonas() {
  const tbody = document.getElementById('personasBody');
  if (!tbody) return;
  const search = (document.getElementById('personasSearch')?.value || '').toLowerCase().trim();
  let list = aggregatePersonas();
  if (search) {
    list = list.filter(p => (
      (p.name || '').toLowerCase().includes(search) ||
      (p.cedula || '').toLowerCase().includes(search) ||
      (p.email  || '').toLowerCase().includes(search) ||
      (p.phone  || '').toLowerCase().includes(search)
    ));
  }

  const counters = document.getElementById('personasCounters');
  if (counters) {
    const cfg = [
      { label: 'Personas únicas', value: list.length, color: '#3b82f6', bg: '#0d1420', border: '#1a2a3a' },
      { label: 'En black list',   value: blacklist.length, color: '#ff453a', bg: '#1f0d0d', border: '#3a1a1a' },
    ];
    counters.innerHTML = cfg.map(c => `
      <div style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:10px 16px;display:flex;gap:8px;align-items:center">
        <span style="font-size:22px;font-weight:bold;color:${c.color}">${c.value}</span>
        <span style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">${c.label}</span>
      </div>`).join('');
  }

  const byEvent = Object.fromEntries(events.map(e => [e.id, e]));
  tbody.innerHTML = list.map(p => {
    const dates = Array.from(p.events).map(id => byEvent[id]?.date || '').filter(Boolean).sort().reverse();
    const isBlacklisted = findBlacklistMatch(p)?.length > 0;
    return `<tr>
      <td><strong>${p.name || '—'}</strong>${isBlacklisted ? ' <span class="bl-chip">BL</span>' : ''}</td>
      <td style="font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:12.5px">${p.cedula || '—'}</td>
      <td style="font-size:12.5px;color:var(--muted)">
        ${p.email ? `<div>${p.email}</div>` : ''}
        ${p.phone ? `<div>${p.phone}</div>` : ''}
        ${!p.email && !p.phone ? '—' : ''}
      </td>
      <td>
        <strong>${p.events.size}</strong>
        ${dates.length ? `<div style="font-size:11px;color:var(--muted)">${dates.slice(0, 3).join(' · ')}${dates.length > 3 ? ` +${dates.length - 3}` : ''}</div>` : ''}
      </td>
      <td style="font-size:12.5px;color:var(--muted)">${p.lastAt ? p.lastAt.toLocaleDateString('es-UY') : '—'}</td>
      <td><strong>${formatMoney(p.totalSpent)}</strong></td>
      <td>
        <button class="btn btn-sm btn-danger icon-label-btn" onclick='openBlacklistModal(${JSON.stringify({ name: p.name, cedula: p.cedula, email: p.email, phone: p.phone }).replace(/'/g,"&#39;")})' title="Agregar a black list">
          ${icon('warn', 14)}BL
        </button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty-state">Sin personas registradas.</td></tr>';
}

// ─── Black list ───────────────────────────────────────────────────────────────
function findBlacklistMatch(person) {
  // Busca entradas en la blacklist que coincidan con cualquiera de los datos.
  const n = (person.name || '').toLowerCase().trim();
  const c = (person.cedula || '').toLowerCase().trim();
  const e = (person.email || '').toLowerCase().trim();
  const p = (person.phone || '').toLowerCase().trim();
  return blacklist.filter(bl => {
    if (c && (bl.cedula || '').toLowerCase().trim() === c) return true;
    if (e && (bl.email  || '').toLowerCase().trim() === e) return true;
    if (p && (bl.phone  || '').toLowerCase().trim() === p) return true;
    if (n && (bl.name   || '').toLowerCase().trim() === n) return true;
    return false;
  });
}

function renderBlacklist() {
  const tbody = document.getElementById('blacklistBody');
  if (!tbody) return;
  const search = (document.getElementById('blacklistSearch')?.value || '').toLowerCase().trim();

  let list = [...blacklist];
  if (search) {
    list = list.filter(b => (
      (b.name || '').toLowerCase().includes(search) ||
      (b.cedula || '').toLowerCase().includes(search) ||
      (b.email || '').toLowerCase().includes(search) ||
      (b.phone || '').toLowerCase().includes(search) ||
      (b.notes || '').toLowerCase().includes(search)
    ));
  }

  const counters = document.getElementById('blacklistCounters');
  if (counters) {
    const cfg = [
      { label: 'En black list', value: blacklist.length, color: '#ff453a', bg: '#1f0d0d', border: '#3a1a1a' },
    ];
    counters.innerHTML = cfg.map(c => `
      <div style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:10px 16px;display:flex;gap:8px;align-items:center">
        <span style="font-size:22px;font-weight:bold;color:${c.color}">${c.value}</span>
        <span style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">${c.label}</span>
      </div>`).join('');
  }

  tbody.innerHTML = list.map(b => `
    <tr>
      <td><strong>${b.name || '—'}</strong></td>
      <td style="font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:12.5px">${b.cedula || '—'}</td>
      <td style="font-size:12.5px;color:var(--muted)">
        ${b.email ? `<div>${b.email}</div>` : ''}
        ${b.phone ? `<div>${b.phone}</div>` : ''}
        ${!b.email && !b.phone ? '—' : ''}
      </td>
      <td>
        ${(b.reasons || []).map(r => `<span class="bl-reason">${BL_REASONS[r] || r}</span>`).join(' ') || '—'}
      </td>
      <td style="font-size:12.5px;color:var(--muted)">${b.notes || ''}</td>
      <td style="font-size:12px;color:var(--muted)">${b.created_at ? new Date(b.created_at).toLocaleDateString('es-UY') : ''}</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="removeFromBlacklist('${b.id}')" title="Quitar de la lista">${icon('trash', 14)}</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty-state">La black list está vacía.</td></tr>';
}

function openBlacklistModal(prefill = {}) {
  const p = typeof prefill === 'string' ? JSON.parse(prefill) : prefill;
  showModal(`
    <h3 style="margin:0 0 18px">Agregar a la black list</h3>
    <form id="blForm">
      <div class="form-grid">
        <div class="form-group"><label>Nombre *</label><input name="name" value="${(p.name||'').replace(/"/g,'&quot;')}" required/></div>
        <div class="form-group"><label>Cédula</label><input name="cedula" value="${(p.cedula||'').replace(/"/g,'&quot;')}"/></div>
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${(p.email||'').replace(/"/g,'&quot;')}"/></div>
        <div class="form-group"><label>Teléfono</label><input name="phone" value="${(p.phone||'').replace(/"/g,'&quot;')}"/></div>
      </div>
      <div class="form-group" style="margin-top:12px">
        <label>Motivo *</label>
        <div class="bl-reasons-grid">
          ${Object.entries(BL_REASONS).map(([k, v]) => `
            <label class="bl-reason-pick">
              <input type="checkbox" name="reasons" value="${k}"/>
              <span>${v}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="form-group"><label>Notas</label><input name="notes" placeholder="(opcional)"/></div>
      <div class="modal-actions">
        <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-danger">Agregar a black list</button>
      </div>
    </form>
  `);
  document.getElementById('blForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const reasons = fd.getAll('reasons');
    if (!reasons.length) { toast('Elegí al menos un motivo', 'error'); return; }
    const payload = {
      name:    fd.get('name').trim(),
      cedula:  fd.get('cedula').trim() || null,
      email:   fd.get('email').trim() || null,
      phone:   fd.get('phone').trim() || null,
      reasons,
      notes:   fd.get('notes').trim() || null,
    };
    const db = getDb();
    const { data, error } = await db.from('blacklist').insert(payload).select().single();
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    blacklist.unshift(data);
    closeModal();
    toast('Agregado a la black list', 'success');
    renderBlacklist();
    renderPersonas();
  });
}
window.openBlacklistModal = openBlacklistModal;

async function removeFromBlacklist(id) {
  if (!confirm('¿Quitar esta persona de la black list?')) return;
  const db = getDb();
  const { error } = await db.from('blacklist').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  blacklist = blacklist.filter(b => b.id !== id);
  toast('Quitado de la black list', 'success');
  renderBlacklist();
  renderPersonas();
}
window.removeFromBlacklist = removeFromBlacklist;

// Chequea si un asistente a crear/editar coincide con la blacklist; si sí, muestra warning.
// Devuelve una promesa: true = continuar, false = cancelar.
async function confirmIfBlacklisted(person) {
  const matches = findBlacklistMatch(person);
  if (!matches.length) return true;
  const reasons = Array.from(new Set(matches.flatMap(m => m.reasons || [])));
  const msg = `⚠️ Esta persona está en la black list.\n\nMotivos previos:\n${reasons.map(r => '· ' + (BL_REASONS[r] || r)).join('\n')}\n\n¿Querés agregarlo al evento igualmente?`;
  return window.confirm(msg);
}

// ─── Event picker dropdown ────────────────────────────────────────────────────
function renderEventPicker() {
  const viewing = currentEvent();
  const viewName = viewing?.name || 'Admin';
  const isActive = viewing && activeEvent && viewing.id === activeEvent.id;

  ['eventName', 'eventNameMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = viewName;
  });
  ['eventPickerStatus', 'eventPickerStatusMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('inactive', !isActive);
      el.title = isActive ? 'Evento activo' : 'Evento no activo';
    }
  });

  const sorted = [...events].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const menuHtml = sorted.map(ev => {
    const active  = activeEvent && ev.id === activeEvent.id;
    const current = viewing && ev.id === viewing.id;
    return `<button type="button" class="event-picker-item${active ? ' active-event' : ''}${current ? ' current' : ''}" data-event-id="${ev.id}">
      <span class="dot"></span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${ev.name}</span>
      <span class="meta">${ev.date || ''}</span>
    </button>`;
  }).join('') || '<div style="padding:10px;color:#8e8e93;font-size:12px">Sin eventos</div>';

  ['eventPickerMenu', 'eventPickerMenuMobile'].forEach(id => {
    const menu = document.getElementById(id);
    if (!menu) return;
    menu.innerHTML = menuHtml;
    menu.querySelectorAll('.event-picker-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const eid = btn.dataset.eventId;
        const ev = events.find(e => e.id === eid);
        if (!ev) return;
        viewingEvent = ev;
        ['eventPickerMenu', 'eventPickerMenuMobile'].forEach(x => {
          const m = document.getElementById(x); if (m) m.hidden = true;
        });
        await loadAll();
        renderAll();
      });
    });
  });
}

function toggleEventPicker(menuId, force) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const willOpen = force === undefined ? menu.hidden : force;
  menu.hidden = !willOpen;
  // Cerrar el otro menú si está abierto
  const otherId = menuId === 'eventPickerMenu' ? 'eventPickerMenuMobile' : 'eventPickerMenu';
  const other = document.getElementById(otherId);
  if (other && !other.hidden) other.hidden = true;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function renderDashboard() {
  const openAccounts = barAccounts.filter(a => !a.is_closed);
  const barTotal     = barClosures.reduce((s, c) => s + Number(c.total), 0)
                     + openAccounts.reduce((s, a) => s + Number(a.total), 0);
  const entryTotal   = attendees.reduce((s, a) => s + Number(a.entry_amount || 0), 0);
  const expTotal     = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netTotal     = barTotal + entryTotal - expTotal;
  const q160 = barAccounts.reduce((s,a)=>s+a.qty160,0) + barClosures.reduce((s,c)=>s+c.qty160,0);
  const q260 = barAccounts.reduce((s,a)=>s+a.qty260,0) + barClosures.reduce((s,c)=>s+c.qty260,0);
  const q360 = barAccounts.reduce((s,a)=>s+a.qty360,0) + barClosures.reduce((s,c)=>s+c.qty360,0);

  setText('d-barTotal',    formatMoney(barTotal));
  setText('d-entryTotal',  formatMoney(entryTotal));
  setText('d-expenses',    formatMoney(expTotal));
  setText('d-netTotal',    formatMoney(netTotal));
  setText('d-attendees',   attendees.length);
  setText('d-entered',     attendees.filter(a => a.entered).length);
  setText('d-openAccs',    openAccounts.filter(a => a.total > 0).length);
  setText('d-closedAccs',  barClosures.length);
  setText('d-q160', q160); setText('d-q260', q260); setText('d-q360', q360);

  const tbody = document.getElementById('d-recentClosures');
  tbody.innerHTML = barClosures.slice(0, 10).map(c => `
    <tr>
      <td><strong>${padId(c.slot)}</strong></td>
      <td>${c.attendees?.name || '—'}</td>
      <td><strong>${formatMoney(c.total)}</strong></td>
      <td>${c.closed_by || '—'}</td>
      <td style="font-size:12px;color:var(--muted)">${c.closed_at ? new Date(c.closed_at).toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
      <td>${c.payment_photo_url ? `<button class="btn btn-sm icon-label-btn" onclick="viewPhoto('${c.payment_photo_url}')">${icon('camera',14)}Ver</button>` : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty-state">Sin cobros todavía.</td></tr>';
}

// ─── Attendees table ──────────────────────────────────────────────────────────
function renderAttendeesTable() {
  const search = document.getElementById('attSearch')?.value?.toLowerCase() || '';
  const statusF = document.getElementById('attStatusFilter')?.value || '';

  // Contadores por estado
  const counters = document.getElementById('attStatusCounters');
  if (counters) {
    const cfg = [
      { key: 'paid',       label: 'Pago',       color: '#1ed760', bg: '#0d1f0d', border: '#1a3a1a' },
      { key: 'in_process', label: 'En proceso',  color: '#f59e0b', bg: '#1f1900', border: '#3a2e00' },
      { key: 'invited',    label: 'Invitado',    color: '#3b82f6', bg: '#0d1420', border: '#1a2a3a' },
      { key: 'crew',       label: 'Crew',        color: '#8b5cf6', bg: '#130d1f', border: '#2a1a3a' },
    ];
    counters.innerHTML = cfg.map(c => {
      const n = attendees.filter(a => a.status === c.key).length;
      return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:10px 16px;display:flex;gap:8px;align-items:center">
        <span style="font-size:22px;font-weight:bold;color:${c.color}">${n}</span>
        <span style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">${c.label}</span>
      </div>`;
    }).join('');
  }

  let list = attendees.filter(a => {
    if (search) {
      const slot = a.bar_account_slot ? String(a.bar_account_slot) : '';
      const slotPadded = slot ? String(a.bar_account_slot).padStart(3, '0') : '';
      const hay = `${a.name} ${a.cedula || ''} ${a.email || ''} ${a.phone || ''} ${slot} ${slotPadded}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (statusF && a.status !== statusF) return false;
    return true;
  });

  // Ordenar: por estado (agrupado) o por número de cuenta
  if (groupByStatus) {
    const statusOrder = { 'paid': 0, 'in_process': 1, 'crew': 2, 'invited': 3 };
    list.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));
  } else {
    list.sort((a, b) => (a.bar_account_slot || 9999) - (b.bar_account_slot || 9999));
  }

  // Actualizar estado visual del botón toggle
  const toggleBtn = document.getElementById('toggleGroupBtn');
  const toggleTxt = document.getElementById('toggleGroupText');
  if (toggleBtn && toggleTxt) {
    toggleTxt.textContent = groupByStatus ? 'Ordenar por cuenta' : 'Agrupar por estado';
    toggleBtn.classList.toggle('btn-primary', !groupByStatus);
  }

  const tbody = document.getElementById('attendeesBody');
  if (!tbody) return;

  tbody.innerHTML = list.map(att => {
    const barAcc = att.bar_account_slot ? barAccounts.find(b => b.slot === att.bar_account_slot) : null;
    const consumption = barAcc ? barAcc.total + barClosures.filter(c => c.slot === att.bar_account_slot).reduce((s,c)=>s+Number(c.total),0) : 0;

    return `<tr data-id="${att.id}" class="row-${att.status}">
      <td><div class="att-name-cell" title="Doble click para editar">${att.name}</div></td>
      <td>
        <select class="status-select inline-select status-${att.status}" data-id="${att.id}" data-field="status" onchange="updateAttendeeField('${att.id}','status',this.value)">
          ${['invited','crew','in_process','paid'].map(s =>
            `<option value="${s}" ${att.status===s?'selected':''} style="background:#1c1c1c">${statusLabel(s)}</option>`
          ).join('')}
        </select>
      </td>
      <td>${att.bar_account_slot ? `<span class="bar-slot-badge">${padId(att.bar_account_slot)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="editable-cell" data-id="${att.id}" data-field="cedula">${att.cedula || '<span class="empty-val">—</span>'}</td>
      <td class="editable-cell" data-id="${att.id}" data-field="email">${att.email || '<span class="empty-val">—</span>'}</td>
      <td class="editable-cell" data-id="${att.id}" data-field="phone">${att.phone || '<span class="empty-val">—</span>'}</td>
      <td class="editable-cell" data-id="${att.id}" data-field="entry_amount">${att.entry_amount > 0 ? formatMoney(att.entry_amount) : '<span class="empty-val">—</span>'}</td>
      <td>${att.amount_paid > 0 ? `<strong>${formatMoney(att.amount_paid)}</strong>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${consumption > 0 ? formatMoney(consumption) : '<span style="color:var(--muted)">—</span>'}</td>
      <td style="font-size:12px;color:var(--muted)">${att.entry_time ? new Date(att.entry_time).toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
      <td style="font-size:12px;color:var(--muted)">${att.exit_time ? new Date(att.exit_time).toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
      <td>${att.payment_photo_url ? `<button class="btn btn-sm icon-label-btn" onclick="viewPhoto('${att.payment_photo_url}')">${icon('camera',14)}Ver</button>` : '—'}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-sm" onclick="openEditAttendee('${att.id}')" title="Editar">${icon('edit',15)}</button>
          ${barAcc && !barAcc.is_closed && barAcc.total > 0 ? `<button class="btn btn-sm btn-primary" onclick="adminCloseBarAccount('${barAcc.id}',${barAcc.slot})" title="Cobrar cuenta">${icon('card',15)}</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="deleteAttendee('${att.id}')" title="Eliminar">${icon('trash',15)}</button>
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="13" class="empty-state">Sin asistentes. Agregá uno con el botón +</td></tr>';
}

// ─── Bar counters ─────────────────────────────────────────────────────────────
function renderAdminBarCounters() {
  const el = document.getElementById('adminBarCounters');
  if (!el) return;
  const assigned = barAccounts.filter(a => a.attendee_id);
  const open     = assigned.filter(a => !a.is_closed).length;
  const closed   = barClosures.length;
  const openTot  = assigned.filter(a => !a.is_closed).reduce((s,a) => s + Number(a.total||0), 0);
  const closedTot = barClosures.reduce((s,c) => s + Number(c.total||0), 0);
  const grandTot = openTot + closedTot;

  const isMobile = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;

  if (isMobile) {
    // Formato compacto mobile: "$260 (1) Abiertas", "$160 (1) Cerradas", "$420 Total"
    const cfg = [
      { money: formatMoney(openTot),   count: open,   label: 'Abiertas', color: '#1ed760', bg: '#0d1f0d', border: '#1a3a1a' },
      { money: formatMoney(closedTot), count: closed, label: 'Cerradas', color: '#3b82f6', bg: '#0d1420', border: '#1a2a3a' },
      { money: formatMoney(grandTot),  count: null,   label: 'Total',    color: '#f5f5f7', bg: '#181818', border: '#2a2a2a' },
    ];
    el.innerHTML = cfg.map(c => `
      <div style="background:${c.bg};border:1px solid ${c.border};border-radius:10px;padding:8px 12px;display:flex;gap:6px;align-items:baseline;flex:1 1 0;min-width:0">
        <span style="font-size:16px;font-weight:700;color:${c.color};white-space:nowrap">${c.money}${c.count !== null ? ` <span style="font-size:12px;color:${c.color};opacity:.75;font-weight:600">(${c.count})</span>` : ''}</span>
        <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">${c.label}</span>
      </div>`).join('');
    return;
  }

  const cfg = [
    { label: 'Abiertas',      value: open,                color: '#1ed760', bg: '#0d1f0d', border: '#1a3a1a' },
    { label: 'Cerradas',      value: closed,              color: '#3b82f6', bg: '#0d1420', border: '#1a2a3a' },
    { label: 'Total abierto', value: formatMoney(openTot),   color: '#f59e0b', bg: '#1f1900', border: '#3a2e00' },
    { label: 'Total cerrado', value: formatMoney(closedTot), color: '#8b5cf6', bg: '#130d1f', border: '#2a1a3a' },
    { label: 'Total general', value: formatMoney(grandTot),  color: '#f5f5f7', bg: '#181818', border: '#2a2a2a' },
  ];
  el.innerHTML = cfg.map(c => `
    <div style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:10px 16px;display:flex;gap:8px;align-items:center">
      <span style="font-size:22px;font-weight:bold;color:${c.color}">${c.value}</span>
      <span style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">${c.label}</span>
    </div>`).join('');
}

// ─── Bar accounts table ───────────────────────────────────────────────────────
function renderBarTable() {
  const filter = document.getElementById('barFilter')?.value || 'all';
  // Normalizar: quitar #, espacios, y lower.
  const rawSearch = document.getElementById('barSearch')?.value || '';
  const search = rawSearch.trim().replace(/^#+/, '').toLowerCase();
  // Solo mostrar cuentas asignadas a un asistente
  let list = barAccounts.filter(a => {
    if (!a.attendee_id) return false;  // sin asistente → ocultar
    if (filter === 'open')    { if (!(!a.is_closed && a.total > 0)) return false; }
    else if (filter === 'empty')   { if (!(!a.is_closed && a.total === 0)) return false; }
    else if (filter === 'closed')  { if (!a.is_closed) return false; }
    if (search) {
      const slot = String(a.slot);
      const slotPad = slot.padStart(3, '0');
      const name = (a.attendees?.name || '').toLowerCase();
      // Match exacto de slot como número O contains por string
      const searchNum = parseInt(search, 10);
      const numericMatch = Number.isFinite(searchNum) && searchNum === a.slot;
      const hay = `${slot} ${slotPad} ${name}`.toLowerCase();
      if (!numericMatch && !hay.includes(search)) return false;
    }
    return true;
  });

  const tbody = document.getElementById('barAccountsBody');
  if (!tbody) return;
  tbody.innerHTML = list.map(acc => {
    // Historial de cierres para esta cuenta (ordenado más reciente primero)
    const slotClosures = barClosures
      .filter(c => c.slot === acc.slot)
      .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
    const closure  = acc.is_closed ? slotClosures[0] : null;
    const photoUrl = closure?.payment_photo_url || null;
    const holdable = !acc.is_closed && acc.total > 0;

    // Render de un solo cierre (método + detalle)
    const renderOneMethod = (c) => {
      if (!c) return '—';
      if (c.paid_by_slot) return `<span style="color:var(--amber-ios,#ff9f0a)">Pagado por #${String(c.paid_by_slot).padStart(3,'0')}</span>`;
      if (c.payment_method === 'transfer') return `<span class="icon-label-btn" style="gap:6px;display:inline-flex;align-items:center">${icon('bank',14)}Transfer</span>`;
      if (c.payment_method === 'cash')     return `<span class="icon-label-btn" style="gap:6px;display:inline-flex;align-items:center">${icon('cash',14)}Efectivo</span>${c.change_given > 0 ? `<br><span style="font-size:11px;color:var(--muted)">Vuelto: ${formatMoney(c.change_given)}</span>` : ''}`;
      return '—';
    };
    // Si hay >1 cierre → carrusel compacto con flechas izq/der (no agranda la fila)
    let paymentCellHtml;
    if (slotClosures.length > 1) {
      const frames = slotClosures.map((c, i) => `
        <div class="pay-frame${i === 0 ? ' active' : ''}" data-idx="${i}">
          <div class="pay-frame-meta">${i + 1}/${slotClosures.length} · ${formatMoney(c.total)}</div>
          <div class="pay-frame-method">${renderOneMethod(c)}</div>
        </div>`).join('');
      paymentCellHtml = `<div class="pay-carousel" data-total="${slotClosures.length}">
        <button class="pay-arrow pay-arrow-prev" type="button" aria-label="Anterior">‹</button>
        <div class="pay-frames">${frames}</div>
        <button class="pay-arrow pay-arrow-next" type="button" aria-label="Siguiente">›</button>
      </div>`;
    } else {
      paymentCellHtml = renderOneMethod(closure);
    }
    // Foto(s) — si hay más de una, guardamos todas para abrir el visor con flechas
    const photoUrlsForRow = slotClosures.map(c => c.payment_photo_url).filter(Boolean);
    return `
    <tr class="${acc.is_closed ? 'row-closed' : acc.total > 0 ? 'row-active' : ''}${holdable ? ' bar-row-hold' : ''}" ${holdable ? `data-account-id="${acc.id}" data-slot="${acc.slot}"` : ''}>
      <td><strong>${padId(acc.slot)}</strong></td>
      <td>${acc.attendees?.name || '<span style="color:var(--muted)">—</span>'}</td>
      <td><strong>${formatMoney(acc.total)}</strong></td>
      <td>${acc.qty160}</td><td>${acc.qty260}</td><td>${acc.qty360}</td>
      <td>${acc.is_closed
        ? '<span class="status-pill" style="background:#1a3a1a;color:#1ed760">Cerrada</span>'
        : acc.total > 0
          ? '<span class="status-pill" style="background:#3a2e0022;color:#fbbf24">Con saldo</span>'
          : '<span class="status-pill" style="background:#1c1c1c;color:#6b7280">Vacía</span>'
      }</td>
      <td style="font-size:13px">${closure?.closed_by || '—'}</td>
      <td style="font-size:12px;color:var(--muted)">${closure?.closed_at ? new Date(closure.closed_at).toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
      <td style="font-size:13px">${paymentCellHtml}</td>
      <td>${!acc.is_closed && acc.total > 0
        ? `<button class="btn btn-sm btn-primary icon-label-btn" onclick="adminCloseBarAccount('${acc.id}',${acc.slot})">${icon('card',14)}Cobrar</button>`
        : acc.is_closed
          ? `<button class="btn btn-sm" onclick="reopenBarAccount('${acc.id}')">Reabrir</button>`
          : '—'
      }</td>
      <td>${photoUrlsForRow.length
        ? `<button class="btn btn-sm icon-label-btn" onclick="viewPhotos(${JSON.stringify(photoUrlsForRow).replace(/"/g,'&quot;')})">${icon('camera',14)}Ver${photoUrlsForRow.length > 1 ? ` (${photoUrlsForRow.length})` : ''}</button>`
        : '—'
      }</td>
    </tr>`;
  }).join('') || '<tr><td colspan="12" class="empty-state">Sin cuentas asignadas.</td></tr>';

  // Wire up hold-to-close on .bar-row-hold rows (2 seg)
  wireBarRowHold();
  // Wire up pay carousel arrows
  wirePayCarousel();
}

// Navegación del carrusel de pagos dentro de la celda
function wirePayCarousel() {
  document.querySelectorAll('.pay-carousel').forEach(car => {
    if (car._wired) return;
    car._wired = true;
    const frames = car.querySelectorAll('.pay-frame');
    const total  = frames.length;
    let idx = 0;
    const go = (delta) => {
      idx = (idx + delta + total) % total;
      frames.forEach(f => f.classList.toggle('active', Number(f.dataset.idx) === idx));
    };
    car.querySelector('.pay-arrow-prev').addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
    car.querySelector('.pay-arrow-next').addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  });
}

// ─── Hold-to-close on bar rows (solo touch) ──────────────────────────────────
// Solo se activa en dispositivos táctiles. En desktop, el botón "Cobrar" sigue funcionando.
const IS_TOUCH_DEVICE = (typeof window !== 'undefined') &&
  ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);

function wireBarRowHold() {
  if (!IS_TOUCH_DEVICE) return; // desktop: no hold-to-close
  const rows = document.querySelectorAll('tr.bar-row-hold');
  rows.forEach(row => {
    if (row._holdWired) return;
    row._holdWired = true;

    let timer = null;
    let fired = false;
    let ring = null;

    const removeRing = () => {
      if (ring && ring.parentNode) ring.parentNode.removeChild(ring);
      ring = null;
    };

    const start = (ev) => {
      // Sólo touch
      if (ev.pointerType && ev.pointerType !== 'touch') return;
      // Ignorar si se toca un botón/input
      const tgt = ev.target;
      if (tgt.closest('button, a, input, select, textarea')) return;
      fired = false;
      // Crear anillo que se cierra alrededor del dedo
      removeRing();
      ring = document.createElement('div');
      ring.className = 'hold-ring';
      // Coordenadas relativas al viewport
      ring.style.left = (ev.clientX) + 'px';
      ring.style.top  = (ev.clientY) + 'px';
      document.body.appendChild(ring);
      // Forzar reflow y arrancar animación
      // eslint-disable-next-line no-unused-expressions
      ring.offsetWidth;
      ring.classList.add('hold-ring-active');

      row.classList.add('bar-row-holding');
      timer = setTimeout(() => {
        fired = true;
        row.classList.remove('bar-row-holding');
        // Flash rápido de confirmación
        if (ring) ring.classList.add('hold-ring-done');
        const id = row.dataset.accountId;
        const slot = parseInt(row.dataset.slot, 10);
        setTimeout(() => {
          removeRing();
          if (id) adminCloseBarAccount(id, slot);
        }, 180);
      }, 2000);
    };
    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      row.classList.remove('bar-row-holding');
      if (!fired) removeRing();
    };

    row.addEventListener('pointerdown', start);
    row.addEventListener('pointerup', cancel);
    row.addEventListener('pointerleave', cancel);
    row.addEventListener('pointercancel', cancel);
    // Prevent context menu on long-press (mobile)
    row.addEventListener('contextmenu', (e) => { if (fired) e.preventDefault(); });
  });
}

// ─── Expenses ─────────────────────────────────────────────────────────────────
function renderExpenses() {
  const tbody = document.getElementById('expensesBody');
  if (!tbody) return;
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const countItems = expenses.length;

  // Counter (sólo total, sin ítems)
  const counters = document.getElementById('expensesCounters');
  if (counters) {
    const cfg = [
      { label: 'Total gastos', value: formatMoney(total), color: '#ff453a', bg: '#1f0d0d', border: '#3a1a1a' },
    ];
    counters.innerHTML = cfg.map(c => `
      <div style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:10px 16px;display:flex;gap:8px;align-items:center">
        <span style="font-size:22px;font-weight:bold;color:${c.color}">${c.value}</span>
        <span style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">${c.label}</span>
      </div>`).join('');
  }

  const sortedExpenses = [...expenses].sort((a, b) =>
    String(a.description || '').localeCompare(String(b.description || ''), 'es', { sensitivity: 'base' })
  );
  tbody.innerHTML = sortedExpenses.map(exp => `
    <tr>
      <td class="editable-cell" data-entity="expense" data-id="${exp.id}" data-field="description" data-type="text">${exp.description}</td>
      <td class="editable-cell" data-entity="expense" data-id="${exp.id}" data-field="amount" data-type="number"><strong>${formatMoney(exp.amount)}</strong></td>
      <td style="font-size:12px;color:var(--muted)">${new Date(exp.created_at).toLocaleDateString('es-UY')}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-sm btn-danger" onclick="deleteExpense('${exp.id}')" title="Eliminar">${icon('trash',15)}</button>
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin gastos registrados.</td></tr>';
}

// ─── Events ───────────────────────────────────────────────────────────────────
function renderEvents() {
  const tbody = document.getElementById('eventsBody');
  if (!tbody) return;
  tbody.innerHTML = events.map(ev => `
    <tr>
      <td><strong>${ev.name}</strong></td>
      <td>${ev.date}</td>
      <td>${ev.is_active
        ? '<span class="status-pill" style="background:#1a3a1a;color:#1ed760">ACTIVO</span>'
        : '<span class="status-pill" style="background:#1c1c1c;color:#6b7280">Inactivo</span>'
      }</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-sm btn-danger" onclick="deleteEvent('${ev.id}')" title="Eliminar">${icon('trash',15)}</button>
          ${!ev.is_active ? `<button class="btn btn-sm btn-success" onclick="activateEvent('${ev.id}')">Activar</button>` : ''}
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin eventos. Creá uno.</td></tr>';
}

// ─── Inline cell editing ──────────────────────────────────────────────────────
// Soporta entidades: attendee (default), expense, user.
// Atajo: click simple entra a edición. Enter guarda, Esc cancela, blur guarda.
document.addEventListener('click', async (e) => {
  const cell = e.target.closest('.editable-cell');
  if (!cell) return;
  // Si ya está editando, no hacer nada
  if (cell.querySelector('input')) return;
  const entity = cell.dataset.entity || 'attendee';
  const id     = cell.dataset.id;
  const field  = cell.dataset.field;
  const type   = cell.dataset.type || (field === 'entry_amount' || field === 'amount' ? 'number' : 'text');

  // Resolver valor actual según la entidad
  let current = '';
  if (entity === 'attendee') {
    const att = attendees.find(a => a.id === id);
    if (!att) return;
    current = att[field] ?? '';
  } else if (entity === 'expense') {
    const exp = expenses.find(x => x.id === id);
    if (!exp) return;
    current = exp[field] ?? '';
  } else if (entity === 'user') {
    const u = (typeof appUsers !== 'undefined' ? appUsers : []).find(x => x.id === id);
    if (!u) return;
    current = u[field] ?? '';
  }

  const input     = document.createElement('input');
  input.type      = type === 'number' ? 'number' : (type === 'email' ? 'email' : 'text');
  input.value     = current;
  input.className = 'inline-input';
  cell.innerHTML  = '';
  cell.appendChild(input);
  input.focus();
  input.select?.();

  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const raw = input.value;
    const val = type === 'number' ? (parseFloat(raw) || 0) : String(raw).trim();
    if (entity === 'attendee') {
      await updateAttendeeField(id, field, val);
    } else if (entity === 'expense') {
      await updateExpenseField(id, field, val);
    } else if (entity === 'user') {
      await updateUserField(id, field, val);
    }
  };
  const cancel = () => {
    if (saved) return;
    saved = true;
    if (entity === 'attendee') renderAttendeesTable();
    else if (entity === 'expense') renderExpenses();
    else if (entity === 'user') renderUsers();
  };
  input.addEventListener('blur',  save);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') input.blur();
    else if (ev.key === 'Escape') { cancel(); }
  });
});

async function updateExpenseField(id, field, value) {
  const db = getDb();
  const { error } = await db.from('expenses').update({ [field]: value }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); renderExpenses(); return; }
  const i = expenses.findIndex(x => x.id === id);
  if (i >= 0) expenses[i][field] = value;
  renderExpenses();
}

async function updateUserField(id, field, value) {
  // El email vive en auth.users (no editable desde la tabla profiles) — avisar.
  if (field === 'email') {
    toast('El email no se puede editar desde acá. Borrá el usuario y creá uno nuevo.', 'warning');
    renderUsers();
    return;
  }
  const db = getDb();
  const { error } = await db.from('profiles').update({ [field]: value }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); renderUsers(); return; }
  if (typeof appUsers !== 'undefined') {
    const i = appUsers.findIndex(u => u.id === id);
    if (i >= 0) appUsers[i][field] = value;
  }
  renderUsers();
}

async function updateAttendeeField(id, field, value) {
  // Validación: si se asigna un slot bloqueado o duplicado, rechazar
  if (field === 'bar_account_slot') {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) {
      if (isSlotBlocked(n)) {
        toast(`Tarjeta ${padId(n)} está bloqueada`, 'error');
        renderAttendeesTable();
        return;
      }
      const dup = getAttendeeWithSlot(n, id);
      if (dup) {
        toast(`Tarjeta ${padId(n)} ya asignada a ${dup.name}`, 'error');
        renderAttendeesTable();
        return;
      }
    }
  }
  const db = getDb();
  const { error } = await db.from('attendees').update({ [field]: value }).eq('id', id);
  if (error) toast('Error al actualizar: ' + error.message, 'error');
  else {
    const i = attendees.findIndex(a => a.id === id);
    if (i >= 0) attendees[i][field] = value;
    renderAttendeesTable();
  }
}

// ─── Get next available bar slot ──────────────────────────────────────────────
// Considera tanto los slots ya asignados a asistentes como los bar_accounts existentes.
// Devuelve el primer hueco libre. No hay cap duro: si llegás a 50k, devuelve 50001.
function getNextAvailableBarSlot() {
  const used = new Set([
    ...attendees.map(a => a.bar_account_slot).filter(Boolean),
    ...getBlockedSlots(),
  ]);
  const maxExisting = barAccounts.reduce((m, a) => Math.max(m, a.slot || 0), 0);
  // Buscar el primer hueco (1..maxExisting+1) saltando bloqueadas y ocupadas
  for (let i = 1; i <= maxExisting + 1; i++) {
    if (!used.has(i)) return i;
  }
  // Si todas hasta maxExisting están usadas/bloqueadas, buscar más allá
  let next = maxExisting + 1;
  while (used.has(next)) next++;
  return next;
}

// ─── Asegurar que exista una bar_account para un slot ─────────────────────────
// Si el slot ya existe en bar_accounts, sólo se vincula el attendee_id.
// Si no existe (ej: el usuario asigna slot 250 cuando sólo hay 120), se crea.
async function ensureBarAccountSlot(slot, attendeeId = null, eventIdOverride = null) {
  const eventId = eventIdOverride || currentEvent()?.id;
  if (!eventId || !slot) return;
  const db = getDb();
  // Intentar UPDATE primero — si la fila ya existe (ej: init_bar_accounts ya creó el slot),
  // sólo vinculamos el attendee_id sin tocar los contadores.
  const { data: updated, error: updErr } = await db.from('bar_accounts')
    .update({ attendee_id: attendeeId })
    .eq('event_id', eventId)
    .eq('slot', slot)
    .select('id');
  if (updErr) { console.warn('[ensureBarAccountSlot] update error:', updErr.message); return; }
  if (updated && updated.length) return; // existía y quedó vinculada

  // No existía → crear
  const { error } = await db.from('bar_accounts').upsert({
    event_id:    eventId,
    slot,
    total:       0,
    qty160:      0,
    qty260:      0,
    qty360:      0,
    is_closed:   false,
    attendee_id: attendeeId,
  }, { onConflict: 'event_id,slot' });
  if (error) console.warn('[ensureBarAccountSlot] upsert error:', error.message);
}

// ─── Add/Edit attendee modal ──────────────────────────────────────────────────
function openAddAttendee() {
  const nextSlot = getNextAvailableBarSlot();
  showModal(`
    <h3 style="margin:0 0 18px">Agregar asistente</h3>
    <form id="attForm" autocomplete="off">
      <div class="form-grid">
        <div class="form-group"><label>Nombre *</label><input name="name" required/></div>
        <div class="form-group"><label>Estado</label>
          <select name="status">
            <option value="invited">Invitado</option><option value="crew">Crew</option>
            <option value="in_process">En proceso</option><option value="paid" selected>Pago</option>
          </select>
        </div>
        <div class="form-group"><label>Cuenta barra #</label><input name="bar_account_slot" type="number" value="${nextSlot}" min="1" placeholder="Nº de barra (se crea automáticamente)"/></div>
        <div class="form-group"><label>Cédula</label><input name="cedula"/></div>
        <div class="form-group"><label>Email</label><input name="email" type="email"/></div>
        <div class="form-group"><label>Teléfono</label><input name="phone"/></div>
        <div class="form-group"><label>Pago entrada $</label><input name="entry_amount" type="number" min="0" value="700"/></div>
        <div class="form-group"><label>Notas</label><input name="notes"/></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Guardar</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </form>
  `);
  // Precio automático según estado
  document.querySelector('#attForm [name=status]').addEventListener('change', function () {
    const amountInput = document.querySelector('#attForm [name=entry_amount]');
    if (this.value === 'invited' || this.value === 'crew') {
      amountInput.value = 0;
    } else if (amountInput.value == 0) {
      amountInput.value = 700;
    }
  });

  const submitBtn = document.querySelector('#attForm button[type=submit]');
  document.getElementById('attForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return; // Prevent double-submit
    submitBtn.disabled = true;
    try {
      const fd  = new FormData(e.target);
      const obj = Object.fromEntries(fd.entries());
      if (!activeEvent) { toast('No hay evento activo', 'error'); return; }
      obj.event_id = currentEvent().id;
      if (!obj.bar_account_slot) delete obj.bar_account_slot; else obj.bar_account_slot = parseInt(obj.bar_account_slot);
      if (!obj.entry_amount) obj.entry_amount = 0; else obj.entry_amount = parseFloat(obj.entry_amount);
      // Validación: no permitir asignar una tarjeta bloqueada o ya asignada
      if (obj.bar_account_slot) {
        if (isSlotBlocked(obj.bar_account_slot)) {
          toast(`La tarjeta ${padId(obj.bar_account_slot)} está bloqueada`, 'error');
          return;
        }
        const dup = getAttendeeWithSlot(obj.bar_account_slot);
        if (dup) {
          toast(`La tarjeta ${padId(obj.bar_account_slot)} ya está asignada a ${dup.name}`, 'error');
          return;
        }
      }
      // Chequeo contra blacklist — recordatorio, permite continuar si el admin confirma
      const ok = await confirmIfBlacklisted({ name: obj.name, cedula: obj.cedula, email: obj.email, phone: obj.phone });
      if (!ok) return;
      const db = getDb();
      const { data: newAtt, error } = await db.from('attendees').insert(obj).select().single();
      if (error) toast('Error: ' + error.message, 'error');
      else {
        // Vincular (o auto-crear) la cuenta de barra con el asistente
        if (newAtt.bar_account_slot) {
          await ensureBarAccountSlot(newAtt.bar_account_slot, newAtt.id);
        }
        toast('Asistente agregado', 'success');
        closeModal();
        await loadAll();
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function openEditAttendee(id) {
  const att = attendees.find(a => a.id === id);
  if (!att) return;
  showModal(`
    <h3 style="margin:0 0 18px">Editar: ${att.name}</h3>
    <form id="editAttForm" autocomplete="off">
      <div class="form-grid">
        <div class="form-group"><label>Nombre *</label><input name="name" value="${att.name || ''}" required/></div>
        <div class="form-group"><label>Estado</label>
          <select name="status">
            ${['invited','crew','in_process','paid'].map(s=>`<option value="${s}" ${att.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Cuenta barra #</label><input name="bar_account_slot" type="number" value="${att.bar_account_slot||''}"/></div>
        <div class="form-group"><label>Cédula</label><input name="cedula" value="${att.cedula||''}"/></div>
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${att.email||''}"/></div>
        <div class="form-group"><label>Teléfono</label><input name="phone" value="${att.phone||''}"/></div>
        <div class="form-group"><label>Pago entrada $</label><input name="entry_amount" type="number" value="${att.entry_amount||0}"/></div>
        <div class="form-group"><label>Total pagado $</label><input name="amount_paid" type="number" value="${att.amount_paid||0}"/></div>
        <div class="form-group"><label>Notas</label><input name="notes" value="${att.notes||''}"/></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Guardar</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </form>
  `);
  document.getElementById('editAttForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const obj = Object.fromEntries(fd.entries());
    if (!obj.bar_account_slot) obj.bar_account_slot = null; else obj.bar_account_slot = parseInt(obj.bar_account_slot);
    obj.entry_amount = parseFloat(obj.entry_amount) || 0;
    obj.amount_paid  = parseFloat(obj.amount_paid)  || 0;
    // Validación: tarjeta bloqueada o duplicada
    if (obj.bar_account_slot) {
      if (isSlotBlocked(obj.bar_account_slot)) {
        toast(`La tarjeta ${padId(obj.bar_account_slot)} está bloqueada`, 'error');
        return;
      }
      const dup = getAttendeeWithSlot(obj.bar_account_slot, id);
      if (dup) {
        toast(`La tarjeta ${padId(obj.bar_account_slot)} ya está asignada a ${dup.name}`, 'error');
        return;
      }
    }
    // Chequeo blacklist si cambió algún identificador
    const changedIdentity = (obj.name !== att.name) || (obj.cedula !== att.cedula) || (obj.email !== att.email) || (obj.phone !== att.phone);
    if (changedIdentity) {
      const ok = await confirmIfBlacklisted({ name: obj.name, cedula: obj.cedula, email: obj.email, phone: obj.phone });
      if (!ok) return;
    }
    const db = getDb();

    const prevSlot = att.bar_account_slot || null;
    const newSlot  = obj.bar_account_slot;

    const { error } = await db.from('attendees').update(obj).eq('id', id);
    if (error) { toast('Error: ' + error.message, 'error'); return; }

    // Si cambió el slot: desvincular el anterior y vincular/crear el nuevo
    if (prevSlot !== newSlot) {
      if (prevSlot) {
        await db.from('bar_accounts')
          .update({ attendee_id: null })
          .eq('event_id', currentEvent().id)
          .eq('slot', prevSlot);
      }
      if (newSlot) {
        await ensureBarAccountSlot(newSlot, id);
      }
    }

    toast('Guardado', 'success');
    closeModal();
    await loadAll();
  });
}

async function deleteAttendee(id) {
  if (!confirm('¿Eliminar este asistente?')) return;
  const db  = getDb();
  const att = attendees.find(a => a.id === id);

  // Primero desvincular la cuenta de barra (evita error de FK)
  if (att?.bar_account_slot) {
    await db.from('bar_accounts')
      .update({ attendee_id: null })
      .eq('event_id', currentEvent().id)
      .eq('slot', att.bar_account_slot);
  }

  const { error } = await db.from('attendees').delete().eq('id', id);
  if (error) toast('Error: ' + error.message, 'error');
  else { attendees = attendees.filter(a => a.id !== id); renderAttendeesTable(); }
}

// ─── Reopen bar account ──────────────────────────────────────────────────────
async function reopenBarAccount(accId) {
  if (!confirm('¿Reabrir esta cuenta de barra?')) return;
  const db = getDb();
  const { error } = await db.from('bar_accounts').update({ is_closed: false }).eq('id', accId);
  if (error) toast('Error: ' + error.message, 'error');
  else { toast('Cuenta reabierta', 'success'); await loadAll(); }
}

// ─── Admin close bar account ──────────────────────────────────────────────────
// Replica el flujo de la barra (app.js): método + opcional "pagar por otros".
async function adminCloseBarAccount(barAccountId, slot) {
  const acc = barAccounts.find(a => a.id === barAccountId);
  const ownTotal = Number(acc?.total || 0);

  // 1. Método + checkbox "pagar por otros"
  const methodResult = await showPaymentMethodSelector(ownTotal, true);
  if (!methodResult) return;

  // 2. Si marcó "pagar por otros" → seleccionar cuentas
  let coveredAccounts = [];
  let combinedTotal   = ownTotal;
  if (methodResult.payForOthers) {
    const openOthers = barAccounts.filter(a => !a.is_closed && a.attendee_id && a.total > 0 && a.id !== barAccountId);
    const othersResult = await showPayForOthersScreen(slot, ownTotal, openOthers);
    if (othersResult === null) return;
    coveredAccounts = othersResult.coveredAccounts;
    combinedTotal   = othersResult.combinedTotal;
  }

  // 3. Si es efectivo → calculadora con total final
  let cashReceived = methodResult.cashReceived;
  let changeGiven  = methodResult.changeGiven;
  if (methodResult.method === 'cash' && methodResult.payForOthers) {
    const cashResult = await showCashCalculator(combinedTotal);
    if (!cashResult) return;
    cashReceived = cashResult.cashReceived;
    changeGiven  = cashResult.changeGiven;
  }

  // 4. Transferencia → foto
  let photoUrl = null;
  if (methodResult.method === 'transfer') {
    const photoBlob = await openCamera(true);
    if (!photoBlob) return;
    photoUrl = await uploadPaymentPhoto(photoBlob, currentEvent().id, slot);
  }

  // 5. Cerrar cuenta principal
  const db = getDb();
  const { data, error } = await db.rpc('close_bar_account', {
    p_account_id: barAccountId, p_closed_by: 'admin', p_photo_url: photoUrl,
  });
  if (error || !data?.ok) { toast(data?.error || error?.message || 'Error', 'error'); return; }

  await db.from('bar_closures')
    .update({ payment_method: methodResult.method, cash_received: cashReceived, change_given: changeGiven })
    .eq('event_id', currentEvent().id).eq('slot', slot);

  // 6. Cerrar cuentas de otros
  for (const other of coveredAccounts) {
    await db.rpc('close_bar_account', { p_account_id: other.id, p_closed_by: 'admin', p_photo_url: photoUrl });
    await db.from('bar_closures')
      .update({ payment_method: methodResult.method, paid_by_slot: slot })
      .eq('event_id', currentEvent().id).eq('slot', other.slot);
  }

  const extra = coveredAccounts.length ? ` + ${coveredAccounts.length} cuenta${coveredAccounts.length > 1 ? 's' : ''} ajena${coveredAccounts.length > 1 ? 's' : ''}` : '';
  toast(`Cuenta ${padId(slot)} cobrada — ${formatMoney(combinedTotal)}${extra}`, 'success');
  await loadAll();
}

// ─── Expenses ─────────────────────────────────────────────────────────────────
function openAddExpense() {
  showModal(`
    <h3 style="margin:0 0 18px">Agregar gasto</h3>
    <form id="expenseForm">
      <div class="form-group"><label>Descripción *</label><input name="description" required/></div>
      <div class="form-group"><label>Monto *</label><input name="amount" type="number" min="0" step="0.01" required/></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Agregar</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </form>
  `);
  document.getElementById('expenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const db = getDb();
    const { error } = await db.from('expenses').insert({
      event_id: currentEvent().id,
      description: fd.get('description'),
      amount: parseFloat(fd.get('amount')),
    });
    if (error) toast('Error: ' + error.message, 'error');
    else { toast('Gasto agregado', 'success'); closeModal(); await loadAll(); }
  });
}

async function deleteExpense(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  const db = getDb();
  const { error } = await db.from('expenses').delete().eq('id', id);
  if (error) toast('Error: ' + error.message, 'error');
  else { expenses = expenses.filter(e => e.id !== id); renderExpenses(); renderDashboard(); }
}

function openEditExpense(id) {
  const exp = expenses.find(e => e.id === id);
  if (!exp) return;
  showModal(`
    <h3 style="margin:0 0 18px">Editar gasto</h3>
    <form id="expenseEditForm">
      <div class="form-group"><label>Descripción *</label><input name="description" value="${(exp.description||'').replace(/"/g,'&quot;')}" required/></div>
      <div class="form-group"><label>Monto *</label><input name="amount" type="number" min="0" step="0.01" value="${exp.amount}" required/></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Guardar</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </form>
  `);
  document.getElementById('expenseEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const db = getDb();
    const { error } = await db.from('expenses').update({
      description: fd.get('description'),
      amount: parseFloat(fd.get('amount')),
    }).eq('id', id);
    if (error) toast('Error: ' + error.message, 'error');
    else { toast('Gasto actualizado', 'success'); closeModal(); await loadAll(); }
  });
}
window.openEditExpense = openEditExpense;

// ─── Events management ────────────────────────────────────────────────────────
// Defaults al crear un nuevo evento
const DEFAULT_CREW = [
  // Sin cuenta en el bar
  { name: 'Dave',   status: 'crew', bar_account_slot: null },
  { name: 'Angus',  status: 'crew', bar_account_slot: null },
  { name: 'Cicero', status: 'crew', bar_account_slot: null },
  // Con cuenta en el bar
  { name: 'Daniel Anselmi',   status: 'crew', bar_account_slot: 1 },
  { name: 'Junion Rupenian',  status: 'crew', bar_account_slot: 2 },
  { name: 'Lautaro Moreno',   status: 'crew', bar_account_slot: 3 },
  { name: 'Matias Nario',     status: 'crew', bar_account_slot: 4 },
];
const DEFAULT_EXPENSES = [
  'PH',
  'Vasos',
  'Personal barra',
  'Personal seguridad',
  'Limpieza',
  'Distribuidora',
];
const DEFAULT_BAR_ACCOUNTS = 150;

function openNewEvent() {
  showModal(`
    <h3 style="margin:0 0 18px">Nuevo evento</h3>
    <form id="eventForm">
      <div class="form-group"><label>Nombre del evento *</label><input name="name" required autofocus/></div>
      <div class="form-group"><label>Fecha *</label><input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required/></div>
      <p style="font-size:12px;color:#8e8e93;margin:0 0 16px;line-height:1.4">
        Se crean ${DEFAULT_BAR_ACCOUNTS} cuentas de barra, el crew habitual y los gastos por defecto (todos en 0).
      </p>
      <div class="modal-actions">
        <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Crear y activar</button>
      </div>
    </form>
  `);
  document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const db = getDb();
    // Desactivar los demás
    await db.from('events').update({ is_active: false }).eq('is_active', true);
    // Crear evento
    const { data: newEvent, error } = await db.from('events')
      .insert({ name: fd.get('name'), date: fd.get('date'), is_active: true })
      .select().single();
    if (error) { toast('Error: ' + error.message, 'error'); return; }

    // Inicializar cuentas de barra (150 por defecto)
    await db.rpc('init_bar_accounts', { p_event_id: newEvent.id, p_count: DEFAULT_BAR_ACCOUNTS });

    // Insertar crew por defecto (asistentes)
    const crewRows = DEFAULT_CREW.map(c => ({
      event_id: newEvent.id,
      name: c.name,
      status: c.status,
      bar_account_slot: c.bar_account_slot,
      entry_amount: 0,
    }));
    const { data: insertedCrew, error: crewErr } = await db.from('attendees').insert(crewRows).select();
    if (crewErr) console.warn('Crew default:', crewErr.message);
    // Vincular bar_accounts a los crew con slot — pasamos newEvent.id explícitamente
    // porque activeEvent global todavía no apunta al nuevo evento.
    for (const a of (insertedCrew || [])) {
      if (a.bar_account_slot) await ensureBarAccountSlot(a.bar_account_slot, a.id, newEvent.id);
    }

    // Insertar gastos por defecto (en 0)
    const expenseRows = DEFAULT_EXPENSES.map(d => ({
      event_id: newEvent.id,
      description: d,
      amount: 0,
    }));
    await db.from('expenses').insert(expenseRows);

    // Tarea default: Chequear PH
    await db.from('tasks').insert({
      event_id: newEvent.id, name: 'Chequear PH', assigned_to: null,
      is_active: true, remind: true, remind_freq_minutes: 60,
      remind_from: '22:00', remind_until: '04:00',
    });

    // Event settings default (incluye blocked_slots vacío)
    const settingsPayload = { event_id: newEvent.id, door_can_charge: false };
    if (_blockedSlotsColSupported) settingsPayload.blocked_slots = [];
    const { error: settingsErr } = await db.from('event_settings').insert(settingsPayload);
    if (settingsErr && _isMissingBlockedSlotsError(settingsErr)) {
      _blockedSlotsColSupported = false;
      await db.from('event_settings').insert({ event_id: newEvent.id, door_can_charge: false });
    }

    toast(`Evento "${newEvent.name}" creado con ${DEFAULT_BAR_ACCOUNTS} cuentas y crew por defecto`, 'success');
    closeModal();
    window.location.reload();
  });
}

async function activateEvent(id) {
  if (!confirm('¿Activar este evento? El evento actual quedará inactivo.')) return;
  const db = getDb();
  await db.from('events').update({ is_active: false }).eq('is_active', true);
  await db.from('events').update({ is_active: true }).eq('id', id);
  toast('Evento activado', 'success');
  window.location.reload();
}

async function deleteEvent(id) {
  if (!confirm('¿Eliminar este evento? Se borrarán todas sus cuentas y asistentes.')) return;
  const db = getDb();
  const { error } = await db.from('events').delete().eq('id', id);
  if (error) toast('Error: ' + error.message, 'error');
  else { toast('Evento eliminado', 'success'); await loadAll(); }
}

async function initBarAccounts() {
  if (!activeEvent) { toast('No hay evento activo', 'error'); return; }
  const n = window.prompt('¿Cuántas cuentas de barra crear?', String(DEFAULT_BAR_ACCOUNTS));
  if (!n) return;
  const count = parseInt(n);
  if (isNaN(count) || count < 1) { toast('Número inválido', 'error'); return; }
  if (!confirm(`Esto reemplazará todas las cuentas actuales con ${count} nuevas. ¿Confirmar?`)) return;
  const db = getDb();
  const { data, error } = await db.rpc('init_bar_accounts', { p_event_id: currentEvent().id, p_count: count });
  if (error) toast('Error: ' + error.message, 'error');
  else { toast(`${count} cuentas creadas`, 'success'); await loadAll(); }
}

// ─── CSV Import ───────────────────────────────────────────────────────────────
async function importCsv(file) {
  if (!activeEvent) { toast('No hay evento activo', 'error'); return; }
  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) { toast('CSV vacío o sin datos', 'error'); return; }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    if (!vals[0]) continue;
    const obj = { event_id: currentEvent().id };
    headers.forEach((h, idx) => {
      if (vals[idx] !== undefined && vals[idx] !== '') obj[h] = vals[idx];
    });
    if (obj.bar_account_slot) obj.bar_account_slot = parseInt(obj.bar_account_slot);
    if (obj.entry_amount)     obj.entry_amount = parseFloat(obj.entry_amount);
    rows.push(obj);
  }

  if (!rows.length) { toast('No se encontraron filas válidas', 'error'); return; }
  const db = getDb();
  const { data: inserted, error } = await db.from('attendees').insert(rows).select();
  if (error) { toast('Error importando: ' + error.message, 'error'); return; }

  // Auto-crear / vincular bar_accounts para todos los slots importados
  for (const a of (inserted || [])) {
    if (a.bar_account_slot) await ensureBarAccountSlot(a.bar_account_slot, a.id);
  }

  toast(`${rows.length} asistentes importados`, 'success');
  await loadAll();
}

// ─── Export Excel ─────────────────────────────────────────────────────────────
function exportToExcel() {
  if (typeof XLSX === 'undefined') { toast('Librería Excel no disponible', 'error'); return; }
  const wb = XLSX.utils.book_new();

  // Summary
  const barT    = barClosures.reduce((s,c)=>s+Number(c.total),0) + barAccounts.filter(a=>!a.is_closed).reduce((s,a)=>s+Number(a.total),0);
  const entryT  = attendees.reduce((s,a)=>s+Number(a.entry_amount||0),0);
  const expT    = expenses.reduce((s,e)=>s+Number(e.amount),0);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Why Not — Resumen completo'], ['Evento', activeEvent?.name || ''], ['Fecha', activeEvent?.date || ''],
    [], ['Total barra', barT], ['Total entradas', entryT], ['Gastos', expT], ['TOTAL NETO', barT+entryT-expT],
  ]), 'Resumen');

  // Attendees
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Nombre','Estado','Barra #','Cédula','Email','Teléfono','Entrada $','Total pagado','Ingresó','Salió'],
    ...attendees.map(a=>[a.name,statusLabel(a.status),a.bar_account_slot,a.cedula,a.email,a.phone,a.entry_amount,a.amount_paid,a.entry_time,a.exit_time]),
  ]), 'Asistentes');

  // Closures
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Cuenta','Nombre','Total','#160','#260','#360','Cerrada por','Hora'],
    ...barClosures.map(c=>[padId(c.slot),c.attendees?.name||'',c.total,c.qty160,c.qty260,c.qty360,c.closed_by,c.closed_at]),
  ]), 'Cuentas cobradas');

  // Cuentas abiertas con saldo
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Cuenta','Nombre vinculada','Total','#160','#260','#360'],
    ...barAccounts
      .filter(a => !a.is_closed && a.total > 0)
      .map(a => [padId(a.slot), a.attendees?.name || '', a.total, a.qty160, a.qty260, a.qty360]),
  ]), 'Cuentas abiertas');

  // Todas las cuentas (estado completo)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Cuenta','Nombre','Total','#160','#260','#360','Estado'],
    ...barAccounts.map(a => [
      padId(a.slot), a.attendees?.name || '', a.total, a.qty160, a.qty260, a.qty360,
      a.is_closed ? 'Cerrada' : a.total > 0 ? 'Abierta con saldo' : 'Vacía',
    ]),
  ]), 'Todas las cuentas');

  // Expenses
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Descripción','Monto','Fecha'],
    ...expenses.map(e=>[e.description,e.amount,e.created_at]),
  ]), 'Gastos');

  XLSX.writeFile(wb, `whynot-admin-${activeEvent?.date || 'evento'}.xlsx`);
}

// ─── Modal helper ─────────────────────────────────────────────────────────────
function showModal(html) {
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
  document.body.classList.add('modal-open');
  // Apply form styles
  document.querySelectorAll('#modalBody input, #modalBody select').forEach(el => {
    el.style.cssText = 'width:100%;background:var(--panel-2);border:1px solid var(--line);color:var(--text);padding:11px 14px;border-radius:12px;font-size:15px;display:block;margin-top:4px';
  });
}
function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.body.classList.remove('modal-open');
  // Workaround iOS: restaurar scroll/viewport después del teclado del modal.
  // A veces la página queda desplazada hacia arriba y la barra superior queda oculta
  // por la status bar. Forzamos scroll al tope del área principal.
  try {
    const scroll = document.querySelector('.main-scroll');
    if (scroll) scroll.scrollTop = Math.min(scroll.scrollTop, scroll.scrollTop); // no-op
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  } catch (_) {}
}

// ─── Photo viewer ─────────────────────────────────────────────────────────────
function viewPhoto(url) { viewPhotos([url]); }
window.viewPhoto = viewPhoto;

// Visor con flechas para una o más fotos de comprobantes.
function viewPhotos(urls) {
  if (!Array.isArray(urls) || !urls.length) return;
  let idx = 0;
  const render = () => {
    const u = urls[idx];
    document.getElementById('modalBody').innerHTML = `
      <div style="text-align:center;position:relative">
        <h3 style="margin:0 0 16px;font-size:20px">Comprobante de pago ${urls.length > 1 ? `<span style="font-size:13px;color:#8e8e93">${idx + 1}/${urls.length}</span>` : ''}</h3>
        <div class="photo-viewer">
          ${urls.length > 1 ? '<button type="button" class="photo-arrow photo-arrow-prev" aria-label="Anterior">‹</button>' : ''}
          <img src="${u}" style="max-width:100%;border-radius:14px;max-height:65vh;object-fit:contain;display:block;margin:0 auto"/>
          ${urls.length > 1 ? '<button type="button" class="photo-arrow photo-arrow-next" aria-label="Siguiente">›</button>' : ''}
        </div>
        <div style="margin-top:18px">
          <a href="${u}" target="_blank" class="btn btn-sm icon-label-btn" style="display:inline-flex;text-decoration:none">${icon('external',14)}Abrir en nueva pestaña</a>
        </div>
      </div>
    `;
    document.getElementById('modalOverlay').classList.remove('hidden');
    const prev = document.querySelector('.photo-arrow-prev');
    const next = document.querySelector('.photo-arrow-next');
    if (prev) prev.addEventListener('click', () => { idx = (idx - 1 + urls.length) % urls.length; render(); });
    if (next) next.addEventListener('click', () => { idx = (idx + 1) % urls.length; render(); });
  };
  render();
}
window.viewPhotos = viewPhotos;

// ─── Gestión de usuarios ──────────────────────────────────────────────────────

async function getAuthToken() {
  const { data: { session } } = await getDb().auth.getSession();
  return session?.access_token || null;
}

async function loadUsers() {
  const tbody = document.getElementById('usersBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="padding:30px">Cargando usuarios…</td></tr>';

  const token = await getAuthToken();
  if (!token) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Sin sesión activa.</td></tr>'; return; }

  try {
    const res  = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    appUsers = json.users;
    renderUsers();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="color:#ef4444">Error: ${e.message}</td></tr>`;
  }
}

const ROLE_LABELS = { admin: 'Admin', bar: 'Barra', door: 'Portero' };
const ROLE_COLORS = { admin: '#ff9f0a', bar: '#30d158', door: '#64a9ff' };

function renderUsers() {
  const tbody = document.getElementById('usersBody');
  if (!tbody) return;

  if (!appUsers.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Sin usuarios. Creá uno con el botón +</td></tr>';
    return;
  }

  tbody.innerHTML = appUsers.map(u => `
    <tr>
      <td class="editable-cell" data-entity="user" data-id="${u.id}" data-field="display_name" data-type="text">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:${ROLE_COLORS[u.role]||'#8e8e93'};display:inline-flex">${icon(ROLE_ICON[u.role]||'user',16)}</span>
          <span style="font-weight:600">${u.display_name || '—'}</span>
        </div>
      </td>
      <td style="color:#8e8e93;font-size:13px">${u.email}</td>
      <td>
        <select class="inline-select"
          style="border-color:${ROLE_COLORS[u.role]||'rgba(255,255,255,.1)'};color:${ROLE_COLORS[u.role]||'#f5f5f7'}"
          onchange="updateUserRole('${u.id}',this.value)">
          <option value="bar"  ${u.role==='bar'  ?'selected':''}>Barra</option>
          <option value="door" ${u.role==='door' ?'selected':''}>Portero</option>
          <option value="admin"${u.role==='admin'?'selected':''}>Admin</option>
        </select>
      </td>
      <td style="font-size:12px;color:#8e8e93">
        ${u.last_sign_in ? new Date(u.last_sign_in).toLocaleString('es-UY',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : 'Nunca'}
      </td>
      <td>
        <div class="row-actions">
          <button class="btn btn-sm icon-label-btn" onclick="openChangePasswordModal('${u.id}','${u.email.replace(/'/g,"&#39;")}')"
            title="Cambiar contraseña">${icon('key',14)}Clave</button>
          <button class="btn btn-sm btn-danger" onclick="deleteAppUser('${u.id}','${u.email.replace(/'/g,"&#39;")}')" title="Eliminar">${icon('trash',15)}</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function updateUserRole(userId, newRole) {
  const db = getDb();
  const { error } = await db.from('profiles').update({ role: newRole }).eq('id', userId);
  if (error) { toast('Error al cambiar rol: ' + error.message, 'error'); return; }
  const u = appUsers.find(u => u.id === userId);
  if (u) u.role = newRole;
  renderUsers();
  toast(`Rol actualizado a ${ROLE_LABELS[newRole]}`, 'success');
}

function openEditUserName(userId, currentName) {
  showModal(`
    <h3 style="margin:0 0 18px">Editar nombre</h3>
    <form id="editNameForm">
      <div class="form-group">
        <label>Nombre para mostrar</label>
        <input id="newDisplayName" type="text" value="${currentName}" required placeholder="Ej: Barra 1"/>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Guardar</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </form>
  `);
  document.getElementById('editNameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = document.getElementById('newDisplayName').value.trim();
    if (!newName) return;
    const db = getDb();
    const { error } = await db.from('profiles').update({ display_name: newName }).eq('id', userId);
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    const u = appUsers.find(u => u.id === userId);
    if (u) u.display_name = newName;
    closeModal();
    renderUsers();
    toast('Nombre actualizado', 'success');
  });
}

async function deleteAppUser(userId, email) {
  if (!confirm(`Eliminar al usuario:\n${email}\n\nEsta acción no se puede deshacer.`)) return;

  const token = await getAuthToken();
  if (!token) { toast('Sin sesión', 'error'); return; }

  const res  = await fetch('/api/users', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId }),
  });
  const json = await res.json();
  if (!json.ok) { toast('Error: ' + json.error, 'error'); return; }

  appUsers = appUsers.filter(u => u.id !== userId);
  renderUsers();
  toast(`Usuario ${email} eliminado`, 'success');
}

function openAddUserModal() {
  showModal(`
    <h3 style="margin:0 0 18px">Nuevo usuario del sistema</h3>
    <form id="addUserForm" autocomplete="off">
      <div class="form-group">
        <label>Nombre para mostrar *</label>
        <input id="nu-name" type="text" placeholder="Ej: Barra 1" required/>
      </div>
      <div class="form-group">
        <label>Email *</label>
        <input id="nu-email" type="email" placeholder="barra@ejemplo.com" required/>
      </div>
      <div class="form-group">
        <label>Contraseña *</label>
        <input id="nu-password" type="password" placeholder="Mínimo 6 caracteres" required minlength="6"/>
      </div>
      <div class="form-group">
        <label>Rol</label>
        <select id="nu-role">
          <option value="bar">Barra</option>
          <option value="door">Portero</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" id="nu-submit" class="btn btn-primary" style="flex:1">Crear usuario</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
      <p id="nu-error" style="color:#ef4444;margin-top:10px;font-size:13px"></p>
    </form>
  `);

  document.getElementById('addUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('nu-submit');
    const errEl = document.getElementById('nu-error');
    btn.disabled = true;
    btn.textContent = 'Creando…';
    errEl.textContent = '';

    const token = await getAuthToken();
    if (!token) { errEl.textContent = 'Sin sesión activa'; btn.disabled = false; btn.textContent = 'Crear usuario'; return; }

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email:        document.getElementById('nu-email').value.trim(),
          password:     document.getElementById('nu-password').value,
          role:         document.getElementById('nu-role').value,
          display_name: document.getElementById('nu-name').value.trim(),
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      closeModal();
      toast(`Usuario ${json.user.email} creado`, 'success');
      await loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Crear usuario';
    }
  });
}

function openChangePasswordModal(userId, email) {
  showModal(`
    <h3 style="margin:0 0 6px">Cambiar contraseña</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 18px">${email}</p>
    <form id="changePwdForm" autocomplete="off">
      <div class="form-group">
        <label>Nueva contraseña *</label>
        <input id="cp-pwd" type="password" placeholder="Mínimo 6 caracteres" required minlength="6"/>
      </div>
      <div class="form-group" style="margin-top:10px">
        <label>Confirmar contraseña *</label>
        <input id="cp-pwd2" type="password" placeholder="Repetir contraseña" required minlength="6"/>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" id="cp-submit" class="btn btn-primary" style="flex:1">Guardar</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
      <p id="cp-error" style="color:#ef4444;margin-top:10px;font-size:13px"></p>
    </form>
  `);

  document.getElementById('changePwdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn   = document.getElementById('cp-submit');
    const errEl = document.getElementById('cp-error');
    const pwd   = document.getElementById('cp-pwd').value;
    const pwd2  = document.getElementById('cp-pwd2').value;

    if (pwd !== pwd2) { errEl.textContent = 'Las contraseñas no coinciden'; return; }

    btn.disabled = true;
    btn.textContent = 'Guardando…';
    errEl.textContent = '';

    const token = await getAuthToken();
    if (!token) { errEl.textContent = 'Sin sesión activa'; btn.disabled = false; btn.textContent = 'Guardar'; return; }

    try {
      const res  = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, password: pwd }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      closeModal();
      toast('Contraseña actualizada', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ─── UI setup ─────────────────────────────────────────────────────────────────
const TAB_TITLES = {
  dashboard: 'Dashboard',
  asistentes: 'Asistentes',
  barra: 'Barra',
  gastos: 'Gastos',
  tareas: 'Tareas',
  personas: 'Personas',
  evento: 'Evento',
  tarjetas: 'Tarjetas',
  blacklist: 'Black list',
  usuarios: 'Usuarios',
};
const TAB_ICONS = {
  dashboard: 'dashboard',
  asistentes: 'people',
  barra: 'glass',
  gastos: 'receipt',
  tareas: 'tasks',
  personas: 'people',
  evento: 'calendar',
  tarjetas: 'card',
  blacklist: 'warn',
  usuarios: 'user-gear',
};
// Tabs visibles en la tab-bar inferior (mobile). El resto va en "Más".
const PRIMARY_MOBILE_TABS = ['dashboard', 'asistentes', 'barra', 'gastos'];

function activateTab(tab, opts = {}) {
  // Paneles
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`tab-${tab}`);
  if (panel) panel.classList.add('active');
  // Sync hash (no scroll)
  if (!opts.skipHash) {
    const newHash = '#' + tab;
    if (location.hash !== newHash) history.replaceState(null, '', newHash);
  }
  // Sidebar nav items
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  // Bottom tabbar
  document.querySelectorAll('.bottom-tab').forEach(b => {
    if (b.id === 'bottomMoreBtn') {
      // "Más" queda activo sólo si el tab actual no es uno primario
      b.classList.toggle('active', !PRIMARY_MOBILE_TABS.includes(tab));
    } else {
      b.classList.toggle('active', b.dataset.tab === tab);
    }
  });
  // Título en topbar
  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = TAB_TITLES[tab] || '';
  // Cerrar sidebar en mobile al navegar
  closeSidebar();
  // Cerrar bottom sheet
  closeMoreSheet();
  // Carga bajo demanda
  if (tab === 'usuarios') loadUsers();
  // Scroll top
  const scroll = document.querySelector('.main-scroll');
  if (scroll) scroll.scrollTop = 0;
}

function openSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
}

// ─── Bottom sheet ("Más") para mobile ─────────────────────────────────────────
function openMoreSheet() {
  let sheet = document.getElementById('moreSheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'moreSheet';
    sheet.className = 'bottom-sheet';
    document.body.appendChild(sheet);
  }
  const currentTab = document.querySelector('.tab-panel.active')?.id.replace('tab-', '') || 'dashboard';
  const items = Object.keys(TAB_TITLES).map(key => `
    <button class="bottom-sheet-item ${key === currentTab ? 'active' : ''}" data-tab="${key}">
      ${icon(TAB_ICONS[key], 22)}
      <span>${TAB_TITLES[key]}</span>
    </button>
  `).join('');
  sheet.innerHTML = `
    <div class="bottom-sheet-handle"></div>
    <div class="bottom-sheet-grid">${items}</div>
    <button class="bottom-sheet-logout" id="moreLogoutBtn">
      ${icon('logout', 18)}
      <span>Cerrar sesión</span>
    </button>
  `;
  sheet.querySelectorAll('.bottom-sheet-item').forEach(it => {
    it.addEventListener('click', () => activateTab(it.dataset.tab));
  });
  sheet.querySelector('#moreLogoutBtn')?.addEventListener('click', () => {
    closeMoreSheet();
    if (typeof signOut === 'function') signOut();
  });
  // Backdrop click — clase propia para no chocar con el hide del sidebar en mobile
  if (!document.getElementById('sheetBackdrop')) {
    const bd = document.createElement('div');
    bd.id = 'sheetBackdrop';
    bd.className = 'sheet-backdrop';
    bd.addEventListener('click', closeMoreSheet);
    document.body.appendChild(bd);
  }
  document.getElementById('sheetBackdrop').classList.add('open');
  requestAnimationFrame(() => sheet.classList.add('open'));
}
function closeMoreSheet() {
  const sheet = document.getElementById('moreSheet');
  if (sheet) sheet.classList.remove('open');
  const bd = document.getElementById('sheetBackdrop');
  if (bd) bd.classList.remove('open');
}

function setupUI() {
  // Sidebar nav (desktop + mobile slide-in)
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  // Bottom tabbar
  document.querySelectorAll('.bottom-tab').forEach(btn => {
    if (btn.id === 'bottomMoreBtn') return;
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
  document.getElementById('bottomMoreBtn')?.addEventListener('click', openMoreSheet);

  // Sidebar open/close (mobile)
  document.getElementById('sidebarOpenBtn')?.addEventListener('click', openSidebar);
  document.getElementById('sidebarCloseBtn')?.addEventListener('click', closeSidebar);
  document.getElementById('sidebarBackdrop')?.addEventListener('click', closeSidebar);

  // Event picker (dropdown bajo Why Not — desktop y mobile)
  const pickerBtn = document.getElementById('eventPickerBtn');
  if (pickerBtn) {
    pickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEventPicker('eventPickerMenu');
    });
  }
  const pickerBtnM = document.getElementById('eventPickerBtnMobile');
  if (pickerBtnM) {
    pickerBtnM.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEventPicker('eventPickerMenuMobile');
    });
  }
  document.addEventListener('click', (e) => {
    ['eventPickerMenu', 'eventPickerMenuMobile'].forEach(id => {
      const menu = document.getElementById(id);
      if (!menu || menu.hidden) return;
      if (e.target.closest(`#${id}`)) return;
      if (e.target.closest('#eventPickerBtn') || e.target.closest('#eventPickerBtnMobile')) return;
      menu.hidden = true;
    });
  });

  // Header actions
  document.getElementById('logoutBtn').addEventListener('click', signOut);
  document.getElementById('exportBtn').addEventListener('click', exportToExcel);
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

  document.getElementById('addAttendeeBtn').addEventListener('click', openAddAttendee);
  document.getElementById('addExpenseBtn').addEventListener('click', openAddExpense);
  document.getElementById('newEventBtn').addEventListener('click', openNewEvent);
  document.getElementById('addTaskBtn').addEventListener('click', openAddTask);

  document.getElementById('addUserBtn').addEventListener('click', openAddUserModal);
  document.getElementById('refreshUsersBtn').addEventListener('click', loadUsers);

  // Tarjetas bloqueadas
  document.getElementById('blockCardForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('blockCardInput');
    const n = parseInt(input.value, 10);
    if (Number.isFinite(n)) {
      addBlockedCard(n);
      input.value = '';
    }
  });

  document.getElementById('attSearch').addEventListener('input', renderAttendeesTable);
  document.getElementById('attStatusFilter').addEventListener('change', renderAttendeesTable);
  document.getElementById('barFilter').addEventListener('change', renderBarTable);
  document.getElementById('barSearch')?.addEventListener('input', renderBarTable);
  document.getElementById('personasSearch')?.addEventListener('input', renderPersonas);
  document.getElementById('blacklistSearch')?.addEventListener('input', renderBlacklist);
  document.getElementById('toggleGroupBtn').addEventListener('click', () => {
    groupByStatus = !groupByStatus;
    renderAttendeesTable();
  });

  // Título inicial
  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = TAB_TITLES.dashboard;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function renderTasks() {
  const container = document.getElementById('tasksList');
  if (!container) return;

  // Tarea especial: "El portero puede cobrar cuentas de barra" — checkbox como primera tarjeta.
  const canCharge = !!(eventSettings?.door_can_charge);
  const doorChargeCard = `
    <div class="task-card task-special ${canCharge ? 'task-active' : 'task-inactive'}">
      <div class="task-header">
        <div class="task-title">
          <strong>El portero puede cobrar</strong>
        </div>
      </div>
      <div class="task-meta">
        <span style="font-size:13px;color:var(--muted)">
          ${canCharge ? 'Activado: el portero puede cerrar cuentas de barra al salir.' : 'Desactivado: sólo la barra puede cobrar cuentas.'}
        </span>
      </div>
      <div class="task-footer" style="justify-content:flex-end">
        <label class="task-checkbox" title="Activar/desactivar">
          <input type="checkbox" id="doorCanChargeToggle" ${canCharge ? 'checked' : ''}/>
          <span class="checkmark"></span>
        </label>
      </div>
    </div>`;

  if (!tasks.length) {
    container.innerHTML = doorChargeCard + '<div class="empty-state">Sin tareas. Creá una con el botón +</div>';
    wireDoorChargeToggle();
    return;
  }

  container.innerHTML = doorChargeCard + tasks.map(task => {
    const checks = task.task_checks || [];
    const lastCheck = checks[0];
    const lastCheckTime = lastCheck ? new Date(lastCheck.checked_at).toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'}) : null;
    const assignedProfile = task.assigned_to ? profiles.find(p => p.id === task.assigned_to) : null;

    return `
    <div class="task-card ${task.is_active ? 'task-active' : 'task-inactive'}">
      <div class="task-header">
        <div class="task-title">
          <span class="task-dot" style="background:${task.is_active ? 'var(--green-ios,#30d158)' : '#8e8e93'}"></span>
          <strong title="${(task.name||'').replace(/"/g,'&quot;')}">${task.name}</strong>
        </div>
      </div>
      <div class="task-meta">
        <span>${icon(assignedProfile ? 'user' : 'people', 13)} ${assignedProfile ? assignedProfile.display_name : 'Todos'}</span>
        ${task.remind
          ? `<span>${icon('bell',13)} Cada ${task.remind_freq_minutes} min · ${task.remind_from}–${task.remind_until}</span>`
          : '<span style="color:#8e8e93">Sin recordatorio</span>'}
      </div>
      <div class="task-footer">
        ${lastCheck
          ? `<span class="task-last-check">${icon('check',13)} Chequeado a las ${lastCheckTime}</span>`
          : '<span style="color:#8e8e93;font-size:12.5px">Sin chequeados</span>'}
        <div class="task-actions">
          <button class="btn btn-sm btn-success" onclick="checkTask('${task.id}')" title="Chequeado">${icon('check',14)}</button>
          <button class="btn btn-sm" onclick="openEditTask('${task.id}')" title="Editar">${icon('edit',14)}</button>
          <button class="btn btn-sm" onclick="toggleTask('${task.id}',${!task.is_active})" title="${task.is_active ? 'Desactivar' : 'Activar'}">${task.is_active ? '⏸' : '▶'}</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTask('${task.id}')" title="Eliminar">${icon('trash',14)}</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Wire del checkbox especial
  wireDoorChargeToggle();

  // Iniciar/actualizar recordatorios
  setupReminders();
}

function wireDoorChargeToggle() {
  const el = document.getElementById('doorCanChargeToggle');
  if (!el || el._wired) return;
  el._wired = true;
  el.addEventListener('change', (e) => {
    saveDoorSettings(e.target.checked);
  });
}

function setupReminders() {
  // Limpiar timers anteriores
  Object.values(reminderTimers).forEach(clearInterval);
  reminderTimers = {};

  tasks.filter(t => t.is_active && t.remind).forEach(task => {
    reminderTimers[task.id] = setInterval(() => {
      if (!isInReminderWindow(task)) return;
      showReminder(task);
    }, task.remind_freq_minutes * 60 * 1000);
  });
}

function isInReminderWindow(task) {
  const now = new Date();
  const [fromH, fromM] = task.remind_from.split(':').map(Number);
  const [untilH, untilM] = task.remind_until.split(':').map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const fromMins = fromH * 60 + fromM;
  let untilMins = untilH * 60 + untilM;
  // Si el horario cruza medianoche (ej: 22:00 a 04:00)
  if (untilMins < fromMins) {
    return nowMins >= fromMins || nowMins <= untilMins;
  }
  return nowMins >= fromMins && nowMins <= untilMins;
}

function showReminder(task) {
  if (Notification.permission === 'granted') {
    new Notification(task.name, { body: 'Recordatorio de tarea del evento', icon: './Logo.png' });
  }
  toast(`Recordatorio: ${task.name}`, 'warning');

  // Tareas asignadas a "Todos" (assigned_to = null) → push a todos los admins
  if (!task.assigned_to) {
    sendPushToAll(task.name, 'Recordatorio de tarea — Why Not', 'whynot-task', 'admin');
    // También broadcast in-app para admins conectados
    if (_notifChannel) {
      _notifChannel.send({ type: 'broadcast', event: 'alert',
        payload: { emoji: '', msg: task.name, from: 'Sistema', target: 'admin' } });
    }
  }

  // Telegram: "✅ Chequear <task>"
  try {
    fetch('/api/send-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `✅ Chequear ${task.name}` }),
    }).catch(() => {});
  } catch (_) { /* silencioso */ }
}

async function checkTask(taskId) {
  const db = getDb();
  const { data: { user } } = await db.auth.getUser();
  const task = tasks.find(t => t.id === taskId);
  const { error } = await db.from('task_checks').insert({ task_id: taskId, checked_by: user.id });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Tarea chequeada', 'success');

  // Telegram: avisar que fue chequeada + próximo recordatorio
  try {
    const who = (await getProfileName(user.id)) || user.email || 'Admin';
    const now = new Date();
    const hhmm = now.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
    let nextStr = 'sin recordatorio configurado';
    if (task && task.remind && task.remind_freq_minutes) {
      const next = new Date(now.getTime() + task.remind_freq_minutes * 60 * 1000);
      // Formato 12h con a.m./p.m. (coincide con el ejemplo del usuario)
      nextStr = next.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    const msg = `✅ ${task?.name || 'Tarea'} chequeado por ${who}. Próximo aviso: ${nextStr}`;
    await fetch('/api/send-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    }).catch(()=>{}); // best-effort
  } catch (_) { /* silencioso */ }

  await loadAll();
}

async function getProfileName(userId) {
  try {
    const prof = profiles.find(p => p.id === userId);
    if (prof?.display_name) return prof.display_name;
    const db = getDb();
    const { data } = await db.from('profiles').select('display_name').eq('id', userId).single();
    return data?.display_name || null;
  } catch { return null; }
}

async function toggleTask(taskId, newState) {
  const db = getDb();
  const { error } = await db.from('tasks').update({ is_active: newState }).eq('id', taskId);
  if (error) toast('Error: ' + error.message, 'error');
  else await loadAll();
}

async function deleteTask(taskId) {
  if (!confirm('¿Eliminar esta tarea?')) return;
  const db = getDb();
  await db.from('tasks').delete().eq('id', taskId);
  await loadAll();
}

function openAddTask() {
  const profileOptions = [
    `<option value="">Todos</option>`,
    ...profiles.map(p => `<option value="${p.id}">${p.display_name || p.role}</option>`)
  ].join('');

  showModal(`
    <h3 style="margin:0 0 18px;font-size:20px">Nueva tarea</h3>
    <form id="taskForm" autocomplete="off">
      <div class="form-grid">
        <div class="form-group" style="grid-column:1/-1"><label>Nombre *</label><input name="name" required/></div>
        <div class="form-group"><label>Asignada a</label>
          <select name="assigned_to">${profileOptions}</select>
        </div>
        <div class="form-group"><label>Estado</label>
          <select name="is_active">
            <option value="true" selected>Activa</option>
            <option value="false">Inactiva</option>
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label><input type="checkbox" id="remindCheck" name="remind" value="true" style="width:auto;margin-right:6px"/> Recordar esta tarea</label>
        </div>
        <div class="form-group" id="remindFromGroup" style="display:none"><label>Desde <span style="color:var(--muted);font-size:12px">(ej: 22:00)</span></label><input name="remind_from" type="text" inputmode="numeric" placeholder="22:00" pattern="[0-2][0-9]:[0-5][0-9]" value="22:00"/></div>
        <div class="form-group" id="remindUntilGroup" style="display:none"><label>Hasta <span style="color:var(--muted);font-size:12px">(ej: 04:00)</span></label><input name="remind_until" type="text" inputmode="numeric" placeholder="04:00" pattern="[0-2][0-9]:[0-5][0-9]" value="04:00"/></div>
        <div class="form-group" id="remindFreqGroup" style="display:none"><label>Frecuencia (Minutos)</label><input name="remind_freq_minutes" type="number" value="60" min="1"/></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Crear</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </form>
  `);

  document.getElementById('remindCheck').addEventListener('change', (e) => {
    const show = e.target.checked;
    ['remindFromGroup','remindUntilGroup','remindFreqGroup'].forEach(id => {
      document.getElementById(id).style.display = show ? '' : 'none';
    });
  });

  // Auto-formato HH:MM: escribir "17" → "17:00", "1745" → "17:45"
  document.querySelectorAll('#taskForm input[name="remind_from"], #taskForm input[name="remind_until"]').forEach(inp => {
    inp.addEventListener('blur', () => {
      let v = inp.value.replace(/\D/g, '');
      if (!v) return;
      if (v.length <= 2) {
        inp.value = v.padStart(2, '0') + ':00';
      } else {
        inp.value = v.slice(0, 2).padStart(2, '0') + ':' + v.slice(2, 4).padEnd(2, '0');
      }
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    });
  });

  document.getElementById('taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeEvent) { toast('No hay evento activo', 'error'); return; }
    const fd  = new FormData(e.target);
    const obj = {
      event_id:            currentEvent().id,
      name:                fd.get('name'),
      assigned_to:         fd.get('assigned_to') || null,
      is_active:           fd.get('is_active') === 'true',
      remind:              !!fd.get('remind'),
      remind_freq_minutes: parseInt(fd.get('remind_freq_minutes')) || 60,
      remind_from:         fd.get('remind_from') || '22:00',
      remind_until:        fd.get('remind_until') || '04:00',
    };
    const db = getDb();
    const { error } = await db.from('tasks').insert(obj);
    if (error) toast('Error: ' + error.message, 'error');
    else {
      // Pedir permiso para notificaciones
      if (obj.remind && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      toast('Tarea creada', 'success');
      closeModal();
      await loadAll();
    }
  });
}

function openEditTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const profileOptions = [
    `<option value="">Todos</option>`,
    ...profiles.map(p => `<option value="${p.id}" ${task.assigned_to === p.id ? 'selected' : ''}>${p.display_name || p.role}</option>`)
  ].join('');

  showModal(`
    <h3 style="margin:0 0 18px;font-size:20px">Editar tarea</h3>
    <form id="taskEditForm" autocomplete="off">
      <div class="form-grid">
        <div class="form-group" style="grid-column:1/-1"><label>Nombre *</label><input name="name" value="${(task.name||'').replace(/"/g,'&quot;')}" required/></div>
        <div class="form-group"><label>Asignada a</label>
          <select name="assigned_to">${profileOptions}</select>
        </div>
        <div class="form-group"><label>Estado</label>
          <select name="is_active">
            <option value="true"  ${task.is_active ? 'selected':''}>Activa</option>
            <option value="false" ${!task.is_active ? 'selected':''}>Inactiva</option>
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label><input type="checkbox" id="remindCheckEdit" name="remind" value="true" ${task.remind ? 'checked':''} style="width:auto;margin-right:6px"/> Recordar esta tarea</label>
        </div>
        <div class="form-group" id="remindFromGroupE" style="display:${task.remind ? '' : 'none'}"><label>Desde</label><input name="remind_from" type="text" inputmode="numeric" value="${task.remind_from || '22:00'}" pattern="[0-2][0-9]:[0-5][0-9]"/></div>
        <div class="form-group" id="remindUntilGroupE" style="display:${task.remind ? '' : 'none'}"><label>Hasta</label><input name="remind_until" type="text" inputmode="numeric" value="${task.remind_until || '04:00'}" pattern="[0-2][0-9]:[0-5][0-9]"/></div>
        <div class="form-group" id="remindFreqGroupE" style="display:${task.remind ? '' : 'none'}"><label>Frecuencia (Minutos)</label><input name="remind_freq_minutes" type="number" value="${task.remind_freq_minutes || 60}" min="1"/></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Guardar</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </form>
  `);

  document.getElementById('remindCheckEdit').addEventListener('change', (e) => {
    const show = e.target.checked;
    ['remindFromGroupE','remindUntilGroupE','remindFreqGroupE'].forEach(id => {
      document.getElementById(id).style.display = show ? '' : 'none';
    });
  });

  document.getElementById('taskEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const obj = {
      name:                fd.get('name'),
      assigned_to:         fd.get('assigned_to') || null,
      is_active:           fd.get('is_active') === 'true',
      remind:              !!fd.get('remind'),
      remind_freq_minutes: parseInt(fd.get('remind_freq_minutes')) || 60,
      remind_from:         fd.get('remind_from') || '22:00',
      remind_until:        fd.get('remind_until') || '04:00',
    };
    const db = getDb();
    const { error } = await db.from('tasks').update(obj).eq('id', taskId);
    if (error) toast('Error: ' + error.message, 'error');
    else { toast('Tarea actualizada', 'success'); closeModal(); await loadAll(); }
  });
}
window.openEditTask = openEditTask;

// ─── Configuración del portero ─────────────────────────────────────────────────
let _blockedSlotsColSupported = true;

function _isMissingBlockedSlotsError(err) {
  if (!err) return false;
  const m = String(err.message || err || '').toLowerCase();
  return m.includes('blocked_slots');
}

function _showMissingBlockedSlotsHint() {
  toast("Falta la columna 'blocked_slots'. Correlo en Supabase → SQL Editor: alter table event_settings add column if not exists blocked_slots jsonb default '[]'::jsonb;", 'error');
}

async function saveDoorSettings(canCharge) {
  if (!activeEvent) return;
  const db = getDb();
  const payload = { event_id: currentEvent().id, door_can_charge: canCharge };
  if (_blockedSlotsColSupported) payload.blocked_slots = eventSettings.blocked_slots || [];
  const { error } = await db.from('event_settings').upsert(payload);
  if (error && _isMissingBlockedSlotsError(error)) {
    _blockedSlotsColSupported = false;
    // Reintentar sin la columna faltante
    await db.from('event_settings').upsert({ event_id: currentEvent().id, door_can_charge: canCharge });
  }
  eventSettings.door_can_charge = canCharge;
}

// ─── Tarjetas bloqueadas ─────────────────────────────────────────────────────
function getBlockedSlots() {
  const arr = eventSettings?.blocked_slots;
  return Array.isArray(arr) ? arr.map(n => Number(n)).filter(n => Number.isFinite(n)) : [];
}

function renderBlockedCards() {
  const list = document.getElementById('blockedCardsList');
  const counter = document.getElementById('blockedCardsCounters');
  if (!list) return;
  const blocked = getBlockedSlots().sort((a, b) => a - b);

  if (counter) {
    const cfg = [
      { label: 'Tarjetas bloqueadas', value: blocked.length, color: '#ff453a', bg: '#1f0d0d', border: '#3a1a1a' },
    ];
    counter.innerHTML = cfg.map(c => `
      <div style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:10px 16px;display:flex;gap:8px;align-items:center">
        <span style="font-size:22px;font-weight:bold;color:${c.color}">${c.value}</span>
        <span style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">${c.label}</span>
      </div>`).join('');
  }

  if (!blocked.length) {
    list.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:28px">Sin tarjetas bloqueadas.</div>';
    return;
  }
  list.innerHTML = blocked.map(n => `
    <div class="blocked-card-chip">
      <div style="display:flex;align-items:center;gap:8px">
        ${icon('card', 18)}
        <strong>${padId(n)}</strong>
      </div>
      <button class="unblock-btn" title="Desbloquear" onclick="unblockCard(${n})">${icon('close', 14)}</button>
    </div>
  `).join('');
}

async function addBlockedCard(slot) {
  if (!activeEvent) { toast('No hay evento activo', 'error'); return; }
  const n = parseInt(slot, 10);
  if (!Number.isFinite(n) || n < 1) { toast('Número inválido', 'error'); return; }
  const current = getBlockedSlots();
  if (current.includes(n)) { toast('Esa tarjeta ya está bloqueada', 'warning'); return; }
  const next = [...current, n].sort((a, b) => a - b);
  const db = getDb();
  const { error } = await db.from('event_settings').upsert({
    event_id: currentEvent().id,
    door_can_charge: eventSettings.door_can_charge || false,
    blocked_slots: next,
  });
  if (error) {
    if (_isMissingBlockedSlotsError(error)) {
      _blockedSlotsColSupported = false;
      _showMissingBlockedSlotsHint();
      return;
    }
    toast('Error: ' + error.message, 'error'); return;
  }
  eventSettings.blocked_slots = next;
  renderBlockedCards();
  toast(`Tarjeta ${padId(n)} bloqueada`, 'success');
}

async function unblockCard(slot) {
  if (!activeEvent) return;
  const n = parseInt(slot, 10);
  const next = getBlockedSlots().filter(x => x !== n);
  const db = getDb();
  const { error } = await db.from('event_settings').upsert({
    event_id: currentEvent().id,
    door_can_charge: eventSettings.door_can_charge || false,
    blocked_slots: next,
  });
  if (error) {
    if (_isMissingBlockedSlotsError(error)) {
      _blockedSlotsColSupported = false;
      _showMissingBlockedSlotsHint();
      return;
    }
    toast('Error: ' + error.message, 'error'); return;
  }
  eventSettings.blocked_slots = next;
  renderBlockedCards();
  toast(`Tarjeta ${padId(n)} desbloqueada`, 'success');
}
window.unblockCard = unblockCard;

function isSlotBlocked(slot) {
  return getBlockedSlots().includes(Number(slot));
}

// Devuelve el asistente que ya tiene asignada esa tarjeta (excluye opcional).
function getAttendeeWithSlot(slot, excludeAttendeeId = null) {
  const n = Number(slot);
  if (!Number.isFinite(n) || n <= 0) return null;
  return attendees.find(a => a.bar_account_slot === n && a.id !== excludeAttendeeId) || null;
}

document.addEventListener('DOMContentLoaded', init);
