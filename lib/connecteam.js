const BASE = "https://api.connecteam.com";
export class ConnecteamError extends Error {
  constructor(message, status = 500, payload = null) {
    super(message);
    this.name = "ConnecteamError";
    this.status = status;
    this.payload = payload;
  }
}
export function assert(condition, message, status = 400) {
  if (!condition) throw new ConnecteamError(message, status);
}
export function ids(values, label = "IDs") {
  assert(Array.isArray(values), `${label} must be an array.`);
  assert(
    values.every(
      (v) =>
        (typeof v === "number" || typeof v === "string") &&
        String(v).trim() &&
        Number.isSafeInteger(Number(v)) &&
        Number(v) > 0,
    ),
    `${label} must contain positive integer IDs.`,
  );
  return [...new Set(values.map(Number))];
}
export function errorData(error) {
  return {
    error: error.message,
    httpStatus: error.status || 500,
    details: error.payload || null,
  };
}
export async function ctFetch(apiKey, path, options = {}) {
  assert(
    typeof apiKey === "string" && apiKey.trim(),
    "Missing Connecteam API key.",
    401,
  );
  assert(path.startsWith("/") && !path.startsWith("//"), "Invalid API path.");
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    });
  } catch (e) {
    throw new ConnecteamError(
      `${options.method || "GET"} ${path}: ${e.name === "TimeoutError" ? "Connecteam timed out" : "Connection failed"}. ${options.method && options.method !== "GET" ? "The write outcome is unknown. Refresh and inspect before retrying." : "Try refreshing."}`,
      502,
    );
  }
  const raw = await res.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }
  if (!res.ok) {
    const detail =
      payload?.message ||
      payload?.error_description ||
      payload?.error ||
      payload?.detail ||
      `HTTP ${res.status}`;
    throw new ConnecteamError(
      `${options.method || "GET"} ${path}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
      res.status,
      payload,
    );
  }
  return payload;
}
export function responseRows(json, key) {
  assert(
    Array.isArray(json?.data?.[key]),
    `Unexpected Connecteam response: data.${key} is missing.`,
    502,
  );
  return json.data[key];
}
export async function collectPages(
  apiKey,
  path,
  dataKey,
  { limit = 500, maxPages = 200, request = ctFetch } = {},
) {
  const rows = [],
    seen = new Set();
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const json = await request(
      apiKey,
      `${path}${path.includes("?") ? "&" : "?"}limit=${limit}&offset=${offset}`,
    );
    const batch = responseRows(json, dataKey);
    const fingerprint = JSON.stringify(batch);
    assert(
      !batch.length || !seen.has(fingerprint),
      `Connecteam repeated a page of ${dataKey}. Scan is incomplete; no partial list was accepted.`,
      502,
    );
    seen.add(fingerprint);
    rows.push(...batch);
    const paging = json?.paging ?? json?.data?.paging;
    const next = paging?.offset;
    if (next !== undefined && next !== null) {
      assert(
        Number.isInteger(Number(next)) && Number(next) > offset,
        `Invalid/repeated pagination offset for ${dataKey}.`,
        502,
      );
      offset = Number(next);
    } else if (batch.length === limit) offset += limit;
    else return { rows, warnings: [] };
  }
  throw new ConnecteamError(
    `Pagination limit reached for ${dataKey}; scan is incomplete.`,
    502,
  );
}
export async function loadSmartGroups(apiKey, request = ctFetch) {
  const groups = responseRows(
    await request(apiKey, "/users/v1/smart-groups"),
    "smartGroups",
  );
  return groups.map((g) => {
    const id = ids([g.id], "Smart-group IDs")[0];
    return { ...g, id, name: g.name || `Smart group ${id}` };
  });
}
export function chunks(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size)
    out.push(array.slice(i, i + size));
  return out;
}
export function extractSelectedIds(value) {
  if (value == null || value === "") return [];
  assert(
    Array.isArray(value),
    "Unexpected dropdown value; refusing to overwrite it.",
    502,
  );
  return ids(
    value.map((v) => (typeof v === "object" ? v.id : v)),
    "Dropdown option IDs",
  );
}
