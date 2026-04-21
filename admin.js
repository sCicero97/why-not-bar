// ═══════════════════════════════════════════════════════════════════════════
// admin.js — Panel de Administración
// ═══════════════════════════════════════════════════════════════════════════
console.log('ADMIN v3 2026-03-23');

let activeEvent    = null;
let groupByStatus  = true;   // toggle: agrupar por estado o por nro de cuenta
let attendees      = [];
let barAccounts    = [];
let barClosures    = [];
let expenses       = [];
let events         = [];
let tasks          = [];
let taskChecks     = [];
let eventSettings  = { door_can_charge: false };
let profiles       = [];
let reminderTimers = {};
let appUsers       = [];   // usuarios del sistema (cargados on-demand)

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const user = await requireAuth(['admin']);
    if (!user) return;
    const displayName = user.displayName || user.email;
    document.getElementById('userChip').textContent = `⚙️ ${displayName}`;
    setupUserDropdown();
    setupNotifChannel('Admin', displayName);
    document.getElementById('app').style.display = 'block';

    activeEvent = await getActiveEvent();
    if (activeEvent) {
      document.getElementById('eventName').textContent = `${activeEvent.name} — ${activeEvent.date}`;
    }

    await loadAll();
    setupRealtime();
    setupUI();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  } catch (e) {
    if (e.message !== 'SETUP_REQUIRED') console.error('Admin init error:', e);
  }
}

async function loadAll() {
  const db = getDb();
  const eventId = activeEvent?.id;

  const queries = [
    db.from('events').select('*').order('date', { ascending: false }),
    db.from('profiles').select('id,display_name,role'),
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
  if (results[2]?.data) attendees = results[2].data;
  if (results[3]?.data) barAccounts = results[3].data;
  if (results[4]?.data) barClosures = results[4].data;
  if (results[5]?.data) expenses = results[5].data;
  if (results[6]?.data) tasks = results[6].data;
  if (results[7]?.data) eventSettings = results[7].data || { door_can_charge: false };

  renderAll();
}

function setupRealtime() {
  if (!activeEvent) return;
  const db = getDb();
  const eid = activeEvent.id;

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
      <td>${c.payment_photo_url ? `<button class="btn btn-sm" onclick="viewPhoto('${c.payment_photo_url}')" style="font-size:14px">📸 Ver</button>` : '—'}</td>
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
    if (search && !(`${a.name} ${a.cedula || ''} ${a.email || ''}`).toLowerCase().includes(search)) return false;
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
  if (toggleBtn) {
    toggleBtn.textContent  = groupByStatus ? '# Ordenar por cuenta' : '⬆ Agrupar por estado';
    toggleBtn.style.background = groupByStatus ? 'var(--panel)' : '#1a2a3a';
    toggleBtn.style.borderColor = groupByStatus ? 'var(--line)' : '#3b82f6';
    toggleBtn.style.color = groupByStatus ? 'var(--muted)' : '#93c5fd';
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
      <td>${att.payment_photo_url ? `<button class="btn btn-sm" onclick="viewPhoto('${att.payment_photo_url}')" style="font-size:14px">📸 Ver</button>` : '—'}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="openEditAttendee('${att.id}')" title="Editar">✏️</button>
          ${barAcc && !barAcc.is_closed && barAcc.total > 0 ? `<button class="btn btn-sm btn-primary" onclick="adminCloseBarAccount('${barAcc.id}',${barAcc.slot})" title="Cobrar cuenta">💳</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="deleteAttendee('${att.id}')" title="Eliminar">🗑</button>
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
  el.innerHTML = `
    <div class="summary-card" style="background:#1a2a1a;border-color:#2a4a2a;padding:8px 16px;border-radius:12px">
      <span class="summary-label">Abiertas</span>
      <strong style="color:#4ade80">${open}</strong>
    </div>
    <div class="summary-card" style="background:#1a1a2a;border-color:#2a2a4a;padding:8px 16px;border-radius:12px">
      <span class="summary-label">Cerradas</span>
      <strong style="color:#60a5fa">${closed}</strong>
    </div>
    <div class="summary-card" style="background:#181818;border-color:#333;padding:8px 16px;border-radius:12px">
      <span class="summary-label">Total general</span>
      <strong>${formatMoney(grandTot)}</strong>
    </div>`;
}

// ─── Bar accounts table ───────────────────────────────────────────────────────
function renderBarTable() {
  const filter = document.getElementById('barFilter')?.value || 'all';
  // Solo mostrar cuentas asignadas a un asistente
  let list = barAccounts.filter(a => {
    if (!a.attendee_id) return false;  // sin asistente → ocultar
    if (filter === 'open')    return !a.is_closed && a.total > 0;
    if (filter === 'empty')   return !a.is_closed && a.total === 0;
    if (filter === 'closed')  return a.is_closed;
    return true;
  });

  const tbody = document.getElementById('barAccountsBody');
  if (!tbody) return;
  tbody.innerHTML = list.map(acc => {
    const closure  = acc.is_closed ? barClosures.find(c => c.slot === acc.slot) : null;
    const photoUrl = closure?.payment_photo_url || null;
    return `
    <tr class="${acc.is_closed ? 'row-closed' : acc.total > 0 ? 'row-active' : ''}">
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
      <td style="font-size:13px">${
        closure?.paid_by_slot
          ? `<span style="color:#fbbf24">Pagado por #${String(closure.paid_by_slot).padStart(3,'0')}</span>`
          : closure?.payment_method === 'transfer'
            ? '🏦 Transfer'
            : closure?.payment_method === 'cash'
              ? `💵 Efectivo${closure.change_given > 0 ? `<br><span style="font-size:11px;color:var(--muted)">Vuelto: ${formatMoney(closure.change_given)}</span>` : ''}`
              : '—'
      }</td>
      <td>${!acc.is_closed && acc.total > 0
        ? `<button class="btn btn-sm btn-primary" onclick="adminCloseBarAccount('${acc.id}',${acc.slot})">💳 Cobrar</button>`
        : acc.is_closed
          ? `<button class="btn btn-sm" onclick="reopenBarAccount('${acc.id}')" style="background:var(--muted);color:#000">Reabrir</button>`
          : '—'
      }</td>
      <td>${photoUrl
        ? `<button class="btn btn-sm" onclick="viewPhoto('${photoUrl}')" style="font-size:14px">📸 Ver</button>`
        : '—'
      }</td>
    </tr>`;
  }).join('') || '<tr><td colspan="12" class="empty-state">Sin cuentas asignadas.</td></tr>';
}

// ─── Expenses ─────────────────────────────────────────────────────────────────
function renderExpenses() {
  const tbody = document.getElementById('expensesBody');
  if (!tbody) return;
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  tbody.innerHTML = expenses.map(exp => `
    <tr>
      <td>${exp.description}</td>
      <td><strong>${formatMoney(exp.amount)}</strong></td>
      <td style="font-size:12px;color:var(--muted)">${new Date(exp.created_at).toLocaleDateString('es-UY')}</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteExpense('${exp.id}')">🗑</button></td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin gastos registrados.</td></tr>';

  document.getElementById('expensesTotalRow').innerHTML =
    `<tr style="border-top:2px solid var(--line)"><td><strong>Total gastos</strong></td><td colspan="3"><strong>${formatMoney(total)}</strong></td></tr>`;
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
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm btn-danger" onclick="deleteEvent('${ev.id}')">🗑</button>
          ${!ev.is_active ? `<button class="btn btn-sm btn-success" onclick="activateEvent('${ev.id}')">Activar</button>` : ''}
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin eventos. Creá uno.</td></tr>';
}

// ─── Inline cell editing ──────────────────────────────────────────────────────
document.addEventListener('dblclick', async (e) => {
  const cell = e.target.closest('.editable-cell');
  if (!cell) return;
  const id    = cell.dataset.id;
  const field = cell.dataset.field;
  const att   = attendees.find(a => a.id === id);
  if (!att) return;

  const current = att[field] || '';
  const input   = document.createElement('input');
  input.type    = field === 'entry_amount' ? 'number' : 'text';
  input.value   = current;
  input.className = 'inline-input';
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();

  const save = async () => {
    const val = field === 'entry_amount' ? parseFloat(input.value) || 0 : input.value.trim();
    await updateAttendeeField(id, field, val);
  };
  input.addEventListener('blur',  save);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') renderAttendeesTable(); });
});

async function updateAttendeeField(id, field, value) {
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
function getNextAvailableBarSlot() {
  const usedSlots = new Set(attendees.map(a => a.bar_account_slot).filter(s => s));
  for (let i = 1; i <= 999; i++) {
    if (!usedSlots.has(i)) return i;
  }
  return null;
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
        <div class="form-group"><label>Cuenta barra #</label><input name="bar_account_slot" type="number" value="${nextSlot}" readonly style="background:var(--panel-2);cursor:not-allowed"/></div>
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
      obj.event_id = activeEvent.id;
      if (!obj.bar_account_slot) delete obj.bar_account_slot; else obj.bar_account_slot = parseInt(obj.bar_account_slot);
      if (!obj.entry_amount) obj.entry_amount = 0; else obj.entry_amount = parseFloat(obj.entry_amount);
      const db = getDb();
      const { data: newAtt, error } = await db.from('attendees').insert(obj).select().single();
      if (error) toast('Error: ' + error.message, 'error');
      else {
        // Vincular cuenta de barra con asistente
        if (newAtt.bar_account_slot) {
          await db.from('bar_accounts')
            .update({ attendee_id: newAtt.id })
            .eq('event_id', activeEvent.id)
            .eq('slot', newAtt.bar_account_slot);
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
    const db = getDb();
    const { error } = await db.from('attendees').update(obj).eq('id', id);
    if (error) toast('Error: ' + error.message, 'error');
    else { toast('Guardado', 'success'); closeModal(); await loadAll(); }
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
      .eq('event_id', activeEvent.id)
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
async function adminCloseBarAccount(barAccountId, slot) {
  const acc = barAccounts.find(a => a.id === barAccountId);
  const total = acc?.total || 0;

  const payment = await showPaymentMethodSelector(total);
  if (!payment) return; // canceló

  let photoUrl = null;
  if (payment.method === 'transfer') {
    const photoBlob = await openCamera();
    if (photoBlob) photoUrl = await uploadPaymentPhoto(photoBlob, activeEvent.id, slot);
  }

  const db = getDb();
  const { data, error } = await db.rpc('close_bar_account', {
    p_account_id: barAccountId, p_closed_by: 'admin', p_photo_url: photoUrl,
  });
  if (error || !data?.ok) { toast(data?.error || error?.message || 'Error', 'error'); return; }

  // Guardar método de pago en bar_closures
  await db.from('bar_closures')
    .update({ payment_method: payment.method, cash_received: payment.cashReceived, change_given: payment.changeGiven })
    .eq('slot', slot).eq('event_id', activeEvent.id);

  toast(`Cuenta ${padId(slot)} cobrada — ${formatMoney(data.total)}`, 'success');
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
      event_id: activeEvent.id,
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

// ─── Events management ────────────────────────────────────────────────────────
function openNewEvent() {
  showModal(`
    <h3 style="margin:0 0 18px">Nuevo evento</h3>
    <form id="eventForm">
      <div class="form-group"><label>Nombre del evento *</label><input name="name" required/></div>
      <div class="form-group"><label>Fecha *</label><input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required/></div>
      <div class="form-group"><label>Cuentas de barra a crear</label><input name="accountCount" type="number" value="120" min="1" max="500"/></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Crear y activar</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </form>
  `);
  document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const db = getDb();
    // Deactivate all events
    await db.from('events').update({ is_active: false }).eq('is_active', true);
    // Create new event
    const { data: newEvent, error } = await db.from('events')
      .insert({ name: fd.get('name'), date: fd.get('date'), is_active: true })
      .select().single();
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    // Init bar accounts
    const count = parseInt(fd.get('accountCount')) || 120;
    await db.rpc('init_bar_accounts', { p_event_id: newEvent.id, p_count: count });
    // Tarea default: Chequear PH
    await db.from('tasks').insert({
      event_id: newEvent.id, name: 'Chequear PH', assigned_to: null,
      is_active: true, remind: true, remind_freq_minutes: 60,
      remind_from: '22:00', remind_until: '04:00',
    });
    // Event settings default
    await db.from('event_settings').insert({ event_id: newEvent.id, door_can_charge: false });
    toast(`Evento "${newEvent.name}" creado con ${count} cuentas`, 'success');
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
  const n = window.prompt('¿Cuántas cuentas de barra crear?', '120');
  if (!n) return;
  const count = parseInt(n);
  if (isNaN(count) || count < 1) { toast('Número inválido', 'error'); return; }
  if (!confirm(`Esto reemplazará todas las cuentas actuales con ${count} nuevas. ¿Confirmar?`)) return;
  const db = getDb();
  const { data, error } = await db.rpc('init_bar_accounts', { p_event_id: activeEvent.id, p_count: count });
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
    const obj = { event_id: activeEvent.id };
    headers.forEach((h, idx) => {
      if (vals[idx] !== undefined && vals[idx] !== '') obj[h] = vals[idx];
    });
    if (obj.bar_account_slot) obj.bar_account_slot = parseInt(obj.bar_account_slot);
    if (obj.entry_amount)     obj.entry_amount = parseFloat(obj.entry_amount);
    rows.push(obj);
  }

  if (!rows.length) { toast('No se encontraron filas válidas', 'error'); return; }
  const db = getDb();
  const { error } = await db.from('attendees').insert(rows);
  if (error) toast('Error importando: ' + error.message, 'error');
  else { toast(`${rows.length} asistentes importados`, 'success'); await loadAll(); }
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
  // Apply form styles
  document.querySelectorAll('#modalBody input, #modalBody select').forEach(el => {
    el.style.cssText = 'width:100%;background:var(--panel-2);border:1px solid var(--line);color:var(--text);padding:11px 14px;border-radius:12px;font-size:15px;display:block;margin-top:4px';
  });
}
function closeModal() { document.getElementById('modalOverlay').classList.add('hidden'); }

// ─── Photo viewer ─────────────────────────────────────────────────────────────
function viewPhoto(url) {
  document.getElementById('modalBody').innerHTML = `
    <div style="text-align:center">
      <h3 style="margin:0 0 16px;font-size:20px">Comprobante de pago</h3>
      <img src="${url}" style="max-width:100%;border-radius:14px;max-height:65vh;object-fit:contain;display:block;margin:0 auto"/>
      <div style="margin-top:18px">
        <a href="${url}" target="_blank" class="btn btn-sm" style="display:inline-block;text-decoration:none">↗ Abrir en nueva pestaña</a>
      </div>
    </div>
  `;
  document.getElementById('modalOverlay').classList.remove('hidden');
}

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

const ROLE_LABELS = { admin: '⚙️ Admin', bar: '🍹 Barra', door: '🚪 Portero' };
const ROLE_COLORS = { admin: '#f59e0b', bar: '#1ed760', door: '#3b82f6' };

function renderUsers() {
  const tbody = document.getElementById('usersBody');
  if (!tbody) return;

  if (!appUsers.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Sin usuarios. Creá uno con el botón +</td></tr>';
    return;
  }

  tbody.innerHTML = appUsers.map(u => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-weight:600">${u.display_name || '—'}</span>
          <button class="btn btn-sm" onclick="openEditUserName('${u.id}','${(u.display_name||'').replace(/'/g,"&#39;")}')"
            style="font-size:12px;padding:3px 8px">✏️</button>
        </div>
      </td>
      <td style="color:var(--muted);font-size:13px">${u.email}</td>
      <td>
        <select class="inline-select"
          style="border-color:${ROLE_COLORS[u.role]||'var(--line)'};color:${ROLE_COLORS[u.role]||'var(--text)'};background:var(--panel-2);border-radius:10px;padding:5px 10px;font-size:13px"
          onchange="updateUserRole('${u.id}',this.value)">
          <option value="bar"  ${u.role==='bar'  ?'selected':''}>🍹 Barra</option>
          <option value="door" ${u.role==='door' ?'selected':''}>🚪 Portero</option>
          <option value="admin"${u.role==='admin'?'selected':''}>⚙️ Admin</option>
        </select>
      </td>
      <td style="font-size:12px;color:var(--muted)">
        ${u.last_sign_in ? new Date(u.last_sign_in).toLocaleString('es-UY',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : 'Nunca'}
      </td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="openChangePasswordModal('${u.id}','${u.email.replace(/'/g,"&#39;")}')"
            style="background:#1c2a3a;border-color:#2563eb;color:#93c5fd">🔑 Clave</button>
          <button class="btn btn-sm btn-danger" onclick="deleteAppUser('${u.id}','${u.email.replace(/'/g,"&#39;")}')">🗑</button>
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
  if (!confirm(`⚠️  Eliminar al usuario:\n${email}\n\nEsta acción no se puede deshacer.`)) return;

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
          <option value="bar">🍹 Barra</option>
          <option value="door">🚪 Portero</option>
          <option value="admin">⚙️ Admin</option>
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
function setupUI() {
  // Tabs — cargar usuarios on-demand cuando se abre el tab
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'usuarios') loadUsers();
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', signOut);
  document.getElementById('exportBtn').addEventListener('click', exportToExcel);
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

  document.getElementById('addAttendeeBtn').addEventListener('click', openAddAttendee);
  document.getElementById('addExpenseBtn').addEventListener('click', openAddExpense);
  document.getElementById('newEventBtn').addEventListener('click', openNewEvent);
  document.getElementById('addTaskBtn').addEventListener('click', openAddTask);
  document.getElementById('doorCanChargeToggle').addEventListener('change', (e) => {
    saveDoorSettings(e.target.checked);
  });

  document.getElementById('addUserBtn').addEventListener('click', openAddUserModal);
  document.getElementById('refreshUsersBtn').addEventListener('click', loadUsers);

  document.getElementById('attSearch').addEventListener('input', renderAttendeesTable);
  document.getElementById('attStatusFilter').addEventListener('change', renderAttendeesTable);
  document.getElementById('barFilter').addEventListener('change', renderBarTable);
  document.getElementById('toggleGroupBtn').addEventListener('click', () => {
    groupByStatus = !groupByStatus;
    renderAttendeesTable();
  });
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function renderTasks() {
  const container = document.getElementById('tasksList');
  if (!container) return;

  // Render config portero
  const toggle = document.getElementById('doorCanChargeToggle');
  if (toggle) toggle.checked = eventSettings?.door_can_charge || false;

  if (!tasks.length) {
    container.innerHTML = '<div class="empty-state">Sin tareas. Creá una con el botón +</div>';
    return;
  }

  container.innerHTML = tasks.map(task => {
    const checks = task.task_checks || [];
    const lastCheck = checks[0];
    const lastCheckTime = lastCheck ? new Date(lastCheck.checked_at).toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'}) : null;
    const assignedProfile = task.assigned_to ? profiles.find(p => p.id === task.assigned_to) : null;

    return `
    <div class="task-card ${task.is_active ? 'task-active' : 'task-inactive'}">
      <div class="task-header">
        <div class="task-title">
          <span class="task-dot" style="background:${task.is_active ? 'var(--green)' : 'var(--muted)'}"></span>
          <strong>${task.name}</strong>
          ${!task.is_active ? '<span style="color:var(--muted);font-size:13px"> — Inactiva</span>' : ''}
        </div>
        <div class="task-meta">
          <span>${assignedProfile ? '👤 ' + assignedProfile.display_name : '👥 Todos'}</span>
          ${task.remind ? `<span>🔔 Cada ${task.remind_freq_minutes} min · ${task.remind_from}–${task.remind_until}</span>` : '<span style="color:var(--muted)">Sin recordatorio</span>'}
        </div>
      </div>
      <div class="task-footer">
        ${lastCheck ? `<span class="task-last-check">✓ Chequeado a las ${lastCheckTime}</span>` : '<span style="color:var(--muted);font-size:13px">Sin chequeados</span>'}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-success" onclick="checkTask('${task.id}')">✓ Chequeado</button>
          <button class="btn btn-sm" onclick="toggleTask('${task.id}',${!task.is_active})">${task.is_active ? 'Desactivar' : 'Activar'}</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTask('${task.id}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Iniciar/actualizar recordatorios
  setupReminders();
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
    new Notification(`⏰ ${task.name}`, { body: 'Recordatorio de tarea del evento', icon: './Logo.png' });
  }
  toast(`⏰ Recordatorio: ${task.name}`, 'warning');

  // Tareas asignadas a "Todos" (assigned_to = null) → push a todos los admins
  if (!task.assigned_to) {
    sendPushToAll(`⏰ ${task.name}`, 'Recordatorio de tarea — Why Not', 'whynot-task', 'admin');
    // También broadcast in-app para admins conectados
    if (_notifChannel) {
      _notifChannel.send({ type: 'broadcast', event: 'alert',
        payload: { emoji: '⏰', msg: task.name, from: 'Sistema', target: 'admin' } });
    }
  }
}

async function checkTask(taskId) {
  const db = getDb();
  const { data: { user } } = await db.auth.getUser();
  const { error } = await db.from('task_checks').insert({ task_id: taskId, checked_by: user.id });
  if (error) toast('Error: ' + error.message, 'error');
  else {
    toast('✓ Tarea chequeada', 'success');
    await loadAll();
  }
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
    `<option value="">👥 Todos</option>`,
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
      event_id:            activeEvent.id,
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

// ─── Configuración del portero ─────────────────────────────────────────────────
async function saveDoorSettings(canCharge) {
  if (!activeEvent) return;
  const db = getDb();
  await db.from('event_settings').upsert({ event_id: activeEvent.id, door_can_charge: canCharge });
}

document.addEventListener('DOMContentLoaded', init);
