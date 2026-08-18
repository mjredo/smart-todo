/* POST /api/docusign/send — turn the generated contract into a sent DocuSign envelope.
 *
 * The browser generates the .docx (the same file the "Download Word" button produces),
 * base64s it, and posts it here with the recipients and the email text. DocuSign converts
 * the .docx to PDF on its side, finds the hidden anchor strings the generator embedded
 * in the signature block, and places the signature/date tabs on them.
 *
 * Anchors, written as white 1pt text next to each "By:" line:
 *   /sn1/  subcontractor signature
 *   /cn1/  contractor (your side) signature
 */

import { getSession, dsFetch } from "../../../worker-lib/docusign.js";
import { handler, json, fail, readJson } from "../../../worker-lib/http.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* DocuSign caps the envelope message; trim rather than let the API reject the whole send. */
const BLURB_LIMIT = 9800;

function signerTabs(anchor) {
  return {
    signHereTabs: [
      {
        anchorString: anchor,
        anchorUnits: "pixels",
        anchorXOffset: "0",
        anchorYOffset: "-8",
        // Fail loudly if the anchor is missing rather than silently sending an untagged
        // envelope that nobody can sign.
        anchorIgnoreIfNotPresent: "false",
      },
    ],
    dateSignedTabs: [
      {
        anchorString: anchor,
        anchorUnits: "pixels",
        anchorXOffset: "190",
        anchorYOffset: "-8",
        anchorIgnoreIfNotPresent: "false",
      },
    ],
  };
}

export const onRequestPost = handler(async ({ request, env }) => {
  const origin = new URL(request.url).origin;
  const body = await readJson(request);

  const {
    documentBase64,
    documentName = "Subcontract Agreement.docx",
    subject,
    message = "",
    signer = {},
    countersigner = null,
    cc = [],
    draft = false,
  } = body;

  /* ---- validate before spending a DocuSign call ---- */
  if (!documentBase64) return fail("No contract document was attached to the request.");
  if (!signer.email || !EMAIL_RE.test(signer.email)) {
    return fail("The subcontractor's email address is missing or not a valid address.");
  }
  if (!signer.name || !signer.name.trim()) {
    return fail("The subcontractor's signer name is required — DocuSign will not send without it.");
  }
  if (!subject || !subject.trim()) return fail("The email subject is required.");

  const badCc = cc.filter((r) => r && r.email && !EMAIL_RE.test(r.email));
  if (badCc.length) return fail(`Not a valid CC address: ${badCc.map((r) => r.email).join(", ")}`);

  if (countersigner && countersigner.email && !EMAIL_RE.test(countersigner.email)) {
    return fail("The countersigner's email address is not valid.");
  }

  const session = await getSession(env, origin);

  /* ---- recipients ---- */
  const signers = [
    {
      email: signer.email.trim(),
      name: signer.name.trim(),
      recipientId: "1",
      routingOrder: "1",
      tabs: signerTabs("/sn1/"),
    },
  ];

  // Your side countersigns after the subcontractor, if an address was supplied.
  if (countersigner && countersigner.email && countersigner.name) {
    signers.push({
      email: countersigner.email.trim(),
      name: countersigner.name.trim(),
      recipientId: "2",
      routingOrder: "2",
      tabs: signerTabs("/cn1/"),
    });
  }

  const carbonCopies = cc
    .filter((r) => r && r.email && EMAIL_RE.test(r.email))
    // Copying an address that is already signing is rejected by DocuSign.
    .filter((r) => !signers.some((s) => s.email.toLowerCase() === r.email.trim().toLowerCase()))
    .map((r, i) => ({
      email: r.email.trim(),
      name: (r.name || r.email).trim(),
      recipientId: String(100 + i),
      routingOrder: String(signers.length + 1),
    }));

  const envelope = {
    emailSubject: subject.trim().slice(0, 100), // DocuSign truncates past 100 anyway
    emailBlurb: String(message).slice(0, BLURB_LIMIT),
    documents: [
      {
        documentBase64,
        name: documentName.replace(/\.docx$/i, ""),
        fileExtension: "docx",
        documentId: "1",
      },
    ],
    recipients: { signers, ...(carbonCopies.length ? { carbonCopies } : {}) },
    status: draft ? "created" : "sent",
  };

  const result = await dsFetch(session, "/envelopes", {
    method: "POST",
    body: JSON.stringify(envelope),
  });

  return json({
    ok: true,
    envelopeId: result.envelopeId,
    status: result.status,
    sentTo: signers.map((s) => s.email),
    copiedTo: carbonCopies.map((r) => r.email),
    account: { id: session.accountId, name: session.accountName },
    // Deep link into the DocuSign web app for this envelope.
    manageUrl: `https://${
      String(env.DS_ENV || "").toLowerCase() === "demo" ? "appdemo" : "app"
    }.docusign.com/documents/details/${result.envelopeId}`,
  });
});

export const onRequestGet = () =>
  json(
    {
      ok: false,
      error: "Use POST to send an envelope. GET /api/docusign/ping checks the connection.",
    },
    405
  );
