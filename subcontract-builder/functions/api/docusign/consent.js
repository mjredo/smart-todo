/* GET /api/docusign/consent — the landing page DocuSign returns to after you grant
 * one-time consent for JWT impersonation. It has nothing to do; its only job is to be
 * a registered redirect URI and tell you the step worked. */

export const onRequestGet = ({ request }) => {
  const code = new URL(request.url).searchParams.get("code");
  const ok = Boolean(code);
  return new Response(
    `<!doctype html><meta charset="utf-8">
<title>DocuSign consent</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:0 1.5rem;color:#1f2937}
h1{font-size:1.4rem}.ok{color:#047857}.no{color:#b91c1c}code{background:#f3f4f6;padding:.1em .35em;border-radius:4px}</style>
<h1 class="${ok ? "ok" : "no"}">${ok ? "Consent granted" : "No consent code returned"}</h1>
<p>${
      ok
        ? "This integration can now create envelopes on your behalf. You can close this tab and go back to the Subcontract Builder — the <b>Check DocuSign connection</b> button should turn green."
        : "DocuSign did not return a consent code. Make sure this exact URL is listed as a redirect URI on the Integration Key, then open the consent link again."
    }</p>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
};
