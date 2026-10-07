/* Smart To Do — reminder push server (Cloudflare Worker)
 *
 * Microsoft To Do stays the source of truth. Every minute a cron tick reads the
 * signed-in user's upcoming reminders from Graph (app-only, cached in KV for a few
 * minutes) and sends a Web Push to every device that switched reminders on in
 * Smart To Do. The app's service worker shows the notification, and its Done /
 * Snooze buttons call back here, so they work without opening the app.
 *
 * KV keys
 *   subs                 {userId: [{endpoint, keys, expirationTime, ua, addedAt}]}
 *   sched:<userId>       {at, items:[{id, listId, title, list, due}]}   due = epoch ms
 *   fired:<userId>       {"<taskId>|<due>": firedAtMs}
 */
import { buildPushPayload } from "@block65/webcrypto-web-push";

const GRAPH = "https://graph.microsoft.com/v1.0";
const REFRESH_MS = 5 * 60_000;      // re-read To Do this often even if nobody pings /refresh
const LOOKAHEAD_MS = 48 * 3600_000; // keep reminders due in the next two days
const GRACE_MS = 30 * 60_000;       // a reminder up to this late still fires (missed ticks, slow refresh)
const SNOOZE_MIN = { snooze: 15, snooze60: 60 };

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      const r = await route(url.pathname, req, env, ctx);
      for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
      return r;
    } catch (e) {
      console.error(url.pathname, e.stack || e);
      return json({ error: String(e.message || e) }, e.status || 500, cors);
    }
  },
  async scheduled(_ev, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};

async function route(path, req, env, ctx) {
  if (path === "/" || path === "/health") return json({ ok: true, vapid: env.VAPID_PUBLIC_KEY });
  if (path === "/vapid") return json({ key: env.VAPID_PUBLIC_KEY });
  if (req.method !== "POST") return json({ error: "not found" }, 404);
  const body = await req.json().catch(() => ({}));

  if (path === "/action") return action(body, env);          // signed per-task token, no user token needed

  const user = await callerFromGraphToken(req, env);           // everything else: the app's own Graph token
  if (path === "/subscribe") {
    const s = body.subscription;
    if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: "bad subscription" }, 400);
    if (!/^https:\/\//.test(s.endpoint)) return json({ error: "endpoint must be https" }, 400);
    const subs = await getJSON(env, "subs", {});
    const mine = (subs[user] || []).filter((x) => x.endpoint !== s.endpoint);
    mine.push({ endpoint: s.endpoint, keys: s.keys, expirationTime: s.expirationTime ?? null, ua: String(body.ua || "").slice(0, 120), addedAt: Date.now() });
    subs[user] = mine.slice(-10);
    await env.STATE.put("subs", JSON.stringify(subs));
    ctx.waitUntil(refresh(env, user).catch((e) => console.error("refresh", e)));
    return json({ ok: true, devices: subs[user].length });
  }
  if (path === "/unsubscribe") {
    const subs = await getJSON(env, "subs", {});
    subs[user] = (subs[user] || []).filter((x) => x.endpoint !== body.endpoint);
    if (!subs[user].length) delete subs[user];
    await env.STATE.put("subs", JSON.stringify(subs));
    return json({ ok: true });
  }
  if (path === "/refresh") {
    if (!((await getJSON(env, "subs", {}))[user] || []).length) return json({ ok: true, skipped: "no devices" });
    const s = await refresh(env, user);
    return json({ ok: true, upcoming: s.items.length });
  }
  if (path === "/status") {
    const [subs, s] = await Promise.all([getJSON(env, "subs", {}), getJSON(env, "sched:" + user, null)]);
    const now = Date.now();
    return json({
      devices: (subs[user] || []).map((x) => ({ ua: x.ua, addedAt: x.addedAt, mine: x.endpoint === body.endpoint })),
      refreshedAt: s && s.at,
      upcoming: s ? s.items.filter((i) => i.due >= now).sort((a, b) => a.due - b.due).slice(0, 10).map((i) => ({ title: i.title, due: i.due })) : [],
    });
  }
  if (path === "/test") {
    const subs = (await getJSON(env, "subs", {}))[user] || [];
    const target = body.endpoint ? subs.filter((x) => x.endpoint === body.endpoint) : subs;
    if (!target.length) return json({ error: "this device isn't subscribed" }, 404);
    const sent = await pushAll(env, user, target, {
      title: "Smart To Do reminders are on",
      body: "This is a test. Reminders from your To Do lists will show up like this.",
      tag: "test",
    });
    return json({ ok: true, sent });
  }
  return json({ error: "not found" }, 404);
}

/* ---------------- cron ---------------- */
async function tick(env) {
  const subs = await getJSON(env, "subs", {});
  for (const user of Object.keys(subs)) {
    try { await fireDue(env, user, subs); }
    catch (e) { console.error("tick", user, e.stack || e); }
  }
}

async function fireDue(env, user, subs) {
  let s = await getJSON(env, "sched:" + user, null);
  const age = Date.now() - Math.max(s ? s.at : 0, _fresh[user] || 0);
  if (!s || age > REFRESH_MS) s = await refresh(env, user);
  const now = Date.now();
  const due = s.items.filter((i) => i.due <= now + 20_000 && i.due > now - GRACE_MS);
  if (!due.length) return;
  const fired = await getJSON(env, "fired:" + user, {});
  const fresh = due.filter((i) => !fired[i.id + "|" + i.due]);
  if (!fresh.length) return;
  for (const i of fresh) {
    await pushAll(env, user, subs[user] || [], {
      title: i.title,
      body: i.list ? "⏰ Reminder · " + i.list : "⏰ Reminder",
      tag: "task-" + i.id,
      taskId: i.id,
      listId: i.listId,
      tok: await sign(env, user + "|" + i.listId + "|" + i.id),
      user,
    });
    fired[i.id + "|" + i.due] = now;
  }
  for (const k of Object.keys(fired)) if (now - fired[k] > 3 * 86400_000) delete fired[k];
  await env.STATE.put("fired:" + user, JSON.stringify(fired));
}

/* Read every open task with a reminder from To Do. Lists are fetched in parallel;
   the free Workers plan allows 50 subrequests per run, which is far above the
   handful of pages a normal set of lists needs. */
async function refresh(env, user) {
  const token = await appToken(env);
  const base = `${GRAPH}/users/${encodeURIComponent(user)}/todo/lists`;
  const lists = await pageAll(token, base);
  const now = Date.now();
  const items = [];
  await Promise.all(lists.map(async (L) => {
    let tasks;
    try {
      tasks = await pageAll(token, `${base}/${L.id}/tasks?$filter=status ne 'completed'&$top=100`);
    } catch (e) {
      if (e.status !== 400) throw e;   // some tenants reject the filter — fall back to reading everything
      tasks = (await pageAll(token, `${base}/${L.id}/tasks?$top=100`)).filter((t) => t.status !== "completed");
    }
    for (const t of tasks) {
      if (!t.isReminderOn || !t.reminderDateTime) continue;
      const due = graphMs(t.reminderDateTime);
      if (due == null || due < now - GRACE_MS || due > now + LOOKAHEAD_MS) continue;
      items.push({ id: t.id, listId: L.id, title: t.title || "(untitled task)", list: L.displayName, due });
    }
  }));
  items.sort((a, b) => a.due - b.due || (a.id < b.id ? -1 : 1));
  const s = { at: now, items };
  /* KV's free tier allows 1,000 writes a day. Only write when the reminders changed;
     an unchanged schedule's age is tracked in memory, falling back to a re-read. */
  const prev = await getJSON(env, "sched:" + user, null);
  if (!prev || JSON.stringify(prev.items) !== JSON.stringify(items) || now - prev.at > 60 * 60_000) {
    await env.STATE.put("sched:" + user, JSON.stringify(s));
  }
  _fresh[user] = now;
  return s;
}

/* ---------------- notification buttons ---------------- */
async function action(body, env) {
  const { user, listId, taskId, tok } = body;
  if (!user || !listId || !taskId || !tok) return json({ error: "missing fields" }, 400);
  if (tok !== (await sign(env, user + "|" + listId + "|" + taskId))) return json({ error: "bad token" }, 403);
  const token = await appToken(env);
  const url = `${GRAPH}/users/${encodeURIComponent(user)}/todo/lists/${listId}/tasks/${taskId}`;
  let patch;
  if (body.action === "done") patch = { status: "completed" };
  else if (SNOOZE_MIN[body.action]) {
    const at = new Date(Date.now() + SNOOZE_MIN[body.action] * 60_000);
    patch = { isReminderOn: true, reminderDateTime: { dateTime: at.toISOString().replace("Z", ""), timeZone: "UTC" } };
  } else return json({ error: "unknown action" }, 400);
  await graph(token, url, { method: "PATCH", body: JSON.stringify(patch) });
  await refresh(env, user);   // so a snooze fires on time and a done task never re-fires
  return json({ ok: true });
}

/* ---------------- web push ---------------- */
async function pushAll(env, user, targets, data) {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  data.api = env.PUBLIC_URL;   // the service worker posts Done / Snooze back here
  const gone = [];
  let sent = 0;
  await Promise.all(targets.map(async (sub) => {
    try {
      const payload = await buildPushPayload({ data, options: { ttl: 3600, urgency: "high", topic: (data.tag || "t").replace(/[^A-Za-z0-9_-]/g, "").slice(-32) } }, sub, vapid);
      const r = await fetch(sub.endpoint, payload);
      if (r.status === 404 || r.status === 410) gone.push(sub.endpoint);
      else if (r.ok) sent++;
      else console.warn("push", r.status, await r.text().catch(() => ""));
    } catch (e) { console.error("push error", e.stack || e); }
  }));
  if (gone.length) {                                  // device uninstalled the app or revoked permission
    const subs = await getJSON(env, "subs", {});
    subs[user] = (subs[user] || []).filter((x) => !gone.includes(x.endpoint));
    if (!subs[user].length) delete subs[user];
    await env.STATE.put("subs", JSON.stringify(subs));
  }
  return sent;
}

/* ---------------- Graph ---------------- */
const _fresh = {};   // userId → last refresh in this isolate (the KV copy is only rewritten on change)
let _tok = null;   // isolate-local cache; app tokens live ~60 min
async function appToken(env) {
  if (_tok && _tok.exp > Date.now() + 120_000) return _tok.value;
  const r = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: String(env.CLIENT_SECRET || "").trim(),   // a pasted secret can carry a stray space or newline
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw httpErr(502, "token: " + (j.error_description || j.error || r.status));
  _tok = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return _tok.value;
}

async function graph(token, url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: 'outlook.timezone="UTC"', ...(opts.headers || {}) },
  });
  if (!r.ok) throw httpErr(r.status, "Graph " + r.status + " " + url.replace(/^https:\/\/[^/]+/, "").replace(/users\/[^/]+/, "users/…") + ": " + (await r.text().catch(() => "")).slice(0, 200));
  return r.status === 204 ? null : r.json();
}

async function pageAll(token, url) {
  const out = [];
  while (url) {
    const j = await graph(token, url);
    out.push(...(j.value || []));
    url = j["@odata.nextLink"];
  }
  return out;
}

/* The app sends the Graph token MSAL already holds for it. Graph itself vouches
   for it (/me), and the tenant claim keeps anyone outside the organisation out. */
async function callerFromGraphToken(req, env) {
  const auth = req.headers.get("authorization") || "";
  const t = auth.replace(/^Bearer\s+/i, "");
  if (!t) throw httpErr(401, "sign-in required");
  const r = await fetch(GRAPH + "/me?$select=id", { headers: { Authorization: "Bearer " + t } });
  if (!r.ok) throw httpErr(401, "sign-in rejected");
  const me = await r.json();
  let tid = "";
  try { tid = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).tid; } catch (_) {}
  if (tid !== env.TENANT_ID) throw httpErr(403, "wrong organisation");
  return me.id;
}

/* ---------------- helpers ---------------- */
function graphMs(dtz) {   // Prefer: outlook.timezone="UTC" makes Graph return UTC wall-clock
  const m = String(dtz.dateTime || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  if (dtz.timeZone && !/^(UTC|Etc\/UTC|GMT|Coordinated Universal Time)$/i.test(dtz.timeZone)) console.warn("non-UTC reminder zone", dtz.timeZone);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

async function sign(env, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ACTION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getJSON(env, key, dflt) {
  const v = await env.STATE.get(key);
  if (!v) return dflt;
  try { return JSON.parse(v); } catch (_) { return dflt; }
}

function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" } : { Vary: "Origin" };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
}
function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
