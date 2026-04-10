// api/send-push.js — Vercel serverless function
// Envía Web Push a todos los dispositivos suscritos.
// Requiere variables de entorno en Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // ── 1. Verificar JWT de Supabase ─────────────────────────────────────────────
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No auth token' });

  const adminDb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error: authErr } = await adminDb.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Token inválido' });

  // ── 2. Configurar web-push ────────────────────────────────────────────────────
  webpush.setVapidDetails(
    'mailto:admin@whynotbar.uy',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  // ── 3. Leer payload ───────────────────────────────────────────────────────────
  const { title = 'Why Not Bar', body = 'Alerta', tag = 'whynot-alert' } = req.body || {};

  // ── 4. Obtener todas las suscripciones ────────────────────────────────────────
  const { data: subs, error: subsErr } = await adminDb
    .from('push_subscriptions')
    .select('id, subscription');

  if (subsErr) return res.status(500).json({ error: subsErr.message });
  if (!subs?.length) return res.json({ ok: true, sent: 0 });

  const payload = JSON.stringify({ title, body, tag });
  const expiredIds = [];

  const results = await Promise.allSettled(
    subs.map(row =>
      webpush
        .sendNotification(row.subscription, payload)
        .catch(err => {
          // 410 Gone → la suscripción expiró, la eliminamos
          if (err.statusCode === 410 || err.statusCode === 404) {
            expiredIds.push(row.id);
          }
          throw err;
        })
    )
  );

  // Limpiar suscripciones expiradas
  if (expiredIds.length) {
    await adminDb.from('push_subscriptions').delete().in('id', expiredIds);
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  res.json({ ok: true, sent, total: subs.length });
};
