const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzJTz4UeI4Xai8LNUqF-c7HCYBUzd5IVVUlNDsODj_njsS4kh2yTeW4TPjtp8a915Iq/exec";

module.exports = async (req, res) => {
  try {
    // Test GET first - should return {ok:true, message:'Web app activo'}
    const getResponse = await fetch(APPS_SCRIPT_URL, {
      method: "GET",
      redirect: "follow"
    });

    const getText = await getResponse.text();
    let getResult;
    try {
      getResult = JSON.parse(getText);
    } catch {
      getResult = { raw: getText.slice(0, 300) };
    }

    return res.status(200).json({
      ok: true,
      appsScriptUrl: APPS_SCRIPT_URL.slice(0, 60) + "...",
      getStatus: getResponse.status,
      getResult
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Error desconocido"
    });
  }
};
