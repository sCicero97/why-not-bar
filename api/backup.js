const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwB-L4gLMjjri4rd0ycCPjyr8AQPIJ3_gaPl90OTPRMCwgq86bMpBO5w5ol5_Zv1D6q/exec";

const BACKUP_TOKEN = "~odB9aur6[Z1";

async function postToAppsScript(payload) {
  // Server-to-server: no CORS restrictions, send JSON directly
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload),
    redirect: "follow"
  });

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    // If response isn't JSON (e.g. HTML error page), return a clear error
    console.error("Apps Script raw response:", text.slice(0, 300));
    throw new Error("Apps Script devolvió una respuesta inesperada (no JSON)");
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const data = req.body || {};

    const payload = {
      ...data,
      token: BACKUP_TOKEN
    };

    const result = await postToAppsScript(payload);

    return res.status(200).json(result);
  } catch (error) {
    console.error("BACKUP_ERROR:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message || "Error desconocido"
    });
  }
};
