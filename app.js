// ═══════════════════════════════════════════════════════════════════════════
// app.js — App de Barra (Supabase + tiempo real)
// ═══════════════════════════════════════════════════════════════════════════
console.log('BAR v3 2026-03-23');

const DEFAULT_ACCOUNT_COUNT = 120;
const ADD_READY_MS      = 500;
const SUBTRACT_READY_MS = 2000;
const CLOSE_READY_MS    = 1000;

let activeEvent   = null;
let accounts      = [];    // bar_accounts del evento activo
let closures      = [];    // bar_closures del evento activo
let holdActive    = false;
let pendingRender = false;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const user = await requireAuth(['bar', 'admin']);
    if (!user) return;

    const displayName = user.displayName || user.email;
    document.getElementById('userChip').textContent = `🍹 ${displayName}`;
    setupUserDropdown();
    setupNotifChannel('Barra', displayName);

    activeEvent = await getActiveEvent();
    if (!activeEvent) {
      document.getElementById('app').style.display = 'block';
      document.getElementById('accountsList').innerHTML =
        '<div class="empty-state" style="padding:40px">No hay evento activo.<br><span style="font-size:13px;color:#6b7280">Creá un evento desde el panel Admin.</span></div>';
      renderSummary();
      return;
    }

    document.getElementById('eventName').textContent = `${activeEvent.name} — ${activeEvent.date}`;
    document.getElementById('app').style.display = 'block';

    await loadData();
    setupRealtime();
    setupUI();

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  } catch (e) {
    if (e.message !== 'SETUP_REQUIRED') console.error('Init error:', e);
  }
}

async function loadData() {
  const db = getDb();
  const [accsRes, closRes] = await Promise.all([
    db.from('bar_accounts').select('*, attendees(name,status)').eq('event_id', activeEvent.id).order('slot'),
    db.from('bar_closures').select('*, attendees(name)').eq('event_id', activeEvent.id).order('closed_at', { ascending: false }),
  ]);
  if (accsRes.data) accounts = accsRes.data;
  if (closRes.data) closures = closRes.data;
  renderAll();
}

// ─── Real-time ────────────────────────────────────────────────────────────────
// Recarga completa desde la DB para mantener joins (attendees) y manejar
// cualquier cambio del admin (reabrir cuentas, borrar cierres, etc.)
async function reloadFromDB() {
  const db = getDb();
  const [accsRes, closRes] = await Promise.all([
    db.from('bar_accounts').select('*, attendees(name,status)').eq('event_id', activeEvent.id).order('slot'),
    db.from('bar_closures').select('*, attendees(name)').eq('event_id', activeEvent.id).order('closed_at', { ascending: false }),
  ]);
  if (accsRes.data) accounts = accsRes.data;
  if (closRes.data) closures = closRes.data;
  renderIfNotHolding();
}

function setupRealtime() {
  const db = getDb();
  db.channel('bar-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bar_accounts',
        filter: `event_id=eq.${activeEvent.id}` }, reloadFromDB)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bar_closures',
        filter: `event_id=eq.${activeEvent.id}` }, reloadFromDB)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendees',
        filter: `event_id=eq.${activeEvent.id}` }, reloadFromDB)
    .subscribe();

  // Polling de respaldo cada 8s (por si el realtime se cae)
  setInterval(() => loadData(), 8000);

  // Recargar cuando la pantalla vuelve al foco (ej: se desbloquea el teléfono)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadData();
  });
}

function renderIfNotHolding() {
  if (holdActive) { pendingRender = true; return; }
  renderAll();
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderAll() {
  renderSummary();
  renderAccounts();
  renderPaidTable();
}

function renderSummary() {
  const openAcc  = accounts.filter(a => !a.is_closed);
  const openTot  = openAcc.reduce((s, a) => s + Number(a.total || 0), 0);
  const paidTot  = closures.reduce((s, c) => s + Number(c.total || 0), 0);
  const q160     = accounts.reduce((s,a)=>s+a.qty160,0) + closures.reduce((s,c)=>s+c.qty160,0);
  const q260     = accounts.reduce((s,a)=>s+a.qty260,0) + closures.reduce((s,c)=>s+c.qty260,0);
  const q360     = accounts.reduce((s,a)=>s+a.qty360,0) + closures.reduce((s,c)=>s+c.qty360,0);
  document.getElementById('openTotal').textContent  = formatMoney(openTot);
  document.getElementById('paidTotal').textContent  = formatMoney(paidTot);
  document.getElementById('all160').textContent     = q160;
  document.getElementById('all260').textContent     = q260;
  document.getElementById('all360').textContent     = q360;
  document.getElementById('grandTotal').textContent = formatMoney(openTot + paidTot);
}

function renderAccounts() {
  const wrap        = document.getElementById('accountsList');
  const searchDig   = document.getElementById('searchInput').value.replace(/\D/g, '');
  // Mostrar solo cuentas abiertas vinculadas a asistentes
  const list        = accounts.filter(a => !a.is_closed && a.attendee_id);
  const filtered    = searchDig ? list.filter(a => String(a.slot).padStart(3,'0').includes(searchDig)) : list;

  wrap.innerHTML = '';
  if (!filtered.length) {
    wrap.innerHTML = '<div class="empty-state">No hay cuentas para mostrar.</div>';
    return;
  }

  for (const acc of filtered) {
    const id      = padId(acc.slot);
    const name    = acc.attendees?.name || '';
    // Buscar el cierre correspondiente para mostrar foto de pago
    const closure = acc.is_closed ? closures.find(c => c.slot === acc.slot) : null;
    const photoUrl = closure?.payment_photo_url || null;

    const card = document.createElement('article');
    card.className = `account-card ${acc.is_closed ? 'is-closed' : ''} ${!acc.is_closed && acc.total > 0 ? 'has-balance' : ''}`;
    card.innerHTML = `
      <div class="account-top">
        <div>
          <div class="account-id">ID ${id}</div>
          ${name ? `<div class="account-name">${name}</div>` : ''}
          ${acc.is_closed ? '<span class="closed-badge">cerrada</span>' : ''}
        </div>
        <div class="account-total">${formatMoney(acc.total)}</div>
      </div>
      <div class="account-stats">
        <div class="pill">160: <strong>${acc.qty160}</strong></div>
        <div class="pill">260: <strong>${acc.qty260}</strong></div>
        <div class="pill">360: <strong>${acc.qty360}</strong></div>
      </div>
      ${acc.is_closed
        ? `<div class="account-actions" style="grid-template-columns:1fr">
             ${photoUrl
               ? `<button class="btn-photo" data-photo="${photoUrl}">
                    <svg width="15" height="15"><use href="#i-camera"/></svg> Ver comprobante
                  </button>`
               : `<span style="font-size:12px;color:var(--muted);padding:6px 4px">Sin foto de pago</span>`
             }
           </div>`
        : `<div class="account-actions">
             <button class="action-btn btn-160" data-id="${acc.id}" data-slot="${acc.slot}" data-amount="160">+160<span class="hold-bar"></span><span class="subtract-bar"></span></button>
             <button class="action-btn btn-260" data-id="${acc.id}" data-slot="${acc.slot}" data-amount="260">+260<span class="hold-bar"></span><span class="subtract-bar"></span></button>
             <button class="action-btn btn-360" data-id="${acc.id}" data-slot="${acc.slot}" data-amount="360">+360<span class="hold-bar"></span><span class="subtract-bar"></span></button>
             <button class="action-btn btn-close ${acc.total === 0 ? 'hidden' : ''}" onclick="doCloseAccount('${acc.id}',${acc.slot})">Cerrar</button>
           </div>`
      }
    `;
    wrap.appendChild(card);
  }

  // Listener para botones de foto (delegación de eventos)
  wrap.querySelectorAll('.btn-photo').forEach(btn => {
    btn.addEventListener('click', () => showPaymentPhotoModal(btn.dataset.photo));
  });
}

function renderPaidTable() {
  const tbody = document.getElementById('paidTableBody');
  tbody.innerHTML = '';
  if (!closures.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Sin cuentas cobradas todavía.</td></tr>';
    return;
  }
  for (const c of closures) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${padId(c.slot)}</strong></td>
      <td>${c.attendees?.name || '—'}</td>
      <td><strong>${formatMoney(c.total)}</strong></td>
      <td>${c.qty160}</td><td>${c.qty260}</td><td>${c.qty360}</td>
      <td>${c.closed_by || '—'}</td>
      <td>${c.closed_at ? new Date(c.closed_at).toLocaleString('es-UY') : '—'}</td>
      <td>${c.payment_photo_url
        ? `<button class="btn-photo" data-photo="${c.payment_photo_url}" style="font-size:12px !important;padding:7px 11px !important">
             <svg width="13" height="13"><use href="#i-camera"/></svg> Ver
           </button>`
        : '—'}</td>
    `;
    tbody.appendChild(tr);
  }
  // Listeners para botones de foto en historial
  tbody.querySelectorAll('.btn-photo').forEach(btn => {
    btn.addEventListener('click', () => showPaymentPhotoModal(btn.dataset.photo));
  });
}

// ─── Lightbox de foto de pago ─────────────────────────────────────────────────
function showPaymentPhotoModal(url) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:99999;
    display:flex;align-items:center;justify-content:center;
    animation:fadeInUp .15s ease;
  `;
  overlay.innerHTML = `
    <div style="position:relative;max-width:92vw;max-height:92vh">
      <img src="${url}" alt="Comprobante de pago"
        style="max-width:100%;max-height:88vh;border-radius:14px;display:block;box-shadow:0 8px 40px rgba(0,0,0,.6)">
      <button id="closePhotoModal"
        style="position:absolute;top:-14px;right:-14px;width:34px;height:34px;
          border-radius:50%;background:#ef4444;border:none;color:#fff;
          font-size:18px;cursor:pointer;font-weight:bold;line-height:1">✕</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#closePhotoModal').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ─── Hold interaction ─────────────────────────────────────────────────────────
const activeHolds = new Map();

function animateHoldBar(btn, ms) {
  const bar = btn.querySelector('.hold-bar');
  if (!bar) return;
  bar.style.transition = 'none'; bar.style.width = '0%';
  void bar.offsetWidth;
  bar.style.transition = `width ${ms}ms linear`;
  bar.style.width = '100%';
}

function clearHold(pointerId) {
  const d = activeHolds.get(pointerId);
  if (!d) return;
  d.timers.forEach(clearTimeout);
  activeHolds.delete(pointerId);
  const btn = d.btn;
  btn.classList.remove('hold-ready-add','hold-ready-subtract','hold-ready-close');
  const bar  = btn.querySelector('.hold-bar');
  const sbar = btn.querySelector('.subtract-bar');
  if (bar)  { bar.style.transition='none';  bar.style.width='0%'; }
  if (sbar) { sbar.style.transition='none'; sbar.style.width='0%'; }
  if (activeHolds.size === 0) {
    holdActive = false;
    if (pendingRender) { pendingRender=false; renderAll(); }
  }
}

function setupHoldInteractions() {
  const list = document.getElementById('accountsList');

  list.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.action-btn');
    // El botón Cerrar ahora usa onclick directo — solo manejamos +/- aquí
    if (!btn || btn.disabled || btn.classList.contains('btn-close')) return;
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    holdActive = true;
    const d = { btn, addReady:false, subtractReady:false, timers:[] };
    activeHolds.set(e.pointerId, d);

    animateHoldBar(btn, ADD_READY_MS);
    d.timers.push(setTimeout(() => {
      d.addReady = true;
      btn.classList.add('hold-ready-add');
      if (navigator.vibrate) navigator.vibrate(20);

      // Solo iniciar animación de restar si hay tragos de ese tipo
      const amount = parseInt(btn.dataset.amount, 10);
      const currentAcc = accounts.find(a => a.id === btn.dataset.id);
      const qty = amount === 160 ? currentAcc?.qty160 : amount === 260 ? currentAcc?.qty260 : currentAcc?.qty360;
      if (qty > 0) {
        // Animación roja de derecha a izquierda
        const sbar = btn.querySelector('.subtract-bar');
        if (sbar) {
          sbar.style.transition = 'none'; sbar.style.width = '0%';
          void sbar.offsetWidth;
          sbar.style.transition = `width ${SUBTRACT_READY_MS - ADD_READY_MS}ms linear`;
          sbar.style.width = '100%';
        }
      }
    }, ADD_READY_MS));
    d.timers.push(setTimeout(() => {
      const amount = parseInt(btn.dataset.amount, 10);
      const currentAcc = accounts.find(a => a.id === btn.dataset.id);
      const qty = amount === 160 ? currentAcc?.qty160 : amount === 260 ? currentAcc?.qty260 : currentAcc?.qty360;
      if (qty > 0) {
        d.subtractReady = true;
        btn.classList.remove('hold-ready-add');
        btn.classList.add('hold-ready-subtract');
        if (navigator.vibrate) navigator.vibrate([30,20,30]);
      }
    }, SUBTRACT_READY_MS));
  }, { passive: false });

  list.addEventListener('pointerup', async (e) => {
    const d = activeHolds.get(e.pointerId);
    if (!d) return;
    const btn = d.btn;
    const { addReady, subtractReady } = d;
    const id     = btn.dataset.id;
    const amount = parseInt(btn.dataset.amount, 10);
    clearHold(e.pointerId);

    if (subtractReady) await doSubtractDrink(id, amount);
    else if (addReady) await doAddDrink(id, amount);
  });

  list.addEventListener('pointercancel', (e) => clearHold(e.pointerId));
  list.addEventListener('contextmenu', (e) => { if (e.target.closest('.action-btn')) e.preventDefault(); }, { passive: false });
}

// ─── DB actions ───────────────────────────────────────────────────────────────
async function doAddDrink(accountId, amount) {
  const db   = getDb();
  const { data, error } = await db.rpc('add_drink', { p_account_id: accountId, p_amount: amount });
  if (error || !data?.ok) toast(data?.error || error?.message || 'Error al agregar', 'error');
  else {
    // Auto-marcar como llegado si no lo está
    const acc = accounts.find(a => a.id === accountId);
    if (acc?.attendee_id) {
      const { data: att } = await db.from('attendees').select('entered').eq('id', acc.attendee_id).single();
      if (att && !att.entered) {
        await db.from('attendees').update({ entered: true, entry_time: new Date().toISOString() }).eq('id', acc.attendee_id);
      }
    }
    await loadData();
  }
}

async function doSubtractDrink(accountId, amount) {
  const db   = getDb();
  const { data, error } = await db.rpc('subtract_drink', { p_account_id: accountId, p_amount: amount });
  if (error || !data?.ok) toast(data?.error || error?.message || 'Error al restar', 'error');
  else { await loadData(); }
}

async function doCloseAccount(accountId, slot) {
  const acc      = accounts.find(a => a.id === accountId);
  const ownTotal = Number(acc?.total || 0);

  // 1. Seleccionar método + checkbox "pagar por otros"
  const methodResult = await showPaymentMethodSelector(ownTotal, true);
  if (!methodResult) return;

  // 2. Si marcó "pagar por otros" → mostrar selector de otras cuentas
  let coveredAccounts = [];
  let combinedTotal   = ownTotal;

  if (methodResult.payForOthers) {
    const openOthers = accounts.filter(a => !a.is_closed && a.attendee_id && a.total > 0 && a.id !== accountId);
    const othersResult = await showPayForOthersScreen(slot, ownTotal, openOthers);
    if (othersResult === null) return;
    coveredAccounts = othersResult.coveredAccounts;
    combinedTotal   = othersResult.combinedTotal;
  }

  // 3. Si es efectivo → calculadora con total final
  let cashReceived = methodResult.cashReceived;
  let changeGiven  = methodResult.changeGiven;
  if (methodResult.method === 'cash') {
    if (methodResult.payForOthers) {
      const cashResult = await showCashCalculator(combinedTotal);
      if (!cashResult) return;
      cashReceived = cashResult.cashReceived;
      changeGiven  = cashResult.changeGiven;
    } else {
      cashReceived = methodResult.cashReceived;
      changeGiven  = methodResult.changeGiven;
    }
  }

  // 4. Si es transferencia → foto obligatoria
  let photoUrl = null;
  if (methodResult.method === 'transfer') {
    const photoBlob = await openCamera(true);
    if (!photoBlob) return;
    photoUrl = await uploadPaymentPhoto(photoBlob, activeEvent.id, slot);
  }

  // 5. Cerrar cuenta principal
  const db = getDb();
  const { data, error } = await db.rpc('close_bar_account', {
    p_account_id: accountId, p_closed_by: 'bar', p_photo_url: photoUrl,
  });
  if (error || !data?.ok) { toast(data?.error || error?.message || 'Error al cerrar', 'error'); return; }

  await db.from('bar_closures')
    .update({ payment_method: methodResult.method, cash_received: cashReceived, change_given: changeGiven })
    .eq('event_id', activeEvent.id).eq('slot', slot);

  // 6. Cerrar cuentas de otros
  for (const other of coveredAccounts) {
    await db.rpc('close_bar_account', { p_account_id: other.id, p_closed_by: 'bar', p_photo_url: photoUrl });
    await db.from('bar_closures')
      .update({ payment_method: methodResult.method, paid_by_slot: slot })
      .eq('event_id', activeEvent.id).eq('slot', other.slot);
  }

  // 7. UI
  const closedSlots = [slot, ...coveredAccounts.map(a => a.slot)];
  closedSlots.forEach(s => { const i = accounts.findIndex(a => a.slot === s); if (i >= 0) accounts[i].is_closed = true; });
  const extra = coveredAccounts.length ? ` + ${coveredAccounts.length} cuenta${coveredAccounts.length > 1 ? 's' : ''} ajena${coveredAccounts.length > 1 ? 's' : ''}` : '';
  toast(`Cuenta ${padId(slot)} cerrada — ${formatMoney(combinedTotal)}${extra}`, 'success');
  await loadData();
}

// ─── Export Excel ─────────────────────────────────────────────────────────────
function exportToExcel() {
  if (typeof XLSX === 'undefined') { toast('Librería Excel no disponible', 'error'); return; }

  const openTot = accounts.filter(a=>!a.is_closed).reduce((s,a)=>s+Number(a.total),0);
  const paidTot = closures.reduce((s,c)=>s+Number(c.total),0);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Why Not Bar — Resumen'], ['Evento', activeEvent?.name], ['Fecha', activeEvent?.date],
    [], ['Abiertas total', openTot], ['Cobradas total', paidTot], ['Total general', openTot+paidTot],
  ]), 'Resumen');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ID','Nombre','Total','#160','#260','#360','Cerrada por','Hora'],
    ...closures.map(c=>[padId(c.slot),c.attendees?.name||'',c.total,c.qty160,c.qty260,c.qty360,c.closed_by,c.closed_at]),
  ]), 'Cuentas cobradas');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ID','Nombre','Total','#160','#260','#360'],
    ...accounts.filter(a=>!a.is_closed&&a.total>0).map(a=>[padId(a.slot),a.attendees?.name||'',a.total,a.qty160,a.qty260,a.qty360]),
  ]), 'Cuentas abiertas');

  XLSX.writeFile(wb, `whynot-${activeEvent?.date || 'barra'}.xlsx`);
}

// ─── Reset ────────────────────────────────────────────────────────────────────
async function doReset() {
  const numStr = window.prompt('¿Cuántas cuentas querés crear?\n(Entre 1 y 500)', String(DEFAULT_ACCOUNT_COUNT));
  if (numStr === null) return;
  const num = parseInt(numStr.trim(), 10);
  if (isNaN(num) || num < 1 || num > 500) { window.alert('Número inválido.'); return; }
  if (!window.confirm(`⚠️  Esto borra TODAS las cuentas del evento y crea ${num} nuevas.\n¿Confirmar?`)) return;

  const db = getDb();
  const { data, error } = await db.rpc('init_bar_accounts', { p_event_id: activeEvent.id, p_count: num });
  if (error || !data?.ok) { toast('Error al resetear: ' + (error?.message || data?.error), 'error'); return; }
  toast(`${num} cuentas creadas`, 'success');
  await loadData();
}

// ─── UI setup ─────────────────────────────────────────────────────────────────
function setupUI() {
  setupTabs();
  setupHoldInteractions();

  document.getElementById('searchInput').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^\d]/g, '');
    renderAccounts();
  });
  document.getElementById('clearSearchBtn').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    renderAccounts();
  });

  document.getElementById('logoutBtn').addEventListener('click', signOut);
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
