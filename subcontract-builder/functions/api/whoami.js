/* GET /api/whoami — who is signed in, and is this deployment actually protected?
 * The page shows a red banner when `protected` is false, so an unguarded deployment
 * cannot sit there quietly with the whole vendor directory on it. */

import { accessEnabled } from "../../worker-lib/access.js";
import { json } from "../../worker-lib/http.js";

export const onRequestGet = ({ env, data }) =>
  json({
    ok: true,
    protected: accessEnabled(env),
    email: data?.identity?.email || null,
    docusignConfigured: Boolean(env.DS_INTEGRATION_KEY && env.DS_USER_ID && env.DS_PRIVATE_KEY),
    directoryBound: Boolean(env.DIRECTORY),
  });
