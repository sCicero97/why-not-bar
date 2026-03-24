// api/load.js — Carga el estado completo desde Google Apps Script
// Permite sincronización multi-dispositivo

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwB-L4gLMjjri4rd0ycCPjyr8AQPIJ3_gaPl90OTPRMCwgq86bMpBO5w5ol5_Zv1D6q/exec";

const BACKUP_TOKEN = "~odB9aur6[Z1";

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const url = `${APPS_SCRIPT_URL}?token=${encodeURIComponent(BACKUP_TOKEN)}&action=load`;

    const response = await fetch(url, {
      method:   "GET",
      redirect: "follow",
    });

    const text = await response.text();

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      console.error("Apps Script raw response:", text.slice(0, 300));
      throw new Error("Apps Script devolvió una respuesta inesperada (no JSON)");
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("LOAD_ERROR:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
