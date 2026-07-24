// web/js/api.js
async function call(method, path, body) {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
export const api = {
  logSession: (s) => call("POST", "/api/sessions", s),
  getSessions: (from, to) => call("GET", `/api/sessions?from=${from ?? ""}&to=${to ?? ""}`),
  getStats: (tz) => call("GET", `/api/stats?tz=${tz}`),
  getSettings: () => call("GET", "/api/settings"),
  putSettings: (o) => call("PUT", "/api/settings", o),
  listPresets: () => call("GET", "/api/presets"),
  createPreset: (name, config) => call("POST", "/api/presets", { name, config }),
  deletePreset: (id) => call("DELETE", `/api/presets/${id}`),
  quit: () => call("POST", "/api/quit", {}),
};
