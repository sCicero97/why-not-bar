// ═══════════════════════════════════════════════════════════════════════════
// Why Not Bar — Google Apps Script ACTUALIZADO
// ═══════════════════════════════════════════════════════════════════════════
//
// INSTRUCCIONES PARA ACTUALIZAR:
//   1. Abrí tu Google Apps Script (script.google.com)
//   2. Borrá todo el código actual y pegá este archivo completo
//   3. Guardá (Ctrl+S)
//   4. Hacé clic en "Implementar" → "Gestionar implementaciones"
//   5. Editá la implementación existente → Versión: "Nueva versión" → Guardar
//   6. Copiá la nueva URL y actualizá APPS_SCRIPT_URL en api/backup.js
//      y en api/load.js si cambió.
//
// NOVEDADES vs versión anterior:
//   • doGet(): devuelve el estado completo guardado (para sync multi-dispositivo)
//   • doPost(): además de guardar el backup, guarda fullState para sync
//   • Hoja "Cuentas Pagas" se actualiza en cada backup
// ═══════════════════════════════════════════════════════════════════════════

const TOKEN           = "~odB9aur6[Z1";
const SHEET_BACKUP    = "Backup";
const SHEET_STATE     = "State";       // Para sincronización multi-dispositivo
const SHEET_PAID      = "Cuentas Pagas";

// ───────────────────────────────────────────────────────────────────────────
// GET — devuelve el estado completo guardado (usado al arrancar la app)
// ───────────────────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const token = e && e.parameter && e.parameter.token;
    if (token !== TOKEN) {
      return jsonResponse({ ok: false, error: "Token inválido" });
    }

    const ss         = SpreadsheetApp.getActiveSpreadsheet();
    const stateSheet = ss.getSheetByName(SHEET_STATE);

    if (!stateSheet) {
      return jsonResponse({ ok: true, state: null });
    }

    const raw = stateSheet.getRange("A1").getValue();
    if (!raw) {
      return jsonResponse({ ok: true, state: null });
    }

    const savedState = JSON.parse(raw);
    return jsonResponse({ ok: true, state: savedState });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST — guarda backup y estado completo
// ───────────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.token !== TOKEN) {
      return jsonResponse({ ok: false, error: "Token inválido" });
    }

    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const now = new Date().toLocaleString("es-UY");

    // 1. Guardar estado completo para sincronización multi-dispositivo
    if (data.fullState) {
      let stateSheet = ss.getSheetByName(SHEET_STATE);
      if (!stateSheet) stateSheet = ss.insertSheet(SHEET_STATE);
      stateSheet.getRange("A1").setValue(JSON.stringify(data.fullState));
    }

    // 2. Log de backups (historial)
    let backupSheet = ss.getSheetByName(SHEET_BACKUP);
    if (!backupSheet) {
      backupSheet = ss.insertSheet(SHEET_BACKUP);
      backupSheet.appendRow([
        "Timestamp", "Abiertas", "Pagas", "Total general",
        "Tragos 160", "Tragos 260", "Tragos 360", "Cuentas pagas #"
      ]);
    }

    backupSheet.appendRow([
      now,
      data.summary ? data.summary.openTotal  : 0,
      data.summary ? data.summary.paidTotal  : 0,
      data.summary ? data.summary.grandTotal : 0,
      data.summary ? data.summary.qty160     : 0,
      data.summary ? data.summary.qty260     : 0,
      data.summary ? data.summary.qty360     : 0,
      (data.paidAccounts || []).length,
    ]);

    // 3. Hoja "Cuentas Pagas" — reemplaza con los datos actuales
    if (data.paidAccounts && data.paidAccounts.length > 0) {
      let paidSheet = ss.getSheetByName(SHEET_PAID);
      if (!paidSheet) {
        paidSheet = ss.insertSheet(SHEET_PAID);
      } else {
        paidSheet.clearContents();
      }

      paidSheet.appendRow(["ID", "Total", "#160", "#260", "#360", "Hora cierre"]);

      const rows = data.paidAccounts.map(function(a) {
        return [a.id, a.total, a.qty160, a.qty260, a.qty360, a.closedAt];
      });
      paidSheet.getRange(2, 1, rows.length, 6).setValues(rows);
    }

    return jsonResponse({ ok: true });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Helper
// ───────────────────────────────────────────────────────────────────────────
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
