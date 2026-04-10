// ═══════════════════════════════════════════════════════════════════════════
// shared.js — Supabase client · Auth · Cámara · Utilidades
// Incluir ANTES de app.js / portero.js / admin.js
// ═══════════════════════════════════════════════════════════════════════════


// ─── ⚠️  COMPLETAR CON TUS VALORES DE SUPABASE ───────────────────────────────
const SUPABASE_URL      = 'https://snsmgezzqchwlwaramcz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__CVaQps15sZM9sBtU2vzaw_0lSbKcJU';
// ─────────────────────────────────────────────────────────────────────────────

// ─── VAPID Public Key (Web Push) ──────────────────────────────────────────────
// Generada junto con VAPID_PRIVATE_KEY (que solo vive en Vercel como env var).
const VAPID_PUBLIC_KEY = 'BO47pb3rswPO0Qkzp05k30WH8kQjJkG9IvloCIqlhtA5geOwvXYoMR9Ea3HOcC5dCgliiEDNHOKZjR7hpm4TELc';
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

// Redirige al app correspondiente según el rol del usuario
function redirectToRoleApp(role) {
  const routes = {
    bar:   '/',
    door:  '/portero.html',
    admin: '/admin.html',
  };
  const target = routes[role];
  if (!target) { window.location.reload(); return; }

  // Evitar redirección infinita si ya estamos en la página correcta
  const path = window.location.pathname;
  const onBar   = path === '/' || path.endsWith('/index.html');
  const onDoor  = path.endsWith('/portero.html');
  const onAdmin = path.endsWith('/admin.html');

  if (
    (target === '/'              && onBar)  ||
    (target === '/portero.html'  && onDoor) ||
    (target === '/admin.html'    && onAdmin)
  ) {
    window.location.reload();
  } else {
    window.location.href = target;
  }
}

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
    // En vez de mostrar error, redirigir al app correcto para este rol
    redirectToRoleApp(profile.role);
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
  // Siempre volver al inicio (login unificado) al cerrar sesión
  window.location.href = '/';
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
  // Label genérico: cualquier usuario puede ingresar desde cualquier página
  const label = 'Iniciá sesión';

  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">
          <div class="brand-dot"></div>
          <h1>Why Not</h1>
        </div>
        <p class="login-role">${label}</p>
        <form id="loginForm" autocomplete="off">
          <input type="text" id="loginEmail" placeholder="Nombre o email" required autocomplete="username"
            inputmode="email" style="text-transform:none" />
          <input type="password" id="loginPassword" placeholder="Contraseña" required autocomplete="current-password" />
          <button type="submit" id="loginBtn">Ingresar</button>
          <p id="loginError" class="login-error"></p>
        </form>
      </div>
    </div>`;

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn    = document.getElementById('loginBtn');
    const errEl  = document.getElementById('loginError');
    btn.disabled = true;
    btn.textContent = 'Ingresando…';
    errEl.textContent = '';

    try {
      let identifier = document.getElementById('loginEmail').value.trim();
      const password  = document.getElementById('loginPassword').value;

      // Si no parece un email, buscar el email por nombre de usuario
      if (!identifier.includes('@')) {
        btn.textContent = 'Buscando usuario…';
        const resp = await fetch(`/api/lookup-email?name=${encodeURIComponent(identifier)}`);
        const data = await resp.json();
        if (!resp.ok || !data.email) {
          throw new Error('Usuario no encontrado. Verificá el nombre o usá tu email.');
        }
        identifier = data.email;
      }

      await signIn(identifier, password);
      // Obtener el rol del usuario para redirigir al app correcto
      const db2 = getDb();
      const { data: { user: authUser } } = await db2.auth.getUser();
      if (authUser) {
        const { data: prof } = await db2
          .from('profiles')
          .select('role')
          .eq('id', authUser.id)
          .single();
        redirectToRoleApp(prof?.role || 'bar');
      } else {
        window.location.reload();
      }
    } catch (err) {
      const msg = err.message || '';
      errEl.textContent =
        msg.includes('Invalid') || msg.includes('credentials')
          ? 'Contraseña incorrecta'
          : msg.includes('not found') || msg.includes('no encontrado')
            ? 'Usuario no encontrado. Verificá el nombre o usá tu email.'
            : msg;
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
  if (error) {
    console.error('Error subiendo foto:', error);
    toast('⚠️ No se pudo subir la foto del comprobante: ' + error.message, 'warning');
    return null;
  }
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
  const bg = type === 'error' ? '#ef4444' : type === 'success' ? '#1ed760' : type === 'warning' ? '#f59e0b' : '#2563eb';
  const color = (type === 'success' || type === 'warning') ? '#06130a' : '#fff';
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${bg};color:${color};padding:12px 24px;border-radius:14px;
    font-family:Arial,sans-serif;font-size:15px;font-weight:bold;
    z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.4);
    animation:fadeInUp .2s ease;pointer-events:none;white-space:nowrap`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── User dropdown ─────────────────────────────────────────────────────────────
function setupUserDropdown() {
  const btn  = document.getElementById('userDropdownBtn');
  const menu = document.getElementById('userDropdownMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
}

// ─── Web Push: suscripción ─────────────────────────────────────────────────────
async function registerPushServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    // Registrar (o recuperar) el service worker
    let reg = await navigator.serviceWorker.getRegistration('./');
    if (!reg) {
      reg = await navigator.serviceWorker.register('./service-worker.js');
      await navigator.serviceWorker.ready;
    }
    return reg;
  } catch (e) {
    console.warn('[Push] SW registration failed:', e.message);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function subscribeToPush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;

    const reg = await registerPushServiceWorker();
    if (!reg) return;

    // Suscribir al Push Manager
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Guardar en Supabase (el usuario debe estar autenticado)
    const db = getDb();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;

    await db.from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint: subscription.endpoint,
      subscription: subscription.toJSON(),
    }, { onConflict: 'endpoint' });

    console.log('[Push] Suscripción guardada correctamente.');
  } catch (e) {
    console.warn('[Push] subscribeToPush error:', e.message);
  }
}

// Envía push vía Vercel /api/send-push
// targetRole: si se pasa ('admin'), solo se envía a usuarios con ese rol.
async function sendPushToAll(title, body, tag = 'whynot-alert', targetRole = null) {
  try {
    const db = getDb();
    const { data: { session } } = await db.auth.getSession();
    if (!session?.access_token) return;

    // Timeout de 8 segundos para que no quede colgado si Vercel no responde
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    await fetch('/api/send-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ title, body, tag, targetRole }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  } catch (e) {
    console.warn('[Push] sendPushToAll error:', e.message);
  }
}

// ─── Notification broadcast ────────────────────────────────────────────────────
let _notifChannel = null;

// Toast de alerta: más grande, dura más, con sonido y vibración
function alertToast(msg) {
  // Vibrar en móvil
  if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);

  // Sonido de alerta (tono corto via Web Audio API)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1100, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.12);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.13);
    });
  } catch(e) {}

  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:#f59e0b;color:#06130a;
    padding:20px 32px;border-radius:20px;
    font-family:Arial,sans-serif;font-size:20px;font-weight:bold;
    z-index:99999;box-shadow:0 12px 40px rgba(0,0,0,.6);
    text-align:center;max-width:90vw;
    animation:fadeInUp .2s ease;pointer-events:none;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

async function requestNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

function setupNotifChannel(appName, currentUserDisplay) {
  // Solicitar permiso de notificaciones del sistema y suscribir al Web Push
  requestNotifPermission().then(granted => {
    if (granted) subscribeToPush();
  });

  const db = getDb();
  _notifChannel = db.channel('app-notifications')
    .on('broadcast', { event: 'alert' }, ({ payload }) => {
      // Filtrar por destinatario: si el target es 'admin', solo los admins ven el aviso
      const target   = payload.target || 'all';
      const myRole   = getCurrentUser()?.role || '';
      const isTarget = target === 'all' || myRole === target;
      if (!isTarget) return;

      if (payload.from !== currentUserDisplay) {
        alertToast(`${payload.emoji} ${payload.from}: ${payload.msg}`);
        // Notificación del sistema si la app está en foco
        if (Notification.permission === 'granted') {
          try {
            new Notification(`${payload.emoji} ${payload.msg}`, {
              body: `Enviado por: ${payload.from}`,
              icon: './Logo.png',
              tag: 'whynot-alert',
              requireInteraction: true,
            });
          } catch(e) {}
        }
      }
    })
    .subscribe();

  const helpBtn   = document.getElementById('helpBtn');
  const sneezeBtn = document.getElementById('sneezeBtn');

  // Cooldown helper: bloquea el botón N segundos para evitar spam.
  // El timer empieza AL INSTANTE — no espera a que el fetch termine.
  function withCooldown(btn, seconds, fn) {
    if (btn.dataset.cooldown) return;
    btn.dataset.cooldown = '1';
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';

    // Desbloquear siempre después de `seconds` segundos, pase lo que pase
    setTimeout(() => {
      delete btn.dataset.cooldown;
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
    }, seconds * 1000);

    // Ejecutar la función en paralelo sin bloquear el unlock
    fn().catch(e => console.warn('[Alert] Error:', e.message));
  }

  if (helpBtn) {
    // SOS desde barra o portería → va solo a los admins
    helpBtn.addEventListener('click', () => withCooldown(helpBtn, 10, async () => {
      await requestNotifPermission();
      const msg = `Necesita ayuda en ${appName}`;
      _notifChannel.send({ type: 'broadcast', event: 'alert',
        payload: { emoji: '🆘', msg, from: currentUserDisplay, target: 'admin' } });
      await sendPushToAll(`🆘 ${currentUserDisplay}`, msg, 'whynot-sos', 'admin');
      toast('🆘 Señal enviada a los admins', 'warning');
    }));
  }
  if (sneezeBtn) {
    // Estornudo desde admin → va solo a los admins
    sneezeBtn.addEventListener('click', () => withCooldown(sneezeBtn, 10, async () => {
      await requestNotifPermission();
      const msg = '¡Atención de admin!';
      _notifChannel.send({ type: 'broadcast', event: 'alert',
        payload: { emoji: '🤧', msg, from: currentUserDisplay, target: 'admin' } });
      await sendPushToAll(`🤧 ${currentUserDisplay}`, msg, 'whynot-admin', 'admin');
      toast('🤧 Señal enviada a los admins', 'success');
    }));
  }

  console.log(`[Notif] Permiso: ${Notification?.permission ?? 'no disponible'}`);
}
