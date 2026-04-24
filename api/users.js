// api/users.js — Gestión de usuarios (GET lista · POST crear · DELETE eliminar)
// Requiere: SUPABASE_URL y SUPABASE_SERVICE_KEY en Vercel env vars

const { createClient } = require('@supabase/supabase-js');

function getAdminDb() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Verificar token ──────────────────────────────────────────────────────────
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Sin token de autenticación' });

  const adminDb = getAdminDb();
  const { data: { user }, error: authErr } = await adminDb.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Token inválido' });

  // ── Verificar que sea admin ──────────────────────────────────────────────────
  const { data: callerProfile } = await adminDb
    .from('profiles').select('role').eq('id', user.id).single();
  if (callerProfile?.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores pueden gestionar usuarios' });
  }

  // ── GET: listar todos los usuarios ──────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: authData, error } = await adminDb.auth.admin.listUsers({ perPage: 1000 });
    if (error) return res.status(500).json({ error: error.message });

    const { data: profiles } = await adminDb.from('profiles').select('*');

    const merged = (authData.users || []).map(u => {
      const p = profiles?.find(p => p.id === u.id) || {};
      return {
        id:           u.id,
        email:        u.email,
        role:         p.role || 'bar',
        display_name: p.display_name || '',
        created_at:   u.created_at,
        last_sign_in: u.last_sign_in_at,
      };
    }).sort((a, b) => {
      const order = { admin: 0, bar: 1, door: 2 };
      return (order[a.role] ?? 3) - (order[b.role] ?? 3);
    });

    return res.json({ ok: true, users: merged });
  }

  // ── POST: crear nuevo usuario ────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { email, password, role = 'bar', display_name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }
    if (!['bar', 'door', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const { data: { user: newUser }, error } = await adminDb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role, display_name: display_name || email },
    });
    if (error) return res.status(500).json({ error: error.message });

    // El trigger crea el perfil, pero lo actualizamos por si acaso
    await adminDb.from('profiles').upsert({
      id:           newUser.id,
      role,
      display_name: display_name || email,
    });

    return res.json({ ok: true, user: { id: newUser.id, email: newUser.email } });
  }

  // ── PATCH: cambiar contraseña, email o display_name ─────────────────────────
  if (req.method === 'PATCH') {
    const { userId, password, email, display_name } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requerido' });

    // Actualizar password si viene
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      const { error } = await adminDb.auth.admin.updateUserById(userId, { password });
      if (error) return res.status(500).json({ error: error.message });
    }

    // Actualizar email si viene
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Email inválido' });
      }
      const { error } = await adminDb.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
      });
      if (error) return res.status(500).json({ error: error.message });
    }

    // Actualizar display_name en profiles si viene
    if (display_name !== undefined) {
      const { error } = await adminDb.from('profiles')
        .update({ display_name }).eq('id', userId);
      if (error) return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true });
  }

  // ── DELETE: eliminar usuario ──────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requerido' });
    if (userId === user.id) {
      return res.status(400).json({ error: 'No podés eliminarte a vos mismo' });
    }

    const { error } = await adminDb.auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Método no permitido' });
};
