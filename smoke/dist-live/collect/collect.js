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
function normalizePhone(input) {
  const raw = String(input || "").trim().replace(/[\s().-]/g, "");
  if (!raw) return null;
  if (/^\+(?:256[17]\d{8}|2547\d{8}|255[67]\d{8}|2507[2389]\d{7})$/.test(raw)) return raw;
  if (/^(?:256[17]\d{8}|2547\d{8}|255[67]\d{8}|2507[2389]\d{7})$/.test(raw)) return raw;
  if (/^0[17]\d{8}$/.test(raw)) return raw;
  return null;
}
function isWholeAmount(amount) {
  return typeof amount === "number" && Number.isInteger(amount) && amount > 0;
}
function normalizeCurrency(value) {
  return String(value).trim().toUpperCase();
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
async function collectPayment(input) {
  const tx = await request("/v1/payments/collect", { method: "POST", body: input });
  if (!tx.reference) {
    throw new GatewayError("DGateway did not return a payment reference.", "INVALID_RESPONSE", 502);
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
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
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
function publicOrigin(req) {
  const configured = (process.env.APP_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return new URL(req.url).origin;
}
function newOrderRef(prefix) {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rand}`;
}
async function handler(req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return methodNotAllowed();
  const body = await readJson(req);
  if (!body) return json({ error: "invalid JSON body" }, 400);
  const user = await requireUser(req);
  if (!user) return json({ error: "not authenticated" }, 401);
  const currency = normalizeCurrency(body.currency || "UGX");
  if (!isWholeAmount(body.amount)) {
    return json({ error: "amount must be a whole positive integer in minor units" }, 400);
  }
  const phone = normalizePhone(body.phone || body.phone_number || "");
  if (!phone) {
    return json(
      { error: "Enter a valid mobile money number (07XXXXXXXX, 2567XXXXXXXX or +2567XXXXXXXX)." },
      400
    );
  }
  const description = (body.description || `FloatBet top-up ${body.orderId || ""}`).slice(0, 120).trim();
  const orderId = body.orderId || newOrderRef("TOP");
  try {
    const tx = await collectPayment({
      amount: body.amount,
      currency,
      // keep the leading 0 / country code exactly as supplied
      phone_number: phone,
      description,
      callback_url: `${publicOrigin(req)}/api/webhooks/dgateway`
    });
    try {
      await restRpc("record_collect", {
        p_user: user.id,
        p_order: orderId,
        p_reference: tx.reference,
        p_amount: body.amount,
        p_currency: currency,
        p_phone: phone,
        p_provider: tx.provider ?? null
      });
    } catch (e) {
      console.error("record_collect failed", e.message);
    }
    return json({
      reference: tx.reference,
      status: tx.status || "pending",
      provider: tx.provider ?? null,
      orderId,
      message: "Check your phone and approve the prompt."
    });
  } catch (e) {
    const err = e;
    return json({ error: err.message, code: err.code }, err.httpStatus || 502);
  }
}
const config = { runtime: "nodejs" };
export {
  config,
  handler as default
};
