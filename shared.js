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
    bar:   '/barra.html',
    door:  '/portero.html',
    admin: '/admin.html',
  };
  const target = routes[role];
  if (!target) { window.location.reload(); return; }

  // Evitar redirección infinita si ya estamos en la página correcta
  const path = window.location.pathname;
  const onBar   = path.endsWith('/barra.html');
  const onDoor  = path.endsWith('/portero.html');
  const onAdmin = path.endsWith('/admin.html');

  if (
    (target === '/barra.html'   && onBar)  ||
    (target === '/portero.html' && onDoor) ||
    (target === '/admin.html'   && onAdmin)
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

async function openCamera(required = false) {
  injectCameraStyles();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'camera-overlay';
    overlay.innerHTML = `
      <div class="camera-header">
        <h3>📸 Foto del comprobante</h3>
        <span style="color:#a0a0a0;font-size:13px">Apuntá la cámara al comprobante de transferencia</span>
      </div>
      <video class="camera-video" autoplay playsinline muted></video>
      <canvas style="display:none"></canvas>
      <div class="camera-controls">
        ${required ? '' : '<button class="camera-btn camera-skip">Cancelar</button>'}
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

    const skipBtn = overlay.querySelector('.camera-skip');
    if (skipBtn) {
      skipBtn.onclick = () => { cleanup(); resolve(null); };
    }

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
  const bg = type === 'error'   ? '#ff453a'
          : type === 'success'  ? '#30d158'
          : type === 'warning'  ? '#ff9f0a'
          :                       '#0a84ff';
  const color = (type === 'success' || type === 'warning') ? '#06130a' : '#fff';
  el.style.cssText = `position:fixed;bottom:max(24px,calc(env(safe-area-inset-bottom,0px) + 16px));left:50%;transform:translateX(-50%);
    background:${bg};color:${color};padding:12px 22px;border-radius:999px;
    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;
    font-size:14.5px;font-weight:600;letter-spacing:-.01em;
    z-index:99999;box-shadow:0 10px 30px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.18);
    backdrop-filter:blur(14px) saturate(160%);
    -webkit-backdrop-filter:blur(14px) saturate(160%);
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

// ─── WhatsApp vía CallMeBot ───────────────────────────────────────────────────
async function sendWhatsApp(message) {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    await fetch('/api/send-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });
  } catch (e) {
    console.warn('[WhatsApp] error:', e.message);
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
    helpBtn.addEventListener('click', () => {
      // Toast inmediato — no esperar al fetch
      toast('🆘 Señal enviada a los admins', 'warning');
      withCooldown(helpBtn, 10, async () => {
        await requestNotifPermission();
        const msg = `Necesita ayuda en ${appName}`;
        _notifChannel.send({ type: 'broadcast', event: 'alert',
          payload: { emoji: '🆘', msg, from: currentUserDisplay, target: 'admin' } });
        await sendPushToAll(`🆘 ${currentUserDisplay}`, msg, 'whynot-sos', 'admin');
        // Formato: "Nombre: necesita ayuda en <App> 🆘" (o sin "en ..." si es admin)
        const where = appName && appName !== 'Admin' ? ` en ${appName}` : '';
        await sendWhatsApp(`${currentUserDisplay}: necesita ayuda${where} 🆘`);
      });
    });
  }
  if (sneezeBtn) {
    // Estornudo desde admin → va solo a los admins
    sneezeBtn.addEventListener('click', () => {
      toast('🤧 Señal enviada a los admins', 'success');
      withCooldown(sneezeBtn, 10, async () => {
        await requestNotifPermission();
        const msg = '¡Atención de admin!';
        _notifChannel.send({ type: 'broadcast', event: 'alert',
          payload: { emoji: '🤧', msg, from: currentUserDisplay, target: 'admin' } });
        await sendPushToAll(`🤧 ${currentUserDisplay}`, msg, 'whynot-admin', 'admin');
        await sendWhatsApp(`${currentUserDisplay}: Atención requerida 🤧`);
      });
    });
  }

  console.log(`[Notif] Permiso: ${Notification?.permission ?? 'no disponible'}`);
}

// ─── Selector "pagar por otros" ───────────────────────────────────────────────
// openAccounts: array de { id, slot, total, attendees: { name } } (sin la cuenta actual)
// Retorna { coveredAccounts: [{id,slot,total}], combinedTotal }
async function showPayForOthersScreen(currentSlot, currentTotal, openAccounts) {
  injectCameraStyles();
  return new Promise((resolve) => {
    const others = openAccounts.filter(a => a.slot !== currentSlot && !a.is_closed && a.total > 0);
    const overlay = document.createElement('div');
    overlay.className = 'camera-overlay';
    overlay.style.overflowY = 'auto';
    overlay.innerHTML = `
      <div class="camera-header" style="position:relative;padding:16px 20px">
        <div>
          <h3 style="margin:0;font-size:18px">👥 Pagar por otros</h3>
          <span style="color:#a0a0a0;font-size:13px">Seleccioná las cuentas que este asistente va a pagar</span>
        </div>
      </div>
      <div style="width:100%;max-width:480px;padding:72px 16px 16px">
        <input id="othersSearch" type="text" inputmode="numeric" placeholder="Buscar ID o nombre…"
          style="width:100%;background:#1c1c1c;border:1px solid #333;color:#f3f3f3;padding:12px 16px;border-radius:12px;font-size:16px;box-sizing:border-box;margin-bottom:12px;outline:none"/>
      </div>
      <div style="width:100%;max-width:480px;flex:1;overflow-y:auto;padding:0 16px 100px;display:flex;flex-direction:column;gap:10px" id="othersListWrap">
        ${others.length === 0
          ? '<p style="color:#6b7280;text-align:center;margin-top:20px">No hay otras cuentas abiertas con saldo.</p>'
          : others.map(a => `
            <label style="display:flex;align-items:center;gap:14px;background:#1c1c1c;border:1px solid #333;border-radius:14px;padding:14px 16px;cursor:pointer">
              <input type="checkbox" data-id="${a.id}" data-slot="${a.slot}" data-total="${a.total}"
                style="width:20px;height:20px;cursor:pointer;accent-color:#1ed760"/>
              <div style="flex:1">
                <div style="font-size:16px;font-weight:bold">ID ${String(a.slot).padStart(3,'0')} — ${a.attendees?.name || 'Sin nombre'}</div>
                <div style="font-size:14px;color:#a0a0a0">Saldo: <strong style="color:#f3f3f3">${typeof formatMoney === 'function' ? formatMoney(a.total) : '$'+a.total}</strong></div>
              </div>
            </label>`).join('')
        }
      </div>
      <div style="position:fixed;bottom:0;left:0;right:0;background:#111;border-top:1px solid #333;padding:16px 20px;display:flex;gap:12px;align-items:center">
        <div style="flex:1;font-size:15px;color:#a0a0a0">Total: <strong id="othersTotal" style="color:#fff;font-size:18px">${typeof formatMoney === 'function' ? formatMoney(currentTotal) : '$'+currentTotal}</strong></div>
        <button id="othersContinue" style="background:#1ed760;color:#06130a;border:none;border-radius:14px;padding:14px 28px;font-size:17px;font-weight:bold;cursor:pointer">Continuar →</button>
        <button id="othersCancel" style="background:#1c1c1c;color:#f3f3f3;border:1px solid #333;border-radius:14px;padding:14px 20px;font-size:17px;cursor:pointer">Cancelar</button>
      </div>`;
    document.body.appendChild(overlay);

    const selected = new Map(); // slot → {id, slot, total}
    const totalEl = overlay.querySelector('#othersTotal');

    // Buscador
    const searchEl = overlay.querySelector('#othersSearch');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        const q = searchEl.value.toLowerCase();
        overlay.querySelectorAll('#othersListWrap label').forEach(label => {
          const text = label.textContent.toLowerCase();
          label.style.display = text.includes(q) ? '' : 'none';
        });
      });
    }

    function recalc() {
      const extra = Array.from(selected.values()).reduce((s, a) => s + Number(a.total), 0);
      const combined = Number(currentTotal) + extra;
      totalEl.textContent = typeof formatMoney === 'function' ? formatMoney(combined) : '$' + combined;
    }

    overlay.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const slot = parseInt(cb.dataset.slot, 10);
        if (cb.checked) selected.set(slot, { id: cb.dataset.id, slot, total: Number(cb.dataset.total) });
        else selected.delete(slot);
        recalc();
      });
    });

    overlay.querySelector('#othersContinue').onclick = () => {
      const coveredAccounts = Array.from(selected.values());
      const combinedTotal = Number(currentTotal) + coveredAccounts.reduce((s, a) => s + a.total, 0);
      overlay.remove();
      resolve({ coveredAccounts, combinedTotal });
    };

    overlay.querySelector('#othersCancel').onclick = () => {
      overlay.remove();
      resolve(null);
    };
  });
}

// ─── Selector de método de pago ───────────────────────────────────────────────
// showPayForOthersOption: mostrar checkbox "Pagar por otras cuentas"
// Retorna { method, cashReceived, changeGiven, payForOthers } o null
async function showPaymentMethodSelector(totalAmount, showPayForOthersOption = false) {
  injectCameraStyles();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'camera-overlay';
    overlay.innerHTML = `
      <div class="camera-header">
        <h3>💳 Método de pago</h3>
        <span style="color:#a0a0a0;font-size:15px">Total: <strong style="color:#f3f3f3">${formatMoney(totalAmount)}</strong></span>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;padding:48px 24px;width:100%;max-width:380px">
        <button id="payTransfer" class="camera-btn"
          style="background:#1d4ed8;color:#fff;font-size:20px;padding:20px;border-radius:16px;border:none;cursor:pointer">
          📲 Transferencia
        </button>
        <button id="payCash" class="camera-btn"
          style="background:#1ed760;color:#06130a;font-size:20px;padding:20px;border-radius:16px;border:none;cursor:pointer">
          💵 Efectivo
        </button>
        ${showPayForOthersOption ? `
        <label id="payForOthersLabel" style="display:flex;align-items:center;gap:12px;background:#1c1c1c;border:1px solid #333;
               border-radius:14px;padding:14px 16px;cursor:pointer;font-size:16px;color:#f3f3f3">
          <input type="checkbox" id="payForOthersCheck" style="width:20px;height:20px;accent-color:#f59e0b;cursor:pointer"/>
          👥 Pagar por otras cuentas
        </label>` : ''}
        <button id="payCancel" class="camera-btn camera-skip"
          style="font-size:16px;padding:14px;border-radius:14px;border:1px solid #333;background:#1c1c1c;color:#a0a0a0;cursor:pointer">
          Cancelar
        </button>
      </div>`;
    document.body.appendChild(overlay);

    const getPayForOthers = () => showPayForOthersOption && !!overlay.querySelector('#payForOthersCheck')?.checked;

    overlay.querySelector('#payTransfer').onclick = () => {
      const payForOthers = getPayForOthers();
      overlay.remove();
      resolve({ method: 'transfer', cashReceived: null, changeGiven: null, payForOthers });
    };
    overlay.querySelector('#payCash').onclick = () => {
      const payForOthers = getPayForOthers();
      overlay.remove();
      if (payForOthers) {
        // Cash calculator se mostrará después de seleccionar otras cuentas
        resolve({ method: 'cash', cashReceived: null, changeGiven: null, payForOthers: true });
      } else {
        _showCashScreen(totalAmount, resolve, showPayForOthersOption);
      }
    };
    overlay.querySelector('#payCancel').onclick = () => {
      overlay.remove();
      resolve(null);
    };
  });
}

// Calculadora de efectivo standalone (sin botón volver, solo cancelar)
// Usada cuando el total ya incluye otras cuentas
async function showCashCalculator(totalAmount) {
  injectCameraStyles();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'camera-overlay';
    overlay.innerHTML = `
      <div class="camera-header">
        <h3>💵 Pago en efectivo</h3>
        <span style="color:#a0a0a0;font-size:15px">Total combinado: <strong style="color:#f3f3f3">${formatMoney(totalAmount)}</strong></span>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;padding:36px 24px;width:100%;max-width:380px">
        <div>
          <label style="color:#a0a0a0;font-size:13px;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:8px">¿Con cuánto paga?</label>
          <input id="cashInput" type="number" inputmode="numeric" min="0" step="50"
            style="width:100%;background:#1c1c1c;border:2px solid #3b82f6;color:#f3f3f3;padding:16px;border-radius:14px;font-size:28px;text-align:center;outline:none;box-sizing:border-box"/>
        </div>
        <div id="changeBox" style="background:#0d1f0d;border:1px solid #1a3a1a;border-radius:14px;padding:16px;text-align:center;display:none">
          <div style="color:#a0a0a0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Vuelto</div>
          <div id="changeAmt" style="font-size:36px;font-weight:bold;color:#1ed760"></div>
        </div>
        <div id="shortBox" style="background:#1f0d0d;border:1px solid #5c1a1a;border-radius:14px;padding:12px;text-align:center;display:none;color:#f87171;font-size:15px">
          ⚠ Le falta <strong id="shortAmt"></strong>
        </div>
        <div style="display:flex;gap:12px">
          <button id="cashConfirm" style="flex:1;background:#1ed760;color:#06130a;border:none;border-radius:14px;padding:16px;font-size:17px;font-weight:bold;cursor:pointer;opacity:.4;pointer-events:none">Confirmar</button>
          <button id="cashCancel" style="background:#1c1c1c;color:#f3f3f3;border:1px solid #333;border-radius:14px;padding:16px;font-size:17px;cursor:pointer">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const cashInput = overlay.querySelector('#cashInput');
    const changeBox = overlay.querySelector('#changeBox');
    const changeAmt = overlay.querySelector('#changeAmt');
    const shortBox  = overlay.querySelector('#shortBox');
    const shortAmt  = overlay.querySelector('#shortAmt');
    const confirmBtn = overlay.querySelector('#cashConfirm');
    cashInput.focus();

    cashInput.addEventListener('input', () => {
      const received = parseFloat(cashInput.value) || 0;
      const diff = received - totalAmount;
      if (received >= totalAmount) {
        changeBox.style.display = 'block'; shortBox.style.display = 'none';
        changeAmt.textContent = formatMoney(diff);
        confirmBtn.style.opacity = '1'; confirmBtn.style.pointerEvents = 'auto';
      } else if (received > 0) {
        changeBox.style.display = 'none'; shortBox.style.display = 'block';
        shortAmt.textContent = formatMoney(totalAmount - received);
        confirmBtn.style.opacity = '.4'; confirmBtn.style.pointerEvents = 'none';
      } else {
        changeBox.style.display = 'none'; shortBox.style.display = 'none';
        confirmBtn.style.opacity = '.4'; confirmBtn.style.pointerEvents = 'none';
      }
    });

    confirmBtn.onclick = () => {
      const received = parseFloat(cashInput.value) || 0;
      overlay.remove();
      resolve({ cashReceived: received, changeGiven: received - totalAmount });
    };
    overlay.querySelector('#cashCancel').onclick = () => { overlay.remove(); resolve(null); };
  });
}

function _showCashScreen(totalAmount, resolve, showPayForOthersOption = false) {
  const overlay = document.createElement('div');
  overlay.className = 'camera-overlay';
  overlay.innerHTML = `
    <div class="camera-header">
      <h3>💵 Pago en efectivo</h3>
      <span style="color:#a0a0a0;font-size:15px">Total: <strong style="color:#f3f3f3">${formatMoney(totalAmount)}</strong></span>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px;padding:36px 24px;width:100%;max-width:380px">
      <div>
        <label style="color:#a0a0a0;font-size:13px;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:8px">
          ¿Con cuánto paga?
        </label>
        <input id="cashInput" type="number" inputmode="numeric" min="0" step="50"
          style="width:100%;background:#1c1c1c;border:2px solid #3b82f6;color:#f3f3f3;
                 padding:16px;border-radius:14px;font-size:28px;text-align:center;
                 outline:none;box-sizing:border-box"/>
      </div>
      <div id="changeBox" style="background:#0d1f0d;border:1px solid #1a3a1a;border-radius:14px;
           padding:16px;text-align:center;display:none">
        <div style="color:#a0a0a0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Vuelto</div>
        <div id="changeAmt" style="font-size:36px;font-weight:bold;color:#1ed760"></div>
      </div>
      <div id="shortBox" style="background:#1f0d0d;border:1px solid #5c1a1a;border-radius:14px;
           padding:12px;text-align:center;display:none;color:#f87171;font-size:15px">
        ⚠ Le falta <strong id="shortAmt"></strong>
      </div>
      <div style="display:flex;gap:12px">
        <button id="cashConfirm" class="camera-btn camera-confirm"
          style="flex:1;background:#1ed760;color:#06130a;border:none;border-radius:14px;padding:16px;font-size:17px;font-weight:bold;cursor:pointer;opacity:.4;pointer-events:none">
          Confirmar
        </button>
        <button id="cashBack" class="camera-btn camera-skip"
          style="background:#1c1c1c;color:#f3f3f3;border:1px solid #333;border-radius:14px;padding:16px;font-size:17px;cursor:pointer">
          ← Volver
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const cashInput   = overlay.querySelector('#cashInput');
  const changeBox   = overlay.querySelector('#changeBox');
  const changeAmt   = overlay.querySelector('#changeAmt');
  const shortBox    = overlay.querySelector('#shortBox');
  const shortAmt    = overlay.querySelector('#shortAmt');
  const confirmBtn  = overlay.querySelector('#cashConfirm');

  cashInput.focus();

  cashInput.addEventListener('input', () => {
    const received = parseFloat(cashInput.value) || 0;
    const diff = received - totalAmount;
    if (received >= totalAmount) {
      changeBox.style.display = 'block';
      shortBox.style.display  = 'none';
      changeAmt.textContent   = formatMoney(diff);
      confirmBtn.style.opacity       = '1';
      confirmBtn.style.pointerEvents = 'auto';
    } else if (received > 0) {
      changeBox.style.display = 'none';
      shortBox.style.display  = 'block';
      shortAmt.textContent    = formatMoney(totalAmount - received);
      confirmBtn.style.opacity       = '.4';
      confirmBtn.style.pointerEvents = 'none';
    } else {
      changeBox.style.display = 'none';
      shortBox.style.display  = 'none';
      confirmBtn.style.opacity       = '.4';
      confirmBtn.style.pointerEvents = 'none';
    }
  });

  overlay.querySelector('#cashConfirm').onclick = () => {
    const received = parseFloat(cashInput.value) || 0;
    overlay.remove();
    resolve({ method: 'cash', cashReceived: received, changeGiven: received - totalAmount });
  };
  overlay.querySelector('#cashBack').onclick = () => {
    overlay.remove();
    showPaymentMethodSelector(totalAmount, showPayForOthersOption).then(resolve);
  };
}
