/* What actually reaches DocuSign: anchors, routing order, CC handling, and every
 * validation path that should stop a bad envelope before it costs an API call. */
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/docusign/send.js";
import { pkcs1 } from "./keys.mjs";

let envelope = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("/oauth/token")) return new Response(JSON.stringify({ access_token: "T", expires_in: 3600 }), { status: 200 });
  if (u.includes("/oauth/userinfo"))
    return new Response(
      JSON.stringify({
        name: "MJ", email: "mj@example.com",
        accounts: [{ account_id: "ACC1", account_name: "MJ Property Investments", is_default: true, base_uri: "https://na3.docusign.net" }],
      }), { status: 200 });
  if (u.includes("/envelopes")) {
    envelope = JSON.parse(init.body);
    return new Response(JSON.stringify({ envelopeId: "ENV-123", status: envelope.status }), { status: 201 });
  }
  throw new Error("unexpected fetch: " + u);
};

const env = { DS_INTEGRATION_KEY: "k", DS_USER_ID: "u", DS_ENV: "demo", DS_PRIVATE_KEY: pkcs1 };
const call = (body) =>
  onRequestPost({
    env,
    request: new Request("https://scb.example.com/api/docusign/send", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  });

const base = {
  documentBase64: Buffer.from("fake docx").toString("base64"),
  documentName: "Subcontract_Casner.docx",
  subject: "Subcontract Agreement — 2306 Clark Lane",
  message: "Please sign and return your COI, W-9 and licence.",
  signer: { name: "Joshua Casner", email: "josh@casner.example" },
  countersigner: { name: "Manoj Narang", email: "mj@example.com" },
  cc: [{ email: "office@example.com" }, { email: "mj@example.com" }],
};

{
  const body = await (await call(base)).json();
  assert.equal(body.ok, true);
  assert.equal(body.envelopeId, "ENV-123");
  assert.equal(body.manageUrl, "https://appdemo.docusign.com/documents/details/ENV-123");

  const [sub, gc] = envelope.recipients.signers;
  assert.equal(envelope.status, "sent");
  assert.equal(envelope.documents[0].fileExtension, "docx");
  assert.equal(envelope.documents[0].name, "Subcontract_Casner", "the .docx suffix is added by DocuSign");

  assert.equal(sub.routingOrder, "1");
  assert.equal(sub.tabs.signHereTabs[0].anchorString, "/sn1/");
  assert.equal(sub.tabs.dateSignedTabs[0].anchorString, "/sn1/");
  assert.equal(sub.tabs.signHereTabs[0].anchorIgnoreIfNotPresent, "false", "a missing anchor must fail loudly");

  assert.equal(gc.routingOrder, "2", "your side countersigns after the subcontractor");
  assert.equal(gc.tabs.signHereTabs[0].anchorString, "/cn1/");

  // Copying someone who is already signing is rejected by DocuSign, so drop it here.
  assert.deepEqual(envelope.recipients.carbonCopies.map((c) => c.email), ["office@example.com"]);
  console.log("  ok: envelope shape, anchors, routing order, CC de-duplication");
}

{
  await call({ ...base, draft: true });
  assert.equal(envelope.status, "created", "draft mode must not email anyone");
  console.log("  ok: draft mode creates without sending");
}

{
  await call({ ...base, countersigner: null, cc: [] });
  assert.equal(envelope.recipients.signers.length, 1);
  assert.ok(!("carbonCopies" in envelope.recipients));
  console.log("  ok: single-signer envelope omits empty recipient lists");
}

{
  const long = "x".repeat(20000);
  await call({ ...base, message: long, subject: "s".repeat(300) });
  assert.ok(envelope.emailBlurb.length <= 9800, "message must be trimmed to DocuSign's limit");
  assert.ok(envelope.emailSubject.length <= 100, "subject must be trimmed to DocuSign's limit");
  console.log("  ok: over-long subject and message are trimmed, not rejected");
}

for (const [label, patch, expect] of [
  ["no document", { documentBase64: undefined }, /No contract document/],
  ["bad signer email", { signer: { name: "X", email: "nope" } }, /not a valid address/],
  ["no signer name", { signer: { name: "", email: "a@b.com" } }, /signer name is required/],
  ["no subject", { subject: "" }, /subject is required/],
  ["bad cc address", { cc: [{ email: "oops" }] }, /Not a valid CC address/],
  ["bad countersigner", { countersigner: { name: "N", email: "bad" } }, /countersigner's email/],
]) {
  const res = await call({ ...base, ...patch });
  const body = await res.json();
  assert.equal(res.status, 400, label);
  assert.match(body.error, expect, label);
  console.log("  ok: rejects", label);
}

console.log("send.test.mjs — passed");
