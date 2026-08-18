/* /api/directory — the shared vendor directory, hosted.
 *
 * This replaces the local scb-server.js helper: instead of reading and writing
 * vendor_directory.json on one PC, the directory lives in a Cloudflare KV namespace,
 * so every machine and phone that opens the tool sees the same list.
 *
 * Requires a KV namespace bound to the Pages project as  DIRECTORY.
 *
 *   GET  /api/directory          -> { subs, entities, updatedAt }
 *   PUT  /api/directory          -> save { subs, entities }
 *   GET  /api/directory?backups  -> list the retained snapshots
 *   GET  /api/directory?restore=<key> -> restore one snapshot
 */

import { json, fail, readJson } from "../../worker-lib/http.js";

const KEY = "directory";
const BACKUP_PREFIX = "backup:";
const KEEP_BACKUPS = 20;

function store(env) {
  if (!env.DIRECTORY) {
    throw new Error(
      "No KV namespace is bound to this project as DIRECTORY. Create one in the Cloudflare " +
        "dashboard (Workers & Pages → KV), then bind it to this Pages project under " +
        "Settings → Bindings with the variable name DIRECTORY."
    );
  }
  return env.DIRECTORY;
}

export async function onRequestGet({ request, env }) {
  try {
    const kv = store(env);
    const url = new URL(request.url);

    if (url.searchParams.has("backups")) {
      const list = await kv.list({ prefix: BACKUP_PREFIX });
      return json({
        ok: true,
        backups: list.keys
          .map((k) => ({ key: k.name, at: k.name.slice(BACKUP_PREFIX.length) }))
          .sort((a, b) => b.at.localeCompare(a.at)),
      });
    }

    const restore = url.searchParams.get("restore");
    if (restore) {
      if (!restore.startsWith(BACKUP_PREFIX)) return fail("Not a backup key.");
      const snap = await kv.get(restore, "json");
      if (!snap) return fail("That snapshot no longer exists.", 404);
      await kv.put(KEY, JSON.stringify(snap));
      return json({ ok: true, restored: restore, subs: snap.subs, entities: snap.entities });
    }

    const data = await kv.get(KEY, "json");
    if (!data) {
      // Fresh store. The page seeds it from vendor_directory.json (or an Import backup)
      // the first time it loads, and immediately saves the result back here.
      return json({ subs: [], entities: [], _empty: true });
    }
    return json(data);
  } catch (err) {
    return fail(err.message, 503);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const kv = store(env);
    const body = await readJson(request);

    if (!Array.isArray(body.subs) || !Array.isArray(body.entities)) {
      return fail("Expected a JSON body shaped { subs: [...], entities: [...] }.");
    }
    // Same guard the local helper had: never let a blank page wipe the real directory.
    if (!body.subs.length && !body.entities.length) {
      const existing = await kv.get(KEY, "json");
      if (existing && (existing.subs?.length || existing.entities?.length)) {
        return fail(
          "Refusing to overwrite the directory with an empty one. If you really mean to " +
            "clear it, delete the entries individually.",
          409
        );
      }
    }

    const previous = await kv.get(KEY, "json");
    const record = {
      subs: body.subs,
      entities: body.entities,
      updatedAt: new Date().toISOString(),
    };
    await kv.put(KEY, JSON.stringify(record));

    // Snapshot the version we just replaced, and prune old ones.
    if (previous) {
      const stamp = (previous.updatedAt || new Date().toISOString()).replace(/[:.]/g, "-");
      await kv.put(BACKUP_PREFIX + stamp, JSON.stringify(previous), {
        expirationTtl: 60 * 60 * 24 * 180, // six months
      });
      const list = await kv.list({ prefix: BACKUP_PREFIX });
      const stale = list.keys
        .map((k) => k.name)
        .sort()
        .slice(0, Math.max(0, list.keys.length - KEEP_BACKUPS));
      await Promise.all(stale.map((k) => kv.delete(k)));
    }

    return json({
      ok: true,
      updatedAt: record.updatedAt,
      counts: { subs: record.subs.length, entities: record.entities.length },
    });
  } catch (err) {
    return fail(err.message, 503);
  }
}
