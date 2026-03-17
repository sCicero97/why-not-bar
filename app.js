const STORAGE_KEY = "cuentas-bar-app-v1";

const state = {
  accounts: [],
  paidAccounts: [],
};

let deferredPrompt = null;

function createInitialAccounts() {
  return Array.from({ length: 100 }, (_, index) => ({
    slot: index + 1,
    id: String(index + 1),
    total: 0,
    qty160: 0,
    qty260: 0,
    qty360: 0,
  }));
}

function defaultState() {
  return {
    accounts: createInitialAccounts(),
    paidAccounts: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = defaultState();
      state.accounts = initial.accounts;
      state.paidAccounts = initial.paidAccounts;
      saveState();
      return;
    }

    const parsed = JSON.parse(raw);

    state.accounts = Array.isArray(parsed.accounts) ? parsed.accounts : createInitialAccounts();
    state.paidAccounts = Array.isArray(parsed.paidAccounts) ? parsed.paidAccounts : [];
  } catch (error) {
    console.error("Error cargando estado:", error);
    const initial = defaultState();
    state.accounts = initial.accounts;
    state.paidAccounts = initial.paidAccounts;
    saveState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatMoney(value) {
  return `$ ${Number(value || 0).toLocaleString("es-UY")}`;
}

function nowString() {
  const d = new Date();
  return d.toLocaleString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

function nextVersionId(currentId) {
  const value = String(currentId).trim();

  if (!value.includes("-")) {
    return `${value}-b`;
  }

  const [base, suffix] = value.split("-");
  if (!suffix || suffix.length !== 1) return `${base}-b`;

  const code = suffix.toLowerCase().charCodeAt(0);
  if (code >= 97 && code < 122) {
    return `${base}-${String.fromCharCode(code + 1)}`;
  }

  return `${base}-z`;
}

function addDrink(slot, amount) {
  const account = state.accounts.find((a) => a.slot === slot);
  if (!account) return;

  account.total += amount;

  if (amount === 160) account.qty160 += 1;
  if (amount === 260) account.qty260 += 1;
  if (amount === 360) account.qty360 += 1;

  saveState();
  renderAll();
}

function closeAccount(slot) {
  const account = state.accounts.find((a) => a.slot === slot);
  if (!account) return;
  if (account.total === 0) return;

  state.paidAccounts.push({
    id: account.id,
    total: account.total,
    qty160: account.qty160,
    qty260: account.qty260,
    qty360: account.qty360,
    closedAt: nowString(),
  });

  account.id = nextVersionId(account.id);
  account.total = 0;
  account.qty160 = 0;
  account.qty260 = 0;
  account.qty360 = 0;

  saveState();
  renderAll();
}

function resetAll() {
  const ok = window.confirm("¿Seguro que querés borrar todas las cuentas abiertas y pagas?");
  if (!ok) return;

  const initial = defaultState();
  state.accounts = initial.accounts;
  state.paidAccounts = initial.paidAccounts;

  saveState();
  renderAll();
}

function clearPaidOnly() {
  const ok = window.confirm("¿Vaciar solo las cuentas pagas?");
  if (!ok) return;

  state.paidAccounts = [];
  saveState();
  renderAll();
}

function getOpenTotals() {
  return state.accounts.reduce(
    (acc, item) => {
      acc.total += item.total || 0;
      acc.qty160 += item.qty160 || 0;
      acc.qty260 += item.qty260 || 0;
      acc.qty360 += item.qty360 || 0;
      return acc;
    },
    { total: 0, qty160: 0, qty260: 0, qty360: 0 }
  );
}

function getPaidTotals() {
  return state.paidAccounts.reduce(
    (acc, item) => {
      acc.total += item.total || 0;
      acc.qty160 += item.qty160 || 0;
      acc.qty260 += item.qty260 || 0;
      acc.qty360 += item.qty360 || 0;
      return acc;
    },
    { total: 0, qty160: 0, qty260: 0, qty360: 0 }
  );
}

function renderSummary() {
  const open = getOpenTotals();
  const paid = getPaidTotals();

  document.getElementById("openTotal").textContent = formatMoney(open.total);
  document.getElementById("open160").textContent = open.qty160;
  document.getElementById("open260").textContent = open.qty260;
  document.getElementById("open360").textContent = open.qty360;

  document.getElementById("paidTotal").textContent = formatMoney(paid.total);
  document.getElementById("paidCounts").textContent = `${paid.qty160} / ${paid.qty260} / ${paid.qty360}`;
}

function renderAccounts() {
  const wrap = document.getElementById("accountsList");
  const search = document.getElementById("searchInput").value.trim().toLowerCase();

  const filtered = state.accounts.filter((account) =>
    account.id.toLowerCase().includes(search)
  );

  wrap.innerHTML = "";

  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state">No hay resultados.</div>`;
    return;
  }

  for (const account of filtered) {
    const card = document.createElement("article");
    card.className = "account-card";

    card.innerHTML = `
      <div class="account-top">
        <div class="account-id">ID ${account.id}</div>
        <div class="account-total">${formatMoney(account.total)}</div>
      </div>

      <div class="account-stats">
        <div class="pill">160: <strong>${account.qty160}</strong></div>
        <div class="pill">260: <strong>${account.qty260}</strong></div>
        <div class="pill">360: <strong>${account.qty360}</strong></div>
      </div>

      <div class="account-actions">
        <button class="action-btn btn-160" data-slot="${account.slot}" data-amount="160">+160</button>
        <button class="action-btn btn-260" data-slot="${account.slot}" data-amount="260">+260</button>
        <button class="action-btn btn-360" data-slot="${account.slot}" data-amount="360">+360</button>
        <button class="action-btn btn-close" data-slot="${account.slot}" data-close="1">Cerrar</button>
      </div>
    `;

    wrap.appendChild(card);
  }
}

function renderPaidTable() {
  const tbody = document.getElementById("paidTableBody");
  tbody.innerHTML = "";

  if (!state.paidAccounts.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">Todavía no hay cuentas pagas.</td>
      </tr>
    `;
    return;
  }

  const reversed = [...state.paidAccounts].reverse();

  for (const item of reversed) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.id}</td>
      <td>${formatMoney(item.total)}</td>
      <td>${item.qty160}</td>
      <td>${item.qty260}</td>
      <td>${item.qty360}</td>
      <td>${item.closedAt}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderAll() {
  renderSummary();
  renderAccounts();
  renderPaidTable();
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

function setupEvents() {
  document.getElementById("accountsList").addEventListener("click", (event) => {
    const amountBtn = event.target.closest("[data-amount]");
    const closeBtn = event.target.closest("[data-close]");

    if (amountBtn) {
      const slot = Number(amountBtn.dataset.slot);
      const amount = Number(amountBtn.dataset.amount);
      addDrink(slot, amount);
      return;
    }

    if (closeBtn) {
      const slot = Number(closeBtn.dataset.slot);
      closeAccount(slot);
    }
  });

  document.getElementById("searchInput").addEventListener("input", renderAccounts);
  document.getElementById("resetBtn").addEventListener("click", resetAll);
  document.getElementById("clearPaidBtn").addEventListener("click", clearPaidOnly);

  const installBtn = document.getElementById("installBtn");
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.classList.remove("hidden");
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch((err) => {
      console.error("Error registrando service worker:", err);
    });
  }
}

function init() {
  loadState();
  setupTabs();
  setupEvents();
  renderAll();
  registerServiceWorker();
}

document.addEventListener("DOMContentLoaded", init);