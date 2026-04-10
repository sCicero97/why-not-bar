// api/lookup-email.js — Resuelve email a partir del display_name
// Permite iniciar sesión con el nombre en lugar del email.
// No requiere autenticación (es una búsqueda de nombre → email para la app interna).

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name requerido' });

  const adminDb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Buscar en profiles por display_name (case-insensitive)
  const { data: profile, error } = await adminDb
    .from('profiles')
    .select('id')
    .ilike('display_name', name)
    .maybeSingle();

  if (error || !profile) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  // Obtener email desde auth.users usando el id del perfil
  const { data: { user }, error: userErr } = await adminDb.auth.admin.getUserById(profile.id);
  if (userErr || !user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  return res.json({ email: user.email });
};
