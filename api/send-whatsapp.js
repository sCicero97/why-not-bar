// api/send-whatsapp.js — Envía mensaje de WhatsApp vía CallMeBot
// Configurar en Vercel → Settings → Environment Variables:
//   WA_PHONE  → número(s) separados por coma: "5491112345678,5491187654321"
//              Para un grupo: agregar CallMeBot (+34 644 59 21 64) al grupo,
//              escribir en el grupo "I allow callmebot to send me messages",
//              y usar el ID del grupo.
//   WA_APIKEY → clave recibida por CallMeBot al activar

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message requerido' });

  const phones = (process.env.WA_PHONE || '')
    .split(',').map(p => p.trim()).filter(Boolean);
  const apikey = process.env.WA_APIKEY;

  if (!phones.length || !apikey) {
    // No configurado → no es error fatal, simplemente no enviar
    return res.json({ ok: true, sent: 0, reason: 'WA no configurado' });
  }

  const results = await Promise.allSettled(
    phones.map(phone => {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apikey}`;
      return fetch(url);
    })
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  res.json({ ok: true, sent, total: phones.length });
};
