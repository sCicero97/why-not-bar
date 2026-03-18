const { google } = require("googleapis");

module.exports = async (req, res) => {
  try {
    const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
    const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
    const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

    if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
      return res.status(500).json({
        ok: false,
        error: "Faltan variables de entorno",
        env: {
          GOOGLE_CLIENT_EMAIL: !!GOOGLE_CLIENT_EMAIL,
          GOOGLE_PRIVATE_KEY: !!GOOGLE_PRIVATE_KEY,
          GOOGLE_SHEET_ID: !!GOOGLE_SHEET_ID
        }
      });
    }

    const auth = new google.auth.JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly"
      ]
    });

    await auth.authorize();

    const sheets = google.sheets({
      version: "v4",
      auth
    });

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID
    });

    const sheetNames = (spreadsheet.data.sheets || []).map(
      (s) => s.properties.title
    );

    return res.status(200).json({
      ok: true,
      title: spreadsheet.data.properties?.title || null,
      sheets: sheetNames,
      clientEmail: GOOGLE_CLIENT_EMAIL
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Error desconocido",
      details: error?.response?.data || null
    });
  }
};