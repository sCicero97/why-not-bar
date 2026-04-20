// api/send-whatsapp.js — Envía mensaje vía Telegram Bot
// Configurar en Vercel → Settings → Environment Variables:
//   TELEGRAM_BOT_TOKEN → token del bot (de @BotFather)
//   TELEGRAM_CHAT_ID   → ID del grupo (número negativo, ej: -5227164571)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message requerido' });

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // DEBUG TEMPORAL — sacar después
  console.log('[Telegram] token:', token ? token.slice(0,10)+'...' : 'FALTA');
  console.log('[Telegram] chatId:', chatId || 'FALTA');

  if (!token || !chatId) {
    return res.json({ ok: true, sent: 0, reason: 'Telegram no configurado', debug: { token: !!token, chatId: !!chatId } });
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });

  const result = await response.json();
  console.log('[Telegram] result:', JSON.stringify(result));
  if (!result.ok) return res.status(500).json({ error: result.description, debug: { chatId, tokenStart: token.slice(0,10) } });
  res.json({ ok: true, sent: 1 });
};
