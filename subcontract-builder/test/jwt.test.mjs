/* The JWT grant is the part with no room for "looks right": if the assertion does not
 * verify, DocuSign returns invalid_grant and there is nothing to debug from.
 * So sign one and check it against the public key with Node's own crypto. */
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { getSession } from "../worker-lib/docusign.js";
import { pkcs1, pkcs8, publicPem } from "./keys.mjs";

let captured = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("/oauth/token")) {
    captured = new URLSearchParams(init.body).get("assertion");
    return new Response(JSON.stringify({ access_token: "T", expires_in: 3600 }), { status: 200 });
  }
  if (u.includes("/oauth/userinfo")) {
    return new Response(
      JSON.stringify({
        name: "Test User",
        email: "test@example.com",
        accounts: [
          { account_id: "ACC1", account_name: "Test Account", is_default: true, base_uri: "https://na3.docusign.net" },
        ],
      }),
      { status: 200 }
    );
  }
  throw new Error("unexpected fetch: " + u);
};

const buf = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const pub = crypto.createPublicKey(publicPem);

for (const [label, key] of [
  ["PKCS#1 — the format DocuSign gives you", pkcs1],
  ["PKCS#8", pkcs8],
  ["PKCS#1 with escaped newlines, as pasted into a secret box", pkcs1.replace(/\n/g, "\\n")],
]) {
  captured = null;
  const session = await getSession(
    { DS_INTEGRATION_KEY: "key-abc", DS_USER_ID: "user-guid", DS_PRIVATE_KEY: key, DS_ENV: "demo" },
    "https://example.com"
  );

  const [h, p, sig] = captured.split(".");
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), pub, buf(sig)), `${label}: bad signature`);

  const header = JSON.parse(buf(h));
  const claims = JSON.parse(buf(p));
  assert.equal(header.alg, "RS256");
  assert.equal(claims.iss, "key-abc");
  assert.equal(claims.sub, "user-guid");
  assert.equal(claims.aud, "account-d.docusign.com", "demo must target the sandbox host");
  assert.equal(claims.scope, "signature impersonation");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(session.accountId, "ACC1");
  assert.equal(session.baseUri, "https://na3.docusign.net");
  console.log("  ok:", label);
}

// Production must not quietly talk to the sandbox.
captured = null;
await getSession({ DS_INTEGRATION_KEY: "k", DS_USER_ID: "u", DS_PRIVATE_KEY: pkcs1 }, "https://x");
assert.equal(JSON.parse(buf(captured.split(".")[1])).aud, "account.docusign.com");
console.log("  ok: default environment is production");

// Bad keys must fail with something a human can act on, not a stack trace.
for (const [label, key, expect] of [
  ["missing key", "", /missing DS_PRIVATE_KEY/],
  ["not a PEM", "hello", /does not look like a PEM key/],
  ["truncated body", "-----BEGIN RSA PRIVATE KEY-----\nMIIE!!!\n-----END RSA PRIVATE KEY-----", /not valid base64/],
]) {
  await assert.rejects(
    () => getSession({ DS_INTEGRATION_KEY: "k", DS_USER_ID: "u", DS_PRIVATE_KEY: key }, "https://x"),
    expect,
    label
  );
  console.log("  ok: rejects", label);
}

// consent_required has to surface as an actionable link, not a 502.
globalThis.fetch = async (url) =>
  String(url).includes("/oauth/token")
    ? new Response(JSON.stringify({ error: "consent_required" }), { status: 400 })
    : new Response("{}", { status: 200 });

await assert.rejects(
  () => getSession({ DS_INTEGRATION_KEY: "k", DS_USER_ID: "u", DS_PRIVATE_KEY: pkcs1 }, "https://site.example"),
  (e) => {
    assert.equal(e.status, 428);
    assert.match(e.consent, /^https:\/\/account\.docusign\.com\/oauth\/auth\?/);
    assert.match(e.consent, /redirect_uri=https%3A%2F%2Fsite\.example%2Fapi%2Fdocusign%2Fconsent/);
    return true;
  }
);
console.log("  ok: consent_required returns a usable consent URL");

console.log("jwt.test.mjs — passed");
