const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzJTz4UeI4Xai8LNUqF-c7HCYBUzd5IVVUlNDsODj_njsS4kh2yTeW4TPjtp8a915Iq/exec";

const BACKUP_TOKEN = "~odB9aur6[Z1";

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

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "payload=" + encodeURIComponent(JSON.stringify(payload)),
      redirect: "follow"
    });

    const text = await response.text();

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { ok: false, error: "Respuesta inesperada del Apps Script", raw: text };
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("BACKUP_ERROR:", error.message);
    return res.status(500).json({
      ok: false,
      error: error.message || "Error desconocido"
    });
  }
};
