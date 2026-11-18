const DG_BASE = (process.env.DGATEWAY_API_URL || "https://dgatewayapi.desispay.com").replace(/\/$/, "");
class GatewayError extends Error {
  code;
  httpStatus;
  constructor(message, code = "PROVIDER_ERROR", httpStatus = 502) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
function apiKey() {
  const key = (process.env.DGATEWAY_API_KEY || "").trim();
  if (!key) {
    throw new GatewayError(
      "Card and mobile money are not configured on this deployment. No payment has been requested.",
      "PAYMENT_NOT_CONFIGURED",
      503
    );
  }
  return key;
}
function normalizeStatus(value) {
  const s = String(value || "").toLowerCase();
  if (s === "completed") return "completed";
  if (s === "failed") return "failed";
  return "pending";
}
async function request(path, init) {
  const key = apiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25e3);
  try {
    const res = await fetch(`${DG_BASE}${path}`, {
      method: init?.method || "GET",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: init?.body === void 0 ? void 0 : JSON.stringify(init.body),
      signal: controller.signal
    });
    const json2 = await res.json().catch(() => null);
    if (!res.ok || json2?.error) {
      const err = json2?.error;
      const code = typeof err === "object" ? err?.code : json2?.code;
      const message = typeof err === "object" ? err?.message : err;
      const httpStatus = res.status === 429 ? 429 : [400, 404, 409, 422].includes(res.status) ? 400 : [401, 403].includes(res.status) ? 503 : 502;
      throw new GatewayError(
        message || json2?.message || `DGateway returned HTTP ${res.status}`,
        code || (httpStatus === 503 ? "PAYMENT_NOT_CONFIGURED" : "PROVIDER_ERROR"),
        httpStatus
      );
    }
    if (!json2?.data) {
      throw new GatewayError("DGateway returned an incomplete response.", "INVALID_RESPONSE", 502);
    }
    return json2.data;
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    if (controller.signal.aborted) {
      throw new GatewayError(
        "DGateway did not respond in time. Keep your reference and check again in a moment.",
        "PROVIDER_TIMEOUT",
        504
      );
    }
    throw new GatewayError(
      "We couldn't reach DGateway. Keep your reference and try again shortly.",
      "PROVIDER_UNAVAILABLE",
      502
    );
  } finally {
    clearTimeout(timer);
  }
}
async function fetchTransactionStatus(reference) {
  const tx = await request(`/v1/transactions/${encodeURIComponent(reference)}/status`);
  if (tx.reference && tx.reference !== reference) {
    throw new GatewayError("Payment verification did not match the request.", "INVALID_RESPONSE", 502);
  }
  return tx;
}
new TextEncoder();
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function methodNotAllowed() {
  return json({ error: "method not allowed" }, 405);
}
function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}
function supabaseAdminConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key, ready: Boolean(url && key) };
}
async function requireUser(req) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { url, key, ready } = supabaseAdminConfig();
  if (!ready) return null;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? { id: user.id } : null;
}
const MIN_INTERVAL_MS = 1e4;
const cache = /* @__PURE__ */ new Map();
const inflight = /* @__PURE__ */ new Map();
function gc() {
  const cutoff = Date.now() - 5 * 6e4;
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
}
async function handler(req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return methodNotAllowed();
  const user = await requireUser(req);
  if (!user) return json({ error: "not authenticated" }, 401);
  const url = new URL(req.url);
  const reference = (url.searchParams.get("reference") || "").trim();
  if (!reference) return json({ error: "reference is required" }, 400);
  const fresh = url.searchParams.get("fresh") === "1";
  const hit = cache.get(reference);
  if (!fresh && hit && Date.now() - hit.at < MIN_INTERVAL_MS) {
    return json({ ...hit.payload, cached: true, pollAfterMs: MIN_INTERVAL_MS });
  }
  let pending = inflight.get(reference);
  if (!pending) {
    pending = (async () => {
      const tx = await fetchTransactionStatus(reference);
      const payload = {
        reference,
        status: normalizeStatus(tx.status),
        rawStatus: tx.status,
        provider: tx.provider ?? null,
        amount: tx.amount ?? null,
        currency: tx.currency ?? null,
        failureReason: tx.failure_reason ?? null
      };
      cache.set(reference, { at: Date.now(), payload });
      gc();
      return payload;
    })().finally(() => inflight.delete(reference));
    inflight.set(reference, pending);
  }
  try {
    const payload = await pending;
    return json({ ...payload, cached: false, pollAfterMs: MIN_INTERVAL_MS });
  } catch (e) {
    const err = e;
    if (hit) return json({ ...hit.payload, cached: true, stale: true, pollAfterMs: MIN_INTERVAL_MS });
    return json({ error: err.message, code: err.code }, err.httpStatus || 502);
  }
}
const config = { runtime: "nodejs" };
export {
  config,
  handler as default
};
