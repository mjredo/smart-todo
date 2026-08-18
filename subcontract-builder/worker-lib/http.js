/* Shared response helpers. Errors come back as JSON with a human-readable `error`
 * so the browser can show the real reason instead of a bare status code. */

import { DocuSignError } from "./docusign.js";

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function fail(error, status = 400, extra = {}) {
  return json({ ok: false, error, ...extra }, status);
}

/* Wraps a handler so a thrown DocuSignError becomes a useful JSON response
 * rather than a Cloudflare 500 page with nothing in it. */
export function handler(fn) {
  return async (context) => {
    try {
      return await fn(context);
    } catch (err) {
      if (err instanceof DocuSignError) {
        return json(
          {
            ok: false,
            error: err.message,
            ...(err.consent ? { consentUrl: err.consent } : {}),
            ...(err.detail ? { detail: err.detail } : {}),
          },
          err.status
        );
      }
      return json({ ok: false, error: err.message || String(err) }, 500);
    }
  };
}

export async function readJson(request, limitBytes = 25 * 1024 * 1024) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > limitBytes) {
    throw new Error(
      `That request is ${(len / 1048576).toFixed(1)} MB, over the ${limitBytes / 1048576} MB limit.`
    );
  }
  try {
    return await request.json();
  } catch {
    throw new Error("The request body was not valid JSON.");
  }
}
