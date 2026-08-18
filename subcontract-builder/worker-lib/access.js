/* Cloudflare Access token verification — defence in depth.
 *
 * Access already blocks unauthenticated traffic at the edge; this re-checks the signed
 * assertion inside the Worker so the API cannot be reached even if the app is ever
 * exposed on a hostname that is not behind an Access policy.
 *
 * Enabled only when both ACCESS_TEAM_DOMAIN and ACCESS_AUD are set. Without them the
 * app still runs (you are not locked out mid-setup) but /api/whoami reports it as
 * unprotected so the warning is visible in the UI.
 */

let certsCache = { at: 0, keys: null };

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKeys(teamDomain) {
  // Access rotates signing keys; an hour is well inside the rotation window.
  if (certsCache.keys && Date.now() - certsCache.at < 3600_000) return certsCache.keys;

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Could not fetch Access certificates (HTTP ${res.status}).`);
  const { keys } = await res.json();
  certsCache = { at: Date.now(), keys };
  return keys;
}

export function accessEnabled(env) {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

/* Returns the token payload (with .email) on success, or throws. */
export async function verifyAccess(request, env) {
  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    (request.headers.get("Cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];

  if (!token) throw new Error("No Cloudflare Access token on this request.");

  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) throw new Error("Malformed Access token.");

  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));

  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error("Access token has expired.");

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(env.ACCESS_AUD)) {
    throw new Error("Access token was issued for a different application.");
  }

  const jwk = (await getKeys(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Access token was signed with an unknown key.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!valid) throw new Error("Access token signature did not verify.");

  return payload;
}
