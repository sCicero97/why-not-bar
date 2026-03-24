// ═══════════════════════════════════════════════════════════════════════════
// admin.js — Panel de Administración
// ═══════════════════════════════════════════════════════════════════════════
console.log('ADMIN v3 2026-03-23');

let activeEvent  = null;
let attendees    = [];
let barAccounts  = [];
let barClosures  = [];
let expenses     = [];
let events       = [];

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const user = await requireAuth(['admin']);
    if (!user) return;
    document.getElementById('userChip').textContent = `⚙️ ${user.displayName || user.email}`;
    document.getElementById('app').style.display = 'block';

    activeEvent = await getActiveEvent();
    if (activeEvent) {
      document.getElementById('eventName').textContent = `${activeEvent.name} — ${activeEvent.date}`;
    }

    await loadAll();
    setupRealtime();
    setupUI();
  } catch (e) {
    if (e.message !== 'SETUP_REQUIRED') console.error('Admin init error:', e);
  }
}

async function loadAll() {
  const db = getDb();
  const eventId = activeEvent?.id;

  const queries = [
    db.from('events').select('*').order('date', { ascending: false }),
  ];
  if (eventId) {
    queries.push(
      db.from('attendees').select('*').eq('event_id', eventId).order('name'),
      db.from('bar_accounts').select('*, attendees(name)').eq('event_id', eventId).order('slot'),
      db.from('bar_closures').select('*, attendees(name)').eq('event_id', eventId).order('closed_at', { ascending: false }),
      db.from('expenses').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
    );
  }

  const results = await Promise.all(queries);
  if (results[0].data) events = results[0].data;
  if (results[1]?.data) attendees = results[1].data;
  if (results[2]?.data) barAccounts = results[2].data;
  if (results[3]?.data) barClosures = results[3].data;
  if (results[4]?.data) expenses = results[4].data;

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
      (p) => { if (p.eventType === 'INSERT') barClosures.unshift(p.new); renderAll(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `event_id=eq.${eid}` },
      (p) => { applyChange(expenses, p); renderAll(); })
    .subscribe();
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
  renderExpenses();
  renderEvents();
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
      <td>${c.payment_photo_url ? `<a href="${c.payment_photo_url}" target="_blank" class="table-link">Ver foto</a>` : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty-state">Sin cobros todavía.</td></tr>';
}

// ─── Attendees table ──────────────────────────────────────────────────────────
function renderAttendeesTable() {
  const search = document.getElementById('attSearch')?.value?.toLowerCase() || '';
  const statusF = document.getElementById('attStatusFilter')?.value || '';

  let list = attendees.filter(a => {
    if (search && !(`${a.name} ${a.cedula || ''} ${a.email || ''}`).toLowerCase().includes(search)) return false;
    if (statusF && a.status !== statusF) return false;
    return true;
  });

  const tbody = document.getElementById('attendeesBody');
  if (!tbody) return;

  tbody.innerHTML = list.map(att => {
    const barAcc = att.bar_account_slot ? barAccounts.find(b => b.slot === att.bar_account_slot) : null;
    const consumption = barAcc ? barAcc.total + barClosures.filter(c => c.slot === att.bar_account_slot).reduce((s,c)=>s+Number(c.total),0) : 0;

    return `<tr data-id="${att.id}">
      <td><div class="att-name-cell" title="Doble click para editar">${att.name}</div></td>
      <td>
        <select class="status-select inline-select" data-id="${att.id}" data-field="status" onchange="updateAttendeeField('${att.id}','status',this.value)">
          ${['invited','crew','in_process','paid','no_show'].map(s =>
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
      <td>${att.payment_photo_url ? `<a href="${att.payment_photo_url}" target="_blank" class="table-link">📸 Ver</a>` : '—'}</td>
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

// ─── Bar accounts table ───────────────────────────────────────────────────────
function renderBarTable() {
  const filter = document.getElementById('barFilter')?.value || 'all';
  let list = barAccounts.filter(a => {
    if (filter === 'open')    return !a.is_closed && a.total > 0;
    if (filter === 'empty')   return !a.is_closed && a.total === 0;
    if (filter === 'closed')  return a.is_closed;
    return true;
  });

  const tbody = document.getElementById('barAccountsBody');
  if (!tbody) return;
  tbody.innerHTML = list.map(acc => `
    <tr class="${acc.is_closed ? 'row-closed' : acc.total > 0 ? 'row-active' : ''}">
      <td><strong>${padId(acc.slot)}</strong></td>
      <td>${acc.attendees?.name || '<span style="color:var(--muted)">—</span>'}</td>
      <td><strong>${formatMoney(acc.total)}</strong></td>
      <td>${acc.qty160}</td><td>${acc.qty260}</td><td>${acc.qty360}</td>
      <td>${acc.is_closed
        ? '<span class="status-pill" style="background:#3a202022;color:#f87171">Cerrada</span>'
        : acc.total > 0
          ? '<span class="status-pill" style="background:#3a2e0022;color:#fbbf24">Con saldo</span>'
          : '<span class="status-pill" style="background:#1c1c1c;color:#6b7280">Vacía</span>'
      }</td>
      <td>${!acc.is_closed && acc.total > 0
        ? `<button class="btn btn-sm btn-primary" onclick="adminCloseBarAccount('${acc.id}',${acc.slot})">💳 Cobrar</button>`
        : '—'
      }</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty-state">Sin cuentas. Inicializá el evento.</td></tr>';
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
          ${!ev.is_active ? `<button class="btn btn-sm btn-success" onclick="activateEvent('${ev.id}')">Activar</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="deleteEvent('${ev.id}')">🗑</button>
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

// ─── Add/Edit attendee modal ──────────────────────────────────────────────────
function openAddAttendee() {
  showModal(`
    <h3 style="margin:0 0 18px">Agregar asistente</h3>
    <form id="attForm" autocomplete="off">
      <div class="form-grid">
        <div class="form-group"><label>Nombre *</label><input name="name" required/></div>
        <div class="form-group"><label>Estado</label>
          <select name="status">
            <option value="invited">Invitado</option><option value="crew">Crew</option>
            <option value="in_process">En proceso</option><option value="paid">Pago</option>
          </select>
        </div>
        <div class="form-group"><label>Cuenta barra #</label><input name="bar_account_slot" type="number" min="1"/></div>
        <div class="form-group"><label>Cédula</label><input name="cedula"/></div>
        <div class="form-group"><label>Email</label><input name="email" type="email"/></div>
        <div class="form-group"><label>Teléfono</label><input name="phone"/></div>
        <div class="form-group"><label>Pago entrada $</label><input name="entry_amount" type="number" min="0" value="0"/></div>
        <div class="form-group"><label>Notas</label><input name="notes"/></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Guardar</button>
        <button type="button" class="btn" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </form>
  `);
  document.getElementById('attForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const obj = Object.fromEntries(fd.entries());
    if (!activeEvent) { toast('No hay evento activo', 'error'); return; }
    obj.event_id = activeEvent.id;
    if (!obj.bar_account_slot) delete obj.bar_account_slot; else obj.bar_account_slot = parseInt(obj.bar_account_slot);
    if (!obj.entry_amount) obj.entry_amount = 0; else obj.entry_amount = parseFloat(obj.entry_amount);
    const db = getDb();
    const { error } = await db.from('attendees').insert(obj);
    if (error) toast('Error: ' + error.message, 'error');
    else { toast('Asistente agregado', 'success'); closeModal(); await loadAll(); }
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
            ${['invited','crew','in_process','paid','no_show'].map(s=>`<option value="${s}" ${att.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}
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
  const db = getDb();
  const { error } = await db.from('attendees').delete().eq('id', id);
  if (error) toast('Error: ' + error.message, 'error');
  else { attendees = attendees.filter(a => a.id !== id); renderAttendeesTable(); }
}

// ─── Admin close bar account ──────────────────────────────────────────────────
async function adminCloseBarAccount(barAccountId, slot) {
  if (!confirm(`¿Cobrar cuenta #${padId(slot)}?`)) return;
  const photoBlob = await openCamera();
  let photoUrl = null;
  if (photoBlob) photoUrl = await uploadPaymentPhoto(photoBlob, activeEvent.id, slot);

  const db = getDb();
  const { data, error } = await db.rpc('close_bar_account', {
    p_account_id: barAccountId, p_closed_by: 'admin', p_photo_url: photoUrl,
  });
  if (error || !data?.ok) toast(data?.error || error?.message || 'Error', 'error');
  else { toast(`Cuenta ${padId(slot)} cobrada — ${formatMoney(data.total)}`, 'success'); await loadAll(); }
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

// ─── Utility ──────────────────────────────────────────────────────────────────
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ─── UI setup ─────────────────────────────────────────────────────────────────
function setupUI() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', signOut);
  document.getElementById('exportBtn').addEventListener('click', exportToExcel);
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

  document.getElementById('addAttendeeBtn').addEventListener('click', openAddAttendee);
  document.getElementById('addExpenseBtn').addEventListener('click', openAddExpense);
  document.getElementById('newEventBtn').addEventListener('click', openNewEvent);
  document.getElementById('initBarBtn').addEventListener('click', initBarAccounts);

  document.getElementById('attSearch').addEventListener('input', renderAttendeesTable);
  document.getElementById('attStatusFilter').addEventListener('change', renderAttendeesTable);
  document.getElementById('barFilter').addEventListener('change', renderBarTable);

  document.getElementById('importCsvBtn').addEventListener('click', () => {
    document.getElementById('csvFileInput').click();
  });
  document.getElementById('csvFileInput').addEventListener('change', async (e) => {
    if (e.target.files[0]) await importCsv(e.target.files[0]);
    e.target.value = '';
  });
}

document.addEventListener('DOMContentLoaded', init);
