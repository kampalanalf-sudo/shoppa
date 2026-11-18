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
function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
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
function transactionMatches(tx, expected) {
  if (tx.amount !== void 0 && Number(tx.amount) !== expected.amount) return false;
  if (tx.currency !== void 0 && normalizeCurrency(tx.currency) !== expected.currency) return false;
  if (expected.direction && tx.direction && tx.direction !== expected.direction) return false;
  return true;
}
const encoder = new TextEncoder();
async function verifyWebhookSignature(raw, signature) {
  const secret = (process.env.DGATEWAY_WEBHOOK_SECRET || "").trim();
  if (!secret) return false;
  if (!signature) return false;
  const received = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  let diff = 0;
  for (let i = 0; i < digest.length; i++) {
    diff |= digest[i] ^ parseInt(received.slice(i * 2, i * 2 + 2), 16);
  }
  return diff === 0;
}
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
function supabaseAdminConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key, ready: Boolean(url && key) };
}
async function restRpc(fn, args) {
  const { url, key, ready } = supabaseAdminConfig();
  if (!ready) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(args)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function restSelect(path) {
  const { url, key, ready } = supabaseAdminConfig();
  if (!ready) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`select failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}
async function restPatch(path, patch) {
  const { url, key, ready } = supabaseAdminConfig();
  if (!ready) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error(`patch failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}
async function handler(req) {
  if (req.method !== "POST") return methodNotAllowed();
  const raw = await req.text();
  const signature = req.headers.get("X-DGateway-Signature") || req.headers.get("x-dgateway-signature");
  if (!await verifyWebhookSignature(raw, signature)) {
    return json({ error: "invalid signature" }, 401);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const reference = (payload.reference || "").trim();
  if (!reference) return json({ error: "reference is required" }, 400);
  let order;
  try {
    const rows = await restSelect(
      `payment_orders?reference=eq.${encodeURIComponent(reference)}&select=*&limit=1`
    );
    order = rows[0];
  } catch (e) {
    console.error("webhook: order lookup failed", e.message);
    return json({ error: "storage unavailable" }, 503);
  }
  if (!order) {
    return json({ error: "unknown reference" }, 404);
  }
  if (order.status === "completed" || order.status === "failed") {
    return json({ status: order.status, idempotent: true });
  }
  let tx;
  try {
    tx = await fetchTransactionStatus(reference);
  } catch (e) {
    console.error("webhook: status re-fetch failed", e.message);
    return json({ error: "could not verify with provider", retryable: true }, 502);
  }
  if (!transactionMatches(tx, { amount: order.amount, currency: order.currency })) {
    await restPatch(`payment_orders?reference=eq.${encodeURIComponent(reference)}`, {
      status: "failed",
      failure_reason: "provider mismatch: amount or currency"
    }).catch(() => {
    });
    return json({ error: "transaction does not match the order" }, 409);
  }
  const status = normalizeStatus(tx.status);
  if (status === "pending") {
    return json({ status: "pending" });
  }
  try {
    await restRpc("apply_gateway_result", {
      p_reference: reference,
      p_status: status,
      p_provider_ref: tx.provider_ref ?? null,
      p_failure_reason: status === "failed" ? tx.failure_reason ?? "provider reported failure" : null
    });
  } catch (e) {
    console.error("webhook: apply_gateway_result failed", e.message);
    return json({ error: "fulfilment failed", retryable: true }, 500);
  }
  return json({ status });
}
const config = { runtime: "nodejs" };
export {
  config,
  handler as default
};
