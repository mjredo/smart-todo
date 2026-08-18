/* Runs on every request to the site.
 *
 * When Cloudflare Access is configured (ACCESS_TEAM_DOMAIN + ACCESS_AUD), every /api/
 * call must carry a valid Access assertion. Static pages are left to Access itself at
 * the edge — re-checking them here would only produce a worse error page.
 */

import { accessEnabled, verifyAccess } from "../worker-lib/access.js";

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/") && accessEnabled(env)) {
    // The consent landing page is reached from DocuSign's redirect, which cannot
    // carry an Access cookie in every browser flow; it exposes nothing on its own.
    if (url.pathname !== "/api/docusign/consent") {
      try {
        const identity = await verifyAccess(request, env);
        context.data.identity = identity;
      } catch (err) {
        return new Response(
          JSON.stringify({ ok: false, error: `Not signed in: ${err.message}` }, null, 2),
          { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
        );
      }
    }
  }

  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "same-origin");
  // The contract data is private; make sure no shared cache holds on to it.
  if (url.pathname.startsWith("/api/")) out.headers.set("Cache-Control", "no-store");
  return out;
}
