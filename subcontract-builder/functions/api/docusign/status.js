/* GET /api/docusign/status?envelopeId=... — where an envelope got to.
 * Returns the envelope status plus per-recipient status, so the tool can show
 * "sent / delivered / signed" without opening DocuSign. */

import { getSession, dsFetch } from "../../../worker-lib/docusign.js";
import { handler, json, fail } from "../../../worker-lib/http.js";

export const onRequestGet = handler(async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("envelopeId");
  if (!id) return fail("Pass ?envelopeId=... to check an envelope.");

  const session = await getSession(env, url.origin);
  const [envelope, recipients] = await Promise.all([
    dsFetch(session, `/envelopes/${encodeURIComponent(id)}`),
    dsFetch(session, `/envelopes/${encodeURIComponent(id)}/recipients`),
  ]);

  const people = [
    ...(recipients.signers || []).map((r) => ({ role: "signer", ...pick(r) })),
    ...(recipients.carbonCopies || []).map((r) => ({ role: "cc", ...pick(r) })),
  ];

  return json({
    ok: true,
    envelopeId: envelope.envelopeId,
    status: envelope.status,
    emailSubject: envelope.emailSubject,
    sentDateTime: envelope.sentDateTime,
    completedDateTime: envelope.completedDateTime || null,
    recipients: people,
  });
});

function pick(r) {
  return { name: r.name, email: r.email, status: r.status, signedDateTime: r.signedDateTime || null };
}
