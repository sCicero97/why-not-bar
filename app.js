const STORAGE_KEY = "cuentas-bar-app-v6";
const LONG_PRESS_MS = 2000;

const BACKUP_CONFIG = {
  BACKUP_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbzJTz4UeI4Xai8LNUqF-c7HCYBUzd5IVVUlNDsODj_njsS4kh2yTeW4TPjtp8a915Iq/exec",
  BACKUP_TOKEN: "~odB9aur6[Z1"
};

const state = {
  accounts: [],
  paidAccounts: [],
};

let deferredPrompt = null;
let suppressNextClick = false;
let longPressTimer = null;

function padBaseId(number) {
  return String(number).padStart(3, "0");
}

function createInitialAccounts() {
  return Array.from({ length: 100 }, (_, index) => ({
    slot: index + 1,
    id: padBaseId(index + 1),
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

function migrateAccountId(id, fallbackSlot) {
  const value = String(id ?? "").trim();

  if (!value) {
    return padBaseId(fallbackSlot);
  }

  const parts = value.split("-");
  const rawBase = parts[0];
  const suffix = parts[1];

  const baseNumber = parseInt(rawBase, 10);

  if (Number.isNaN(baseNumber)) {
    return padBaseId(fallbackSlot);
  }

  const basePadded = padBaseId(baseNumber);

  if (!suffix) {
    return basePadded;
  }

  return `${basePadded}-${suffix.toUpperCase()}`;
}

function loadState() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem("cuentas-bar-app-v5") ||
      localStorage.getItem("cuentas-bar-app-v4") ||
      localStorage.getItem("cuentas-bar-app-v3") ||
      localStorage.getItem("cuentas-bar-app-v2") ||
      localStorage.getItem("cuentas-bar-app-v1");

    if (!raw) {
      const initial = defaultState();
      state.accounts = initial.accounts;
      state.paidAccounts = initial.paidAccounts;
      saveState();
      return;
    }

    const parsed = JSON.parse(raw);

    state.accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts.map((account, index) => ({
          ...account,
          id: migrateAccountId(account.id, index + 1),
          slot: account.slot || index + 1,
        }))
      : createInitialAccounts();

    state.paidAccounts = Array.isArray(parsed.paidAccounts)
      ? parsed.paidAccounts.map((item, index) => ({
          ...item,
          id: migrateAccountId(item.id, index + 1),
        }))
      : [];

    saveState();
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
    year: "numeric",
  });
}

function nextVersionId(currentId) {
  const value = String(currentId).trim();
  const parts = value.split("-");
  const rawBase = parts[0];
  const suffix = parts[1];

  const baseNumber = parseInt(rawBase, 10);
  const base = Number.isNaN(baseNumber) ? "001" : padBaseId(baseNumber);

  if (!suffix) {
    return `${base}-B`;
  }

  const upperSuffix = suffix.toUpperCase();
  const code = upperSuffix.charCodeAt(0);

  if (code >= 65 && code < 90) {
    return `${base}-${String.fromCharCode(code + 1)}`;
  }

  return `${base}-Z`;
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

function subtractDrink(slot, amount) {
  const account = state.accounts.find((a) => a.slot === slot);
  if (!account) return;

  if (amount === 160) {
    if (account.qty160 <= 0) return;
    account.qty160 -= 1;
    account.total = Math.max(0, account.total - 160);
  }

  if (amount === 260) {
    if (account.qty260 <= 0) return;
    account.qty260 -= 1;
    account.total = Math.max(0, account.total - 260);
  }

  if (amount === 360) {
    if (account.qty360 <= 0) return;
    account.qty360 -= 1;
    account.total = Math.max(0, account.total - 360);
  }

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

function buildBackupPayload() {
  const open = getOpenTotals();
  const paid = getPaidTotals();

  return {
    token: BACKUP_CONFIG.BACKUP_TOKEN,
    backupCreatedAt: new Date().toISOString(),
    summary: {
      openTotal: open.total,
      paidTotal: paid.total,
      grandTotal: open.total + paid.total,
      qty160: open.qty160 + paid.qty160,
      qty260: open.qty260 + paid.qty260,
      qty360: open.qty360 + paid.qty360,
      openAccountsCount: state.accounts.length,
      paidAccountsCount: state.paidAccounts.length,
    },
    openAccounts: state.accounts,
    paidAccounts: state.paidAccounts,
  };
}

function backupToGoogleSheets() {
  const backupBtn = document.getElementById("backupBtn");
  const previousText = backupBtn.textContent;

  try {
    if (
      !BACKUP_CONFIG.BACKUP_WEB_APP_URL ||
      BACKUP_CONFIG.BACKUP_WEB_APP_URL.includes("PEGAR_ACA")
    ) {
      throw new Error("Falta configurar la URL del Web App de Apps Script en app.js");
    }

    backupBtn.disabled = true;
    backupBtn.textContent = "Respaldando...";

    const payload = buildBackupPayload();
    submitBackupForm_(BACKUP_CONFIG.BACKUP_WEB_APP_URL, payload);

    setTimeout(() => {
      backupBtn.disabled = false;
      backupBtn.textContent = previousText;
      window.alert("Backup enviado. Revisá la planilla para confirmar.");
    }, 1200);
  } catch (error) {
    console.error("BACKUP ERROR:", error);
    backupBtn.disabled = false;
    backupBtn.textContent = previousText;
    window.alert(`No se pudo respaldar.\n\n${error.message}`);
  }
}

function submitBackupForm_(url, payload) {
  let iframe = document.getElementById("backupIframe");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.name = "backupIframe";
    iframe.id = "backupIframe";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
  }

  const oldForm = document.getElementById("backupForm");
  if (oldForm) oldForm.remove();

  const form = document.createElement("form");
  form.id = "backupForm";
  form.method = "POST";
  form.action = url;
  form.target = "backupIframe";
  form.style.display = "none";

  const input = document.createElement("textarea");
  input.name = "payload";
  input.value = JSON.stringify(payload);

  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();

  setTimeout(() => {
    form.remove();
  }, 1500);
}

function renderSummary() {
  const open = getOpenTotals();
  const paid = getPaidTotals();

  document.getElementById("openTotal").textContent = formatMoney(open.total);
  document.getElementById("paidTotal").textContent = formatMoney(paid.total);
  document.getElementById("all160").textContent = open.qty160 + paid.qty160;
  document.getElementById("all260").textContent = open.qty260 + paid.qty260;
  document.getElementById("all360").textContent = open.qty360 + paid.qty360;
  document.getElementById("grandTotal").textContent = formatMoney(open.total + paid.total);
}

function renderAccounts() {
  const wrap = document.getElementById("accountsList");
  const rawSearch = document.getElementById("searchInput").value.trim();
  const searchDigits = rawSearch.replace(/\D/g, "");

  const filtered = state.accounts.filter((account) => {
    if (!searchDigits) return true;
    const accountDigits = account.id.replace(/\D/g, "");
    return accountDigits.includes(searchDigits);
  });

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

function clearLongPressState() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function setupLongPressHandlers() {
  const accountsList = document.getElementById("accountsList");

  accountsList.addEventListener(
    "pointerdown",
    (event) => {
      const amountBtn = event.target.closest("[data-amount]");
      if (!amountBtn) return;

      event.preventDefault();

      const slot = Number(amountBtn.dataset.slot);
      const amount = Number(amountBtn.dataset.amount);

      clearLongPressState();

      longPressTimer = setTimeout(() => {
        subtractDrink(slot, amount);
        suppressNextClick = true;

        if (navigator.vibrate) {
          navigator.vibrate(30);
        }
      }, LONG_PRESS_MS);
    },
    { passive: false }
  );

  ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
    document.getElementById("accountsList").addEventListener(eventName, () => {
      clearLongPressState();
    });
  });

  document.getElementById("accountsList").addEventListener(
    "contextmenu",
    (event) => {
      if (event.target.closest(".action-btn")) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  document.getElementById("accountsList").addEventListener(
    "dblclick",
    (event) => {
      if (event.target.closest(".action-btn")) {
        event.preventDefault();
      }
    },
    { passive: false }
  );
}

function setupEvents() {
  const accountsList = document.getElementById("accountsList");

  accountsList.addEventListener("click", (event) => {
    const amountBtn = event.target.closest("[data-amount]");
    const closeBtn = event.target.closest("[data-close]");

    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

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

  setupLongPressHandlers();

  const searchInput = document.getElementById("searchInput");
  const clearSearchBtn = document.getElementById("clearSearchBtn");

  searchInput.addEventListener("input", () => {
    searchInput.value = searchInput.value.replace(/[^\d]/g, "");
    renderAccounts();
  });

  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    renderAccounts();
    searchInput.focus();
  });

  document.getElementById("resetBtn").addEventListener("click", resetAll);
  document.getElementById("backupBtn").addEventListener("click", backupToGoogleSheets);

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