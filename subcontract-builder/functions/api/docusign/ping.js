/* GET /api/docusign/ping — "is DocuSign actually wired up?"
 *
 * This is the endpoint to hit first after deploying. It authenticates, resolves the
 * account, and reports exactly which environment and account you landed in — so a
 * misconfigured DS_ENV or a sandbox key shows up here instead of halfway through a send.
 */

import { getSession } from "../../../worker-lib/docusign.js";
import { handler, json } from "../../../worker-lib/http.js";

export const onRequestGet = handler(async ({ request, env }) => {
  const origin = new URL(request.url).origin;
  const configured = ["DS_INTEGRATION_KEY", "DS_USER_ID", "DS_PRIVATE_KEY"].filter((k) => !!env[k]);

  const session = await getSession(env, origin);

  return json({
    ok: true,
    environment: String(env.DS_ENV || "").toLowerCase() === "demo" ? "demo (sandbox)" : "production",
    configured,
    user: { name: session.name, email: session.email },
    account: { id: session.accountId, name: session.accountName, baseUri: session.baseUri },
    tokenCache: env.TOKENS || env.DIRECTORY ? "enabled" : "off (no KV binding)",
  });
});
