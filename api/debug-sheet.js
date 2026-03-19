const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzJTz4UeI4Xai8LNUqF-c7HCYBUzd5IVVUlNDsODj_njsS4kh2yTeW4TPjtp8a915Iq/exec";

const BACKUP_TOKEN = "~odB9aur6[Z1";

module.exports = async (req, res) => {
  const results = {};

  // Test 1: GET request
  try {
    const getRes = await fetch(APPS_SCRIPT_URL, { method: "GET", redirect: "follow" });
    const getText = await getRes.text();
    results.get = { status: getRes.status, body: getText.slice(0, 200) };
  } catch (e) {
    results.get = { error: e.message };
  }

  // Test 2: POST with form-encoded payload
  try {
    const testPayload = JSON.stringify({ token: BACKUP_TOKEN, test: true });
    const postRes = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "payload=" + encodeURIComponent(testPayload),
      redirect: "follow"
    });
    const postText = await postRes.text();
    results.postForm = { status: postRes.status, body: postText.slice(0, 300) };
  } catch (e) {
    results.postForm = { error: e.message };
  }

  // Test 3: POST with JSON body
  try {
    const postRes = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: BACKUP_TOKEN, test: true }),
      redirect: "follow"
    });
    const postText = await postRes.text();
    results.postJson = { status: postRes.status, body: postText.slice(0, 300) };
  } catch (e) {
    results.postJson = { error: e.message };
  }

  return res.status(200).json(results);
};
