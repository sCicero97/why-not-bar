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
let showClosed    = false;
let holdActive    = false;
let pendingRender = false;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const user = await requireAuth(['bar', 'admin']);
    if (!user) return;

    document.getElementById('userChip').textContent = `🍹 ${user.displayName || user.email}`;

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
function setupRealtime() {
  const db = getDb();
  db.channel('bar-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bar_accounts', filter: `event_id=eq.${activeEvent.id}` },
      (payload) => {
        if (payload.eventType === 'UPDATE') {
          const idx = accounts.findIndex(a => a.id === payload.new.id);
          if (idx >= 0) {
            accounts[idx] = { ...accounts[idx], ...payload.new };
          }
        }
        renderIfNotHolding();
      })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bar_closures', filter: `event_id=eq.${activeEvent.id}` },
      (payload) => {
        closures.unshift(payload.new);
        renderIfNotHolding();
      })
    .subscribe();
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
  const list        = showClosed ? accounts : accounts.filter(a => !a.is_closed);
  const filtered    = searchDig ? list.filter(a => String(a.slot).padStart(3,'0').includes(searchDig)) : list;

  wrap.innerHTML = '';
  if (!filtered.length) {
    wrap.innerHTML = '<div class="empty-state">No hay cuentas para mostrar.</div>';
    return;
  }

  for (const acc of filtered) {
    const id   = padId(acc.slot);
    const name = acc.attendees?.name || '';
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
      ${acc.is_closed ? '' : `
      <div class="account-actions">
        <button class="action-btn btn-160" data-id="${acc.id}" data-slot="${acc.slot}" data-amount="160">+160<span class="hold-bar"></span></button>
        <button class="action-btn btn-260" data-id="${acc.id}" data-slot="${acc.slot}" data-amount="260">+260<span class="hold-bar"></span></button>
        <button class="action-btn btn-360" data-id="${acc.id}" data-slot="${acc.slot}" data-amount="360">+360<span class="hold-bar"></span></button>
        <button class="action-btn btn-close ${acc.total === 0 ? 'hidden' : ''}" data-id="${acc.id}" data-slot="${acc.slot}" data-close="1">Cerrar<span class="hold-bar"></span></button>
      </div>`}
    `;
    wrap.appendChild(card);
  }
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
      <td style="font-size:12px;color:var(--muted)">${c.closed_at ? new Date(c.closed_at).toLocaleString('es-UY') : '—'}</td>
      <td>${c.payment_photo_url ? `<a href="${c.payment_photo_url}" target="_blank" style="color:var(--blue)">Ver foto</a>` : '—'}</td>
    `;
    tbody.appendChild(tr);
  }
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
  const bar = btn.querySelector('.hold-bar');
  if (bar) { bar.style.transition='none'; bar.style.width='0%'; }
  if (activeHolds.size === 0) {
    holdActive = false;
    if (pendingRender) { pendingRender=false; renderAll(); }
  }
}

function setupHoldInteractions() {
  const list = document.getElementById('accountsList');

  list.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    holdActive = true;
    const isClose = !!btn.dataset.close;
    const d = { btn, addReady:false, subtractReady:false, closeReady:false, timers:[] };
    activeHolds.set(e.pointerId, d);

    if (isClose) {
      animateHoldBar(btn, CLOSE_READY_MS);
      d.timers.push(setTimeout(() => {
        d.closeReady = true;
        btn.classList.add('hold-ready-close');
        if (navigator.vibrate) navigator.vibrate(30);
      }, CLOSE_READY_MS));
    } else {
      animateHoldBar(btn, ADD_READY_MS);
      d.timers.push(setTimeout(() => {
        d.addReady = true;
        btn.classList.add('hold-ready-add');
        if (navigator.vibrate) navigator.vibrate(20);
        animateHoldBar(btn, SUBTRACT_READY_MS - ADD_READY_MS);
      }, ADD_READY_MS));
      d.timers.push(setTimeout(() => {
        d.subtractReady = true;
        btn.classList.remove('hold-ready-add');
        btn.classList.add('hold-ready-subtract');
        if (navigator.vibrate) navigator.vibrate([30,20,30]);
      }, SUBTRACT_READY_MS));
    }
  }, { passive: false });

  list.addEventListener('pointerup', async (e) => {
    const d = activeHolds.get(e.pointerId);
    if (!d) return;
    const btn = d.btn;
    const { addReady, subtractReady, closeReady } = d;
    const id     = btn.dataset.id;
    const slot   = parseInt(btn.dataset.slot, 10);
    const amount = parseInt(btn.dataset.amount, 10);
    clearHold(e.pointerId);

    if (btn.dataset.close) {
      if (closeReady) await doCloseAccount(id, slot);
    } else {
      if (subtractReady) await doSubtractDrink(id, amount);
      else if (addReady) await doAddDrink(id, amount);
    }
  });

  list.addEventListener('pointercancel', (e) => clearHold(e.pointerId));
  list.addEventListener('contextmenu', (e) => { if (e.target.closest('.action-btn')) e.preventDefault(); }, { passive: false });
}

// ─── DB actions ───────────────────────────────────────────────────────────────
async function doAddDrink(accountId, amount) {
  const db   = getDb();
  const { data, error } = await db.rpc('add_drink', { p_account_id: accountId, p_amount: amount });
  if (error || !data?.ok) toast(data?.error || error?.message || 'Error al agregar', 'error');
}

async function doSubtractDrink(accountId, amount) {
  const db   = getDb();
  const { data, error } = await db.rpc('subtract_drink', { p_account_id: accountId, p_amount: amount });
  if (error || !data?.ok) toast(data?.error || error?.message || 'Error al restar', 'error');
}

async function doCloseAccount(accountId, slot) {
  // 1. Abrir cámara
  const photoBlob = await openCamera();
  let photoUrl = null;
  if (photoBlob) {
    photoUrl = await uploadPaymentPhoto(photoBlob, activeEvent.id, slot);
  }

  // 2. Cerrar en DB
  const db = getDb();
  const { data, error } = await db.rpc('close_bar_account', {
    p_account_id: accountId,
    p_closed_by:  'bar',
    p_photo_url:  photoUrl,
  });

  if (error || !data?.ok) {
    toast(data?.error || error?.message || 'Error al cerrar', 'error');
    return;
  }

  // Actualizar local inmediatamente
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx >= 0) accounts[idx].is_closed = true;
  toast(`Cuenta ${padId(slot)} cerrada — ${formatMoney(data.total)}`, 'success');
  renderAll();

  // Recargar cierres
  const { data: newClosure } = await db.from('bar_closures')
    .select('*, attendees(name)')
    .eq('event_id', activeEvent.id)
    .eq('slot', slot)
    .order('closed_at', { ascending: false })
    .limit(1)
    .single();
  if (newClosure) closures.unshift(newClosure);
  renderPaidTable();
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

  document.getElementById('toggleClosedBtn').addEventListener('click', () => {
    showClosed = !showClosed;
    document.getElementById('toggleClosedBtn').textContent = showClosed ? 'Ocultar cerradas' : 'Mostrar cerradas';
    renderAccounts();
  });

  document.getElementById('exportBtn').addEventListener('click', exportToExcel);
  document.getElementById('resetBtn').addEventListener('click', doReset);
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
