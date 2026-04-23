// ═══════════════════════════════════════════════════════════════════════════
// portero.js — App del Portero
// ═══════════════════════════════════════════════════════════════════════════
console.log('PORTERO v3 2026-03-23');

let activeEvent  = null;
let attendees    = [];
let barAccounts  = [];
let eventSettings = { door_can_charge: false };
let currentFilter = 'all';
let selectedPersonId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const user = await requireAuth(['door', 'admin']);
    if (!user) return;
    const displayName = user.displayName || user.email;
    document.getElementById('userChip').textContent = `🚪 ${displayName}`;
    setupUserDropdown();
    setupNotifChannel('Portería', displayName);

    activeEvent = await getActiveEvent();
    if (!activeEvent) {
      document.getElementById('app').style.display = 'block';
      document.getElementById('attendeeList').innerHTML =
        '<div class="empty-state" style="padding:40px">No hay evento activo.</div>';
      return;
    }
    document.getElementById('eventName').textContent = activeEvent.name;
    document.getElementById('app').style.display = 'block';

    await loadData();
    setupRealtime();
    setupUI();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  } catch (e) {
    if (e.message !== 'SETUP_REQUIRED') console.error('Portero init error:', e);
  }
}

async function loadData() {
  const db = getDb();
  const [attRes, barRes, settingsRes] = await Promise.all([
    db.from('attendees').select('*').eq('event_id', activeEvent.id).order('name'),
    db.from('bar_accounts').select('*').eq('event_id', activeEvent.id).order('slot'),
    db.from('event_settings').select('*').eq('event_id', activeEvent.id).maybeSingle(),
  ]);
  if (attRes.data) attendees = attRes.data;
  if (barRes.data) barAccounts = barRes.data;
  if (settingsRes.data) eventSettings = settingsRes.data;
  renderAll();
}

function setupRealtime() {
  const db = getDb();
  db.channel('portero-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendees', filter: `event_id=eq.${activeEvent.id}` },
      (p) => {
        if (p.eventType === 'UPDATE') {
          const i = attendees.findIndex(a => a.id === p.new.id);
          if (i >= 0) attendees[i] = { ...attendees[i], ...p.new };
        } else if (p.eventType === 'INSERT') {
          attendees.push(p.new);
        } else if (p.eventType === 'DELETE') {
          const i = attendees.findIndex(a => a.id === p.old.id);
          if (i >= 0) attendees.splice(i, 1);
        }
        renderAll();
        if (selectedPersonId === p.new?.id) renderModal(p.new.id);
      })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bar_accounts', filter: `event_id=eq.${activeEvent.id}` },
      (p) => {
        if (p.eventType === 'UPDATE') {
          const i = barAccounts.findIndex(a => a.id === p.new.id);
          if (i >= 0) barAccounts[i] = { ...barAccounts[i], ...p.new };
        }
        renderAll();
        if (selectedPersonId) renderModal(selectedPersonId);
      })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_settings', filter: `event_id=eq.${activeEvent.id}` },
      (p) => {
        if (p.new) eventSettings = p.new;
        renderAll();
        if (selectedPersonId) renderModal(selectedPersonId);
      })
    .subscribe();

  // Polling de respaldo cada 8s
  setInterval(() => loadData(), 8000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadData();
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderAll() {
  renderStats();
  renderList();
}

function renderStats() {
  const total   = attendees.length;
  const entered = attendees.filter(a => a.entered).length;
  document.getElementById('statTotal').textContent   = total;
  document.getElementById('statEntered').textContent = entered;
  document.getElementById('statPending').textContent = Math.max(0, total - entered);
}

function renderList() {
  const container = document.getElementById('attendeeList');
  const search    = document.getElementById('searchInput').value.trim().toLowerCase();

  let list = attendees.filter(a => {
    if (search && !a.name.toLowerCase().includes(search)) return false;
    if (currentFilter === 'inside')  return a.entered && !a.exit_time;
    if (currentFilter === 'pending') return !a.entered;
    if (currentFilter === 'exited')  return !!a.exit_time;
    return true;
  });

  // Sort: not entered first → entered (no exit) → exited
  list.sort((a, b) => {
    const rankA = a.exit_time ? 2 : a.entered ? 1 : 0;
    const rankB = b.exit_time ? 2 : b.entered ? 1 : 0;
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name);
  });

  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">Sin resultados.</div>';
    return;
  }

  for (const att of list) {
    const barAcc = att.bar_account_slot ? barAccounts.find(b => b.slot === att.bar_account_slot) : null;
    const canCharge   = eventSettings.door_can_charge;
    const hasBalance  = barAcc && !barAcc.is_closed && barAcc.total > 0;
    const barClosed   = barAcc?.is_closed;
    // If portero can't charge, they can let people exit even with open balance
    const canExit     = att.entered && !att.exit_time && (!hasBalance || !canCharge);
    const alreadyOut  = !!att.exit_time;

    // Tiene consumo en barra sin pagar
    const hasUnpaidBar = barAcc && !barAcc.is_closed && barAcc.total > 0;

    const card = document.createElement('div');
    card.className = `att-card ${att.entered ? (alreadyOut ? 'att-exited' : 'att-inside') : 'att-pending'} ${hasUnpaidBar ? 'att-unpaid' : ''} ${att.status === 'crew' ? 'att-crew' : ''}`;

    card.innerHTML = `
      <div class="att-main" data-id="${att.id}">
        <div class="att-info">
          <div class="att-name">
            <span>${att.name}</span>
            ${att.status === 'crew' ? '<span class="att-tag att-tag-crew">CREW</span>' : ''}
            ${hasUnpaidBar ? `<span class="att-tag att-tag-unpaid"><svg width="11" height="11"><use href="#i-warn"/></svg> Debe ${formatMoney(barAcc.total)}</span>` : ''}
          </div>
          <div class="att-meta">
            ${att.bar_account_slot ? `<span class="att-bar-num">#${padId(att.bar_account_slot)}</span>` : ''}
            ${alreadyOut ? '<span class="att-tag att-tag-out">Salió</span>' : att.entered ? '<span class="att-tag att-tag-in"><svg width="11" height="11"><use href="#i-check"/></svg> Adentro</span>' : ''}
          </div>
          ${canCharge && barAcc ? `<div class="att-consumption">
            Barra: <strong>${formatMoney(barAcc.total)}</strong>
            ${barClosed ? '<span class="att-tag att-tag-paid"><svg width="11" height="11"><use href="#i-check"/></svg> Cobrado</span>' : hasBalance ? '<span class="att-tag att-tag-open">Abierta</span>' : ''}
          </div>` : ''}
        </div>
        <div class="att-actions" onclick="event.stopPropagation()">
          ${!att.entered && !alreadyOut ? `<button class="att-btn att-btn-enter" onclick="doCheckIn('${att.id}')"><svg width="14" height="14"><use href="#i-check"/></svg> Ingresar</button>` : ''}
          ${canExit ? `<button class="att-btn att-btn-exit" onclick="doExit('${att.id}')"><svg width="14" height="14"><use href="#i-door-out"/></svg> Salida</button>` : ''}
          ${canCharge && hasBalance && att.entered && !alreadyOut ? `<button class="att-btn att-btn-close" onclick="openPersonModal('${att.id}')"><svg width="14" height="14"><use href="#i-card"/></svg> Cobrar</button>` : ''}
        </div>
      </div>
    `;
    container.appendChild(card);
  }
}

// ─── Check in ─────────────────────────────────────────────────────────────────
async function doCheckIn(attendeeId) {
  const db  = getDb();
  const now = new Date().toISOString();

  // Update optimista: actualizar UI antes de esperar respuesta del servidor
  const i = attendees.findIndex(a => a.id === attendeeId);
  const prev = i >= 0 ? { ...attendees[i] } : null;
  if (i >= 0) { attendees[i].entered = true; attendees[i].entry_time = now; }
  renderAll();

  const { error } = await db.from('attendees')
    .update({ entered: true, entry_time: now })
    .eq('id', attendeeId);
  if (error) {
    // Revertir si falla
    if (i >= 0 && prev) attendees[i] = prev;
    renderAll();
    toast('Error al registrar ingreso', 'error');
  } else {
    toast('✓ Ingreso registrado', 'success');
  }
}

// ─── Exit ─────────────────────────────────────────────────────────────────────
async function doExit(attendeeId) {
  const db  = getDb();
  const now = new Date().toISOString();

  // Update optimista: actualizar UI antes de esperar respuesta del servidor
  const i = attendees.findIndex(a => a.id === attendeeId);
  const prev = i >= 0 ? { ...attendees[i] } : null;
  if (i >= 0) { attendees[i].exit_time = now; }
  renderAll();
  if (selectedPersonId === attendeeId) closeModal();

  const { data, error } = await db.rpc('mark_exit', { p_attendee_id: attendeeId });
  if (error) {
    // Revertir si hay error de red/DB
    if (i >= 0 && prev) attendees[i] = prev;
    renderAll();
    toast(error.message || 'No se pudo registrar salida', 'error');
  } else if (data?.error) {
    // El RPC devolvió un error lógico (ej: cuenta abierta)
    if (i >= 0 && prev) attendees[i] = prev;
    renderAll();
    toast(data.error, 'error');
  } else {
    toast('✓ Salida registrada', 'success');
  }
}

// ─── Close bar account (from door) ───────────────────────────────────────────
async function doCloseBarAccount(barAccountId, slot) {
  const barAcc = barAccounts.find(b => b.id === barAccountId);
  const total  = Number(barAcc?.total || 0);

  const payment = await showPaymentMethodSelector(total);
  if (!payment) return;

  let photoUrl = null;
  if (payment.method === 'transfer') {
    const photoBlob = await openCamera();
    if (photoBlob) photoUrl = await uploadPaymentPhoto(photoBlob, activeEvent.id, slot);
  }

  const db = getDb();
  const { data, error } = await db.rpc('close_bar_account', {
    p_account_id: barAccountId,
    p_closed_by:  'door',
    p_photo_url:  photoUrl,
  });

  if (error || !data?.ok) {
    toast(data?.error || error?.message || 'Error al cobrar', 'error');
    return;
  }

  // Guardar método de pago (columnas opcionales, falla silenciosamente si no existen)
  db.from('bar_closures').select('id').eq('event_id', activeEvent.id).eq('slot', slot)
    .order('closed_at', { ascending: false }).limit(1).single()
    .then(({ data: c }) => {
      if (c) db.from('bar_closures').update({
        payment_method: payment.method,
        cash_received:  payment.cashReceived,
        change_given:   payment.changeGiven,
      }).eq('id', c.id).then(() => {}).catch(() => {});
    });

  toast(`Cuenta ${padId(slot)} cobrada — ${formatMoney(data.total)}`, 'success');

  // Auto-registrar salida si la persona estaba adentro
  if (selectedPersonId) {
    const att = attendees.find(a => a.id === selectedPersonId);
    if (att && att.entered && !att.exit_time) {
      await doExit(selectedPersonId);
    }
  }
  closeModal();
}

// ─── Person modal ─────────────────────────────────────────────────────────────
function openPersonModal(id) {
  selectedPersonId = id;
  renderModal(id);
  document.getElementById('personModal').classList.remove('hidden');
}

function renderModal(id) {
  const att    = attendees.find(a => a.id === id);
  if (!att) return;
  const barAcc = att.bar_account_slot ? barAccounts.find(b => b.slot === att.bar_account_slot) : null;
  const hasBalance = barAcc && !barAcc.is_closed && barAcc.total > 0;
  const canCharge  = eventSettings.door_can_charge;

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-person-header">
      <div class="modal-person-name">${att.name}</div>
      <span class="status-pill" style="background:${statusColor(att.status)}22;color:${statusColor(att.status)};font-size:13px">${statusLabel(att.status)}</span>
    </div>

    <div class="modal-info-grid">
      ${att.cedula   ? `<div class="modal-info-item"><span>Cédula</span><strong>${att.cedula}</strong></div>` : ''}
      ${att.email    ? `<div class="modal-info-item"><span>Email</span><strong>${att.email}</strong></div>` : ''}
      ${att.phone    ? `<div class="modal-info-item"><span>Teléfono</span><strong>${att.phone}</strong></div>` : ''}
      ${att.entry_time ? `<div class="modal-info-item"><span>Ingresó</span><strong>${new Date(att.entry_time).toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'})}</strong></div>` : ''}
      ${att.exit_time  ? `<div class="modal-info-item"><span>Salió</span><strong>${new Date(att.exit_time).toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'})}</strong></div>` : ''}
      ${att.entry_amount > 0 ? `<div class="modal-info-item"><span>Pago entrada</span><strong>${formatMoney(att.entry_amount)}</strong></div>` : ''}
    </div>

    ${canCharge && barAcc ? `
    <div class="modal-bar-section">
      <div class="modal-bar-header">
        <span>Cuenta barra #${padId(barAcc.slot)}</span>
        ${barAcc.is_closed ? '<span class="att-tag att-tag-paid"><svg width="11" height="11"><use href="#i-check"/></svg> Cobrada</span>' : '<span class="att-tag att-tag-open">Abierta</span>'}
      </div>
      <div class="modal-bar-total">${formatMoney(barAcc.total)}</div>
      <div class="modal-bar-pills">
        <span class="pill">160: <strong>${barAcc.qty160}</strong></span>
        <span class="pill">260: <strong>${barAcc.qty260}</strong></span>
        <span class="pill">360: <strong>${barAcc.qty360}</strong></span>
      </div>
      ${att.payment_photo_url ? `<a href="${att.payment_photo_url}" target="_blank" class="modal-photo-link"><svg width="14" height="14"><use href="#i-camera"/></svg> Ver foto del pago</a>` : ''}
    </div>` : ''}

    <div class="modal-actions">
      ${!att.entered && !att.exit_time ? `<button class="btn btn-success" onclick="doCheckIn('${att.id}')"><svg width="15" height="15"><use href="#i-check"/></svg> Registrar ingreso</button>` : ''}
      ${att.entered && !att.exit_time && (!hasBalance || !canCharge) ? `<button class="btn btn-warning" onclick="doExit('${att.id}')"><svg width="15" height="15"><use href="#i-door-out"/></svg> Registrar salida</button>` : ''}
      ${canCharge && hasBalance && att.entered ? `<button class="btn btn-primary" onclick="doCloseBarAccount('${barAcc.id}', ${barAcc.slot})"><svg width="15" height="15"><use href="#i-card"/></svg> Cobrar cuenta</button>` : ''}
    </div>
    ${canCharge && hasBalance && att.entered && !att.exit_time ? `<p class="modal-warning"><svg width="12" height="12" style="vertical-align:-1px;margin-right:3px"><use href="#i-warn"/></svg> Tiene consumo sin pagar. No puede salir.</p>` : ''}
  `;
}

function closeModal() {
  selectedPersonId = null;
  document.getElementById('personModal').classList.add('hidden');
}

// ─── UI setup ─────────────────────────────────────────────────────────────────
function setupUI() {
  document.getElementById('searchInput').addEventListener('input', renderList);
  document.getElementById('clearSearchBtn').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    renderList();
  });
  document.getElementById('logoutBtn').addEventListener('click', signOut);
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('personModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
