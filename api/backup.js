const { google } = require("googleapis");
const crypto = require("crypto");

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const {
      GOOGLE_CLIENT_EMAIL,
      GOOGLE_PRIVATE_KEY,
      GOOGLE_SHEET_ID
    } = process.env;

    if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
      return res.status(500).json({
        ok: false,
        error: "Faltan variables de entorno de Google"
      });
    }

    const auth = new google.auth.JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    const sheets = google.sheets({
      version: "v4",
      auth
    });

    const data = req.body || {};
    const summary = data.summary || {};
    const openAccounts = Array.isArray(data.openAccounts) ? data.openAccounts : [];
    const paidAccounts = Array.isArray(data.paidAccounts) ? data.paidAccounts : [];
    const backupCreatedAt = data.backupCreatedAt || new Date().toISOString();
    const backupId = makeId();

    const summaryRows = [[
      backupId,
      backupCreatedAt,
      summary.openTotal || 0,
      summary.paidTotal || 0,
      summary.grandTotal || 0,
      summary.qty160 || 0,
      summary.qty260 || 0,
      summary.qty360 || 0,
      summary.openAccountsCount || 0,
      summary.paidAccountsCount || 0
    ]];

    const openRows = openAccounts.map((account) => [
      backupId,
      backupCreatedAt,
      account.slot || "",
      account.id || "",
      account.total || 0,
      account.qty160 || 0,
      account.qty260 || 0,
      account.qty360 || 0
    ]);

    const paidRows = paidAccounts.map((account) => [
      backupId,
      backupCreatedAt,
      account.id || "",
      account.total || 0,
      account.qty160 || 0,
      account.qty260 || 0,
      account.qty360 || 0,
      account.closedAt || ""
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Resumen!A:J",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: summaryRows
      }
    });

    if (openRows.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Abiertas!A:H",
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: openRows
        }
      });
    }

    if (paidRows.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Pagas!A:H",
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: paidRows
        }
      });
    }

    return res.status(200).json({
      ok: true,
      backupId
    });
  } catch (error) {
    console.error("backup error", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Backup error"
    });
  }
};