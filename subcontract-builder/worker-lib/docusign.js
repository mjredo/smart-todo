/* DocuSign eSignature — JWT Grant (service integration) for Cloudflare Workers.
 *
 * There is no DocuSign SDK that runs on Workers, so this does the three things the
 * SDK would: build and RS256-sign a JWT with WebCrypto, trade it for an access token,
 * and discover which account/base URI that token belongs to.
 *
 * Required environment variables (set as encrypted secrets in the Pages project):
 *   DS_INTEGRATION_KEY  the Integration Key (client ID) of your DocuSign app
 *   DS_USER_ID          the API Username (a GUID) of the user being impersonated
 *   DS_PRIVATE_KEY      the RSA private key, PEM, including the BEGIN/END lines
 * Optional:
 *   DS_ENV              "demo" for the developer sandbox, anything else = production
 *   DS_ACCOUNT_ID       pin a specific account; otherwise the user's default is used
 */

const OAUTH_HOST = (env) =>
  String(env.DS_ENV || "").toLowerCase() === "demo"
    ? "account-d.docusign.com"
    : "account.docusign.com";

/* ---------- small encoding helpers ---------- */

const enc = new TextEncoder();

function b64urlFromBytes(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromString(str) {
  return b64urlFromBytes(enc.encode(str));
}

function bytesFromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- private key handling ---------- */

/* DER length prefix: short form under 128, else long form. */
function derLen(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function derSeq(contentBytes) {
  return Uint8Array.from([0x30, ...derLen(contentBytes.length), ...contentBytes]);
}

/* WebCrypto only imports PKCS#8. DocuSign hands you a PKCS#1 key
 * ("BEGIN RSA PRIVATE KEY"), so wrap it in the PKCS#8 PrivateKeyInfo envelope:
 *   SEQUENCE { INTEGER 0, AlgorithmIdentifier(rsaEncryption, NULL), OCTET STRING pkcs1 } */
function pkcs1ToPkcs8(pkcs1) {
  const version = [0x02, 0x01, 0x00];
  const rsaOid = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const octet = [0x04, ...derLen(pkcs1.length), ...pkcs1];
  return derSeq(Uint8Array.from([...version, ...rsaOid, ...octet]));
}

function importPrivateKey(pem) {
  const text = String(pem || "").replace(/\\n/g, "\n").trim();
  if (!text) throw new Error("DS_PRIVATE_KEY is not set.");

  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(text);
  const isPkcs8 = /BEGIN PRIVATE KEY/.test(text);
  if (!isPkcs1 && !isPkcs8) {
    throw new Error(
      "DS_PRIVATE_KEY does not look like a PEM key — it must include the " +
        "-----BEGIN RSA PRIVATE KEY----- (or BEGIN PRIVATE KEY) header line."
    );
  }

  const body = text
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");

  let der;
  try {
    der = bytesFromB64(body);
  } catch {
    throw new Error("DS_PRIVATE_KEY is not valid base64 — it may have been truncated when pasted.");
  }
  if (isPkcs1) der = pkcs1ToPkcs8(der);

  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/* ---------- JWT grant ---------- */

async function buildAssertion(env) {
  const host = OAUTH_HOST(env);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.DS_INTEGRATION_KEY,
    sub: env.DS_USER_ID,
    aud: host,
    iat: now,
    exp: now + 3600,
    scope: "signature impersonation",
  };

  const signingInput =
    b64urlFromString(JSON.stringify(header)) + "." + b64urlFromString(JSON.stringify(claims));

  const key = await importPrivateKey(env.DS_PRIVATE_KEY);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signingInput));
  return signingInput + "." + b64urlFromBytes(new Uint8Array(sig));
}

/* Consent has to be granted once, by a human, before JWT impersonation works.
 * DocuSign signals that with consent_required; turn it into an actionable message. */
export function consentUrl(env, redirect) {
  const host = OAUTH_HOST(env);
  const params = new URLSearchParams({
    response_type: "code",
    scope: "signature impersonation",
    client_id: env.DS_INTEGRATION_KEY || "",
    redirect_uri: redirect,
  });
  return `https://${host}/oauth/auth?${params}`;
}

export class DocuSignError extends Error {
  constructor(message, { status = 502, detail = null, consent = null } = {}) {
    super(message);
    this.name = "DocuSignError";
    this.status = status;
    this.detail = detail;
    this.consent = consent;
  }
}

function requireConfig(env) {
  const missing = ["DS_INTEGRATION_KEY", "DS_USER_ID", "DS_PRIVATE_KEY"].filter((k) => !env[k]);
  if (missing.length) {
    throw new DocuSignError(
      `DocuSign is not configured yet — missing ${missing.join(", ")}. ` +
        `Set these in the Pages project under Settings → Environment variables.`,
      { status: 503 }
    );
  }
}

/* Token cache. Optional: works fine without a KV binding, just re-authenticates
 * on every request (DocuSign allows this, it is only slower). */
function cacheKV(env) {
  return env.TOKENS || env.DIRECTORY || null;
}

async function fetchToken(env, origin) {
  requireConfig(env);
  const host = OAUTH_HOST(env);
  const assertion = await buildAssertion(env);

  const res = await fetch(`https://${host}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* leave body empty; the raw text is reported below */
  }

  if (!res.ok) {
    if (body.error === "consent_required") {
      throw new DocuSignError(
        "DocuSign needs one-time consent before it will let this integration act on your behalf. " +
          "Open the consent link below, sign in as the API user, and click Accept — then try again.",
        { status: 428, consent: consentUrl(env, `${origin}/api/docusign/consent`) }
      );
    }
    if (body.error === "invalid_grant") {
      throw new DocuSignError(
        "DocuSign rejected the credentials (invalid_grant). The usual causes are: the API Username " +
          "(DS_USER_ID) is not the GUID of a real user in this account, the RSA key does not match " +
          "the one on the Integration Key, or DS_ENV points at the wrong environment " +
          `(currently "${env.DS_ENV || "production"}").`,
        { status: 401, detail: body }
      );
    }
    throw new DocuSignError(`DocuSign token request failed (HTTP ${res.status}).`, {
      status: 502,
      detail: body.error ? body : text.slice(0, 500),
    });
  }

  return { access_token: body.access_token, expires_in: body.expires_in || 3600 };
}

async function fetchUserInfo(env, token) {
  const host = OAUTH_HOST(env);
  const res = await fetch(`https://${host}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new DocuSignError(`Could not read the DocuSign user profile (HTTP ${res.status}).`, {
      status: 502,
      detail: (await res.text()).slice(0, 500),
    });
  }
  const info = await res.json();
  const accounts = info.accounts || [];
  const wanted = env.DS_ACCOUNT_ID
    ? accounts.find((a) => a.account_id === env.DS_ACCOUNT_ID)
    : accounts.find((a) => a.is_default) || accounts[0];

  if (!wanted) {
    throw new DocuSignError(
      env.DS_ACCOUNT_ID
        ? `The API user has no access to account ${env.DS_ACCOUNT_ID}.`
        : "The API user is not a member of any DocuSign account.",
      { status: 403 }
    );
  }

  return {
    name: info.name,
    email: info.email,
    accountId: wanted.account_id,
    accountName: wanted.account_name,
    baseUri: wanted.base_uri, // e.g. https://na3.docusign.net
  };
}

/* Returns { token, accountId, baseUri, ... }, cached where a KV binding exists. */
export async function getSession(env, origin) {
  const kv = cacheKV(env);
  const key = "ds:session:" + (env.DS_INTEGRATION_KEY || "").slice(0, 12);

  if (kv) {
    try {
      const hit = await kv.get(key, "json");
      if (hit && hit.expiresAt > Date.now() + 60_000) return hit;
    } catch {
      /* a cache miss must never break the request */
    }
  }

  const { access_token, expires_in } = await fetchToken(env, origin);
  const info = await fetchUserInfo(env, access_token);
  const session = {
    token: access_token,
    expiresAt: Date.now() + expires_in * 1000,
    ...info,
  };

  if (kv) {
    try {
      await kv.put(key, JSON.stringify(session), { expirationTtl: Math.max(60, expires_in - 120) });
    } catch {
      /* caching is best-effort */
    }
  }
  return session;
}

/* Thin wrapper over the eSignature REST API, scoped to the resolved account. */
export async function dsFetch(session, path, init = {}) {
  const url = `${session.baseUri}/restapi/v2.1/accounts/${session.accountId}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const msg =
      (body && (body.message || body.errorCode)) ||
      (typeof body === "string" ? body.slice(0, 300) : "") ||
      `HTTP ${res.status}`;
    throw new DocuSignError(`DocuSign API error: ${msg}`, { status: res.status, detail: body });
  }
  return body;
}
