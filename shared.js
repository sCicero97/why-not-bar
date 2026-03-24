// ═══════════════════════════════════════════════════════════════════════════
// shared.js — Supabase client · Auth · Cámara · Utilidades
// Incluir ANTES de app.js / portero.js / admin.js
// ═══════════════════════════════════════════════════════════════════════════

// ─── ⚠️  COMPLETAR CON TUS VALORES DE SUPABASE ───────────────────────────────
const SUPABASE_URL      = 'https://snsmgezzqchwlwaramcz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__CVaQps15sZM9sBtU2vzaw_0lSbKcJU';
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_BUCKET = 'payment-photos';

// ─── Supabase client ──────────────────────────────────────────────────────────
let _db = null;
function getDb() {
  if (_db) return _db;
  if (SUPABASE_URL.includes('YOUR_PROJECT') || SUPABASE_ANON_KEY.includes('YOUR_ANON')) {
    showSetupRequired();
    throw new Error('SETUP_REQUIRED');
  }
  _db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    realtime: { timeout: 20000 },
  });
  return _db;
}

function showSetupRequired() {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0b;color:#f3f3f3;font-family:Arial,sans-serif;padding:20px">
      <div style="max-width:480px;text-align:center">
        <div style="font-size:48px;margin-bottom:16px">⚙️</div>
        <h2 style="color:#ef4444">Configuración requerida</h2>
        <p style="color:#a0a0a0">Completá los valores de Supabase en <code style="background:#1c1c1c;padding:2px 6px;border-radius:4px">shared.js</code></p>
        <p style="color:#a0a0a0">Seguí las instrucciones en <strong>SETUP.md</strong></p>
      </div>
    </div>`;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
let _currentUser = null;

async function requireAuth(allowedRoles) {
  const db = getDb();
  const { data: { session } } = await db.auth.getSession();

  if (!session) {
    showLoginModal(allowedRoles);
    return null;
  }

  const { data: profile, error } = await db
    .from('profiles')
    .select('role, display_name')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    await db.auth.signOut();
    showLoginModal(allowedRoles);
    return null;
  }

  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (!roles.includes(profile.role) && profile.role !== 'admin') {
    showAuthError(`Tu rol (${profile.role}) no tiene acceso a esta app.`);
    await db.auth.signOut();
    return null;
  }

  _currentUser = { id: session.user.id, email: session.user.email, role: profile.role, displayName: profile.display_name };
  return _currentUser;
}

function getCurrentUser() { return _currentUser; }

async function signIn(email, password) {
  const db = getDb();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

async function signOut() {
  const db = getDb();
  await db.auth.signOut();
  window.location.reload();
}

function showAuthError(msg) {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0b;color:#f3f3f3;font-family:Arial,sans-serif;padding:20px">
      <div style="text-align:center">
        <div style="font-size:48px;margin-bottom:16px">🚫</div>
        <h2 style="color:#ef4444">Acceso denegado</h2>
        <p style="color:#a0a0a0">${msg}</p>
        <button onclick="window.location.reload()" style="margin-top:16px;padding:12px 24px;background:#ef4444;border:none;border-radius:12px;color:#fff;font-size:16px;cursor:pointer">Volver</button>
      </div>
    </div>`;
}

function showLoginModal(allowedRoles) {
  const roleLabels = { bar: 'Barra', door: 'Portero', admin: 'Admin' };
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  const label = roles.map(r => roleLabels[r] || r).join(' / ');

  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">
          <div class="brand-dot"></div>
          <h1>Why Not</h1>
        </div>
        <p class="login-role">${label}</p>
        <form id="loginForm" autocomplete="off">
          <input type="email" id="loginEmail" placeholder="Email" required autocomplete="email" />
          <input type="password" id="loginPassword" placeholder="Contraseña" required autocomplete="current-password" />
          <button type="submit" id="loginBtn">Ingresar</button>
          <p id="loginError" class="login-error"></p>
        </form>
      </div>
    </div>`;

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const errEl = document.getElementById('loginError');
    btn.disabled = true;
    btn.textContent = 'Ingresando…';
    errEl.textContent = '';
    try {
      await signIn(
        document.getElementById('loginEmail').value,
        document.getElementById('loginPassword').value
      );
      window.location.reload();
    } catch (err) {
      errEl.textContent = err.message.includes('Invalid') ? 'Email o contraseña incorrectos' : err.message;
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  });
}

// ─── Cámara ───────────────────────────────────────────────────────────────────
function injectCameraStyles() {
  if (document.getElementById('camera-styles')) return;
  const s = document.createElement('style');
  s.id = 'camera-styles';
  s.textContent = `
    .camera-overlay {
      position:fixed;inset:0;background:#000;z-index:9999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
    }
    .camera-header {
      position:absolute;top:0;left:0;right:0;
      padding:16px 20px;background:rgba(0,0,0,.6);
      display:flex;align-items:center;justify-content:space-between;
      color:#fff;font-family:Arial,sans-serif;
    }
    .camera-header h3 { margin:0;font-size:18px }
    .camera-video {
      width:100%;max-width:640px;max-height:70vh;object-fit:cover;border-radius:12px;
    }
    .camera-photo-preview {
      width:100%;max-width:640px;max-height:70vh;overflow:hidden;border-radius:12px;
    }
    .camera-photo-preview img { width:100%;height:auto;display:block }
    .camera-controls {
      position:absolute;bottom:0;left:0;right:0;
      padding:20px;background:rgba(0,0,0,.6);
      display:flex;gap:12px;justify-content:center;
    }
    .camera-btn {
      padding:14px 24px;border:none;border-radius:14px;
      font-size:17px;font-weight:bold;cursor:pointer;min-width:140px;
    }
    .camera-capture { background:#1ed760;color:#06130a }
    .camera-confirm { background:#1ed760;color:#06130a }
    .camera-skip    { background:#2a2a2a;color:#f3f3f3 }
    .camera-retake  { background:#2a2a2a;color:#f3f3f3 }
  `;
  document.head.appendChild(s);
}

async function openCamera() {
  injectCameraStyles();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'camera-overlay';
    overlay.innerHTML = `
      <div class="camera-header">
        <h3>📸 Foto del pago</h3>
        <span style="color:#a0a0a0;font-size:13px">Apuntá la cámara al comprobante</span>
      </div>
      <video class="camera-video" autoplay playsinline muted></video>
      <canvas style="display:none"></canvas>
      <div class="camera-controls">
        <button class="camera-btn camera-skip">Omitir foto</button>
        <button class="camera-btn camera-capture">📸 Capturar</button>
      </div>`;
    document.body.appendChild(overlay);

    let stream = null;
    const video  = overlay.querySelector('video');
    const canvas = overlay.querySelector('canvas');

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(s => {
        stream = s;
        video.srcObject = s;
      })
      .catch(() => {
        // Camera unavailable — skip
        cleanup();
        resolve(null);
      });

    overlay.querySelector('.camera-capture').onclick = () => {
      canvas.width  = video.videoWidth  || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d').drawImage(video, 0, 0);
      cleanup();
      showPhotoPreview(canvas.toDataURL('image/jpeg', 0.85), canvas, resolve);
    };

    overlay.querySelector('.camera-skip').onclick = () => {
      cleanup();
      resolve(null);
    };

    function cleanup() {
      if (stream) stream.getTracks().forEach(t => t.stop());
      overlay.remove();
    }
  });
}

function showPhotoPreview(dataUrl, canvas, resolve) {
  injectCameraStyles();
  const overlay = document.createElement('div');
  overlay.className = 'camera-overlay';
  overlay.innerHTML = `
    <div class="camera-header">
      <h3>📸 Confirmar foto</h3>
      <span style="color:#a0a0a0;font-size:13px">¿Se ve bien el comprobante?</span>
    </div>
    <div class="camera-photo-preview">
      <img src="${dataUrl}" alt="Foto del pago" />
    </div>
    <div class="camera-controls">
      <button class="camera-btn camera-retake">↩ Volver a tomar</button>
      <button class="camera-btn camera-confirm">✓ Confirmar</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('.camera-confirm').onclick = () => {
    overlay.remove();
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
  };

  overlay.querySelector('.camera-retake').onclick = () => {
    overlay.remove();
    openCamera().then(resolve);
  };
}

async function uploadPaymentPhoto(blob, eventId, slot) {
  if (!blob) return null;
  const db = getDb();
  const filename = `${eventId}/${slot}-${Date.now()}.jpg`;
  const { error } = await db.storage.from(STORAGE_BUCKET).upload(filename, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) { console.error('Error subiendo foto:', error); return null; }
  const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

// ─── Activo evento ────────────────────────────────────────────────────────────
async function getActiveEvent() {
  const db = getDb();
  const { data, error } = await db.from('events').select('*').eq('is_active', true).single();
  if (error || !data) return null;
  return data;
}

// ─── Utilidades generales ─────────────────────────────────────────────────────
function padId(n) { return String(n).padStart(3, '0'); }

function formatMoney(v) {
  return `$ ${Number(v || 0).toLocaleString('es-UY')}`;
}

function nowString() {
  return new Date().toLocaleString('es-UY', {
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    day:'2-digit', month:'2-digit', year:'numeric',
  });
}

function statusLabel(s) {
  return { invited:'Invitado', crew:'Crew', in_process:'En proceso', paid:'Pago', no_show:'No vino' }[s] || s;
}

function statusColor(s) {
  return { invited:'#3b82f6', crew:'#8b5cf6', in_process:'#f59e0b', paid:'#1ed760', no_show:'#6b7280' }[s] || '#a0a0a0';
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  const bg = type === 'error' ? '#ef4444' : type === 'success' ? '#1ed760' : '#2563eb';
  const color = type === 'success' ? '#06130a' : '#fff';
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${bg};color:${color};padding:12px 24px;border-radius:14px;
    font-family:Arial,sans-serif;font-size:15px;font-weight:bold;
    z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.4);
    animation:fadeInUp .2s ease;pointer-events:none;white-space:nowrap`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
