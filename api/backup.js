const { google } = require("googleapis");
const crypto = require("crypto");

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      step: "method",
      error: "Method not allowed"
    });
  }

  try {
    const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
    const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
    const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

    if (!GOOGLE_CLIENT_EMAIL) {
      return res.status(500).json({
        ok: false,
        step: "env",
        error: "Falta GOOGLE_CLIENT_EMAIL"
      });
    }

    if (!GOOGLE_PRIVATE_KEY) {
      return res.status(500).json({
        ok: false,
        step: "env",
        error: "Falta GOOGLE_PRIVATE_KEY"
      });
    }

    if (!GOOGLE_SHEET_ID) {
      return res.status(500).json({
        ok: false,
        step: "env",
        error: "Falta GOOGLE_SHEET_ID"
      });
    }

    const auth = new google.auth.JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets"
      ]
    });

    await auth.authorize();

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

    if (openRows.length > 0) {
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

    if (paidRows.length > 0) {
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
    const details =
      error?.response?.data ||
      error?.errors ||
      error?.message ||
      "Error desconocido";

    console.error("BACKUP_ERROR:", JSON.stringify(details, null, 2));

    return res.status(500).json({
      ok: false,
      step: "runtime",
      error: error.message || "Error desconocido",
      details
    });
  }
};