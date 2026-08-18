/* Subcontract Builder — online layer.
 *
 * Adds section 9: generate the contract, send it through DocuSign for signature, and
 * let DocuSign deliver the insurance/paperwork request as the envelope's message.
 *
 * Deliberately kept in its own file: index.html stays the same tool it always was and
 * still works opened straight off disk. Everything here degrades to a clear message
 * when the backend is not reachable.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var val = function (id) { return $(id) && $(id).value ? $(id).value.trim() : ""; };
  var LAST_KEY = "SCB_LAST_ENVELOPE";

  /* Only meaningful when served over http(s) — from a file:// page there is no API. */
  var SERVED = location.protocol === "http:" || location.protocol === "https:";

  /* ---------- markup ---------- */

  function card() {
    var el = document.createElement("div");
    el.className = "card";
    el.id = "dsCard";
    el.innerHTML = [
      '<h2>9 &middot; Send for signature (DocuSign)</h2>',
      '<p class="hint">Generates the same Word contract as the button above, sends it to the ',
      'subcontractor through DocuSign, and uses your section&nbsp;8 email as the message that ',
      'goes with it. DocuSign converts the document to PDF and places the signature and date ',
      'fields automatically.</p>',

      '<div id="dsConn" class="muted" style="margin:8px 0 14px">Checking the DocuSign connection…</div>',

      '<div class="grid">',
      '  <div><label>Signer name (subcontractor)</label><input type="text" id="dsSignerName" placeholder="the person who signs"></div>',
      '  <div><label>Signer email</label><input type="email" id="dsSignerEmail" placeholder="name@company.com"></div>',
      '  <div><label>Countersigner name (your side) <span class="muted">— optional</span></label><input type="text" id="dsCounterName"></div>',
      '  <div><label>Countersigner email <span class="muted">— signs second</span></label><input type="email" id="dsCounterEmail"></div>',
      '  <div><label>Copy to (comma-separated) <span class="muted">— optional</span></label><input type="text" id="dsCc" placeholder="you@example.com, office@example.com"></div>',
      '  <div><label>Email subject</label><input type="text" id="dsSubject"></div>',
      '</div>',

      '<p class="hint" style="margin-top:12px">The message below is your section&nbsp;8 draft. ',
      'Edit it there and press <b>Refresh from section 8</b>, or edit it here directly.</p>',
      '<textarea id="dsMessage" style="min-height:170px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px"></textarea>',

      '<div class="bar" style="margin-top:12px">',
      '  <button class="btn" id="dsSend">&#9993; Send for signature</button>',
      '  <button class="btn ghost sm" id="dsDraft" title="Create it in DocuSign but do not email it yet">Create as draft</button>',
      '  <button class="btn ghost sm" id="dsRefresh">&#8635; Refresh from section 8</button>',
      '  <button class="btn ghost sm" id="dsPing">Check DocuSign connection</button>',
      '</div>',

      '<div id="dsResult" style="margin-top:14px"></div>',
    ].join("");
    return el;
  }

  /* ---------- helpers ---------- */

  function note(html, kind) {
    var color = kind === "bad" ? "var(--bad)" : kind === "ok" ? "var(--ok)" : "var(--mut)";
    return '<div style="color:' + color + '">' + html + "</div>";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function busy(on, label) {
    var b = $("dsSend");
    if (!b) return;
    b.disabled = on;
    b.textContent = on ? label || "Working…" : "✉ Send for signature";
    $("dsDraft").disabled = on;
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result);
        resolve(s.slice(s.indexOf(",") + 1));
      };
      r.onerror = function () { reject(new Error("Could not read the generated document.")); };
      r.readAsDataURL(blob);
    });
  }

  async function api(path, init) {
    var res = await fetch(path, init);
    var body;
    try { body = await res.json(); } catch (e) { body = { error: "The server returned a non-JSON response (HTTP " + res.status + ")." }; }
    if (!res.ok || body.ok === false) {
      var err = new Error(body.error || "HTTP " + res.status);
      err.payload = body;
      throw err;
    }
    return body;
  }

  /* ---------- prefill ---------- */

  function defaultSubject() {
    var where = val("project") || val("site");
    var who = val("subcontractor");
    return ["Subcontract Agreement", where, who].filter(Boolean).join(" — ");
  }

  /* Fields keep following the form above until you type in them yourself — at which
     point they are yours and nothing overwrites them. "Refresh from section 8" clears
     that and re-derives everything. */
  var DIRTY = {};

  var TRACKED = ["dsSignerName", "dsSignerEmail", "dsCounterName", "dsCounterEmail", "dsSubject", "dsMessage"];

  function markDirty(e) {
    if (e && e.target && e.target.id) DIRTY[e.target.id] = true;
  }

  function prefill(force) {
    if (force) DIRTY = {};
    var set = function (id, v) {
      var el = $(id);
      if (!el || DIRTY[id]) return;
      // An empty derived value should not wipe something already on screen.
      if (v || force) el.value = v;
    };
    set("dsSignerName", val("sName") || val("subcontractor"));
    set("dsSignerEmail", val("sEmail"));
    set("dsCounterName", val("cName"));
    set("dsCounterEmail", val("cEmail"));
    set("dsSubject", defaultSubject());
    var body = $("emailBody");
    if (body && !DIRTY.dsMessage) $("dsMessage").value = body.value;
  }

  /* ---------- actions ---------- */

  async function checkConnection(loud) {
    var el = $("dsConn");
    el.innerHTML = "Checking the DocuSign connection…";
    el.style.color = "var(--mut)";
    try {
      var r = await api("/api/docusign/ping");
      el.style.color = "var(--ok)";
      el.innerHTML =
        "&#10003; Connected to DocuSign <b>" + esc(r.environment) + "</b> as " +
        esc(r.user.email) + " — account <b>" + esc(r.account.name) + "</b>.";
      return true;
    } catch (e) {
      el.style.color = "var(--bad)";
      var extra = "";
      if (e.payload && e.payload.consentUrl) {
        extra =
          ' <a href="' + esc(e.payload.consentUrl) + '" target="_blank" rel="noopener">' +
          "<b>Grant consent &rarr;</b></a>";
      }
      el.innerHTML = "&#9888; " + esc(e.message) + extra;
      if (loud) toast("DocuSign is not connected");
      return false;
    }
  }

  async function send(asDraft) {
    var signerEmail = val("dsSignerEmail");
    var signerName = val("dsSignerName");

    if (!signerEmail) { alert("Enter the subcontractor's email address."); $("dsSignerEmail").focus(); return; }
    if (!signerName) { alert("Enter the name of the person who will sign."); $("dsSignerName").focus(); return; }
    if (!val("dsSubject")) { alert("Enter an email subject."); $("dsSubject").focus(); return; }

    if (!asDraft) {
      var ok = confirm(
        "Send the contract to " + signerName + " <" + signerEmail + "> for signature now?\n\n" +
        "DocuSign will email them the agreement together with your message."
      );
      if (!ok) return;
    }

    busy(true, asDraft ? "Creating draft…" : "Generating contract…");
    $("dsResult").innerHTML = "";

    try {
      var doc = await genDocx(true); // { blob, name } — the same file "Download Word" makes
      busy(true, asDraft ? "Creating draft…" : "Sending to DocuSign…");
      var b64 = await blobToBase64(doc.blob);

      var cc = val("dsCc")
        .split(",")
        .map(function (s) { return s.trim(); })
        .filter(Boolean)
        .map(function (e) { return { email: e, name: e }; });

      var counter = null;
      if (val("dsCounterEmail") && val("dsCounterName")) {
        counter = { email: val("dsCounterEmail"), name: val("dsCounterName") };
      }

      var r = await api("/api/docusign/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentBase64: b64,
          documentName: doc.name,
          subject: val("dsSubject"),
          message: $("dsMessage").value,
          signer: { name: signerName, email: signerEmail },
          countersigner: counter,
          cc: cc,
          draft: !!asDraft,
        }),
      });

      try { localStorage.setItem(LAST_KEY, r.envelopeId); } catch (e) { /* private mode */ }

      $("dsResult").innerHTML =
        note(
          "<b>" + (asDraft ? "Draft created" : "Sent.") + "</b> Envelope <code>" +
            esc(r.envelopeId) + "</code>" +
            (r.sentTo.length ? " &rarr; " + esc(r.sentTo.join(", ")) : "") +
            (r.copiedTo.length ? " (cc " + esc(r.copiedTo.join(", ")) + ")" : "") +
            (r.manageUrl
              ? ' &middot; <a href="' + esc(r.manageUrl) + '" target="_blank" rel="noopener">open in DocuSign</a>'
              : ""),
          "ok"
        ) +
        '<div class="bar" style="margin-top:10px"><button class="btn ghost sm" id="dsStatus">Check status</button></div>' +
        '<div id="dsStatusOut" class="muted" style="margin-top:8px"></div>';

      $("dsStatus").onclick = function () { checkStatus(r.envelopeId); };
      toast(asDraft ? "Draft created in DocuSign" : "Contract sent for signature");
    } catch (e) {
      var extra = "";
      if (e.payload && e.payload.consentUrl) {
        extra =
          '<div style="margin-top:6px"><a href="' + esc(e.payload.consentUrl) +
          '" target="_blank" rel="noopener"><b>Grant DocuSign consent &rarr;</b></a></div>';
      }
      $("dsResult").innerHTML = note("<b>Not sent.</b> " + esc(e.message), "bad") + extra;
    } finally {
      busy(false);
    }
  }

  async function checkStatus(id) {
    var out = $("dsStatusOut");
    if (!out) return;
    out.textContent = "Checking…";
    try {
      var r = await api("/api/docusign/status?envelopeId=" + encodeURIComponent(id));
      out.innerHTML =
        "Envelope is <b>" + esc(r.status) + "</b>." +
        "<ul style='margin:6px 0 0 18px'>" +
        r.recipients
          .map(function (p) {
            return "<li>" + esc(p.name) + " &lt;" + esc(p.email) + "&gt; — " +
              esc(p.role) + ", <b>" + esc(p.status) + "</b>" +
              (p.signedDateTime ? " on " + esc(new Date(p.signedDateTime).toLocaleString()) : "") +
              "</li>";
          })
          .join("") +
        "</ul>";
    } catch (e) {
      out.innerHTML = note(esc(e.message), "bad");
    }
  }

  /* ---------- deployment health banner ---------- */

  async function healthBanner() {
    try {
      var r = await api("/api/whoami");
      if (!r.protected) {
        var w = document.createElement("div");
        w.className = "card";
        w.style.borderColor = "#c2410c";
        w.innerHTML =
          '<b style="color:#c2410c">This deployment is not access-protected.</b> Anyone who ' +
          "finds the URL can read your whole vendor directory — names, phones, licence and tax " +
          "numbers — and send contracts as you. Put a Cloudflare Access policy in front of it " +
          "before you use it for real. See <code>DEPLOY.md</code>, step 4.";
        var wrap = document.querySelector(".wrap");
        if (wrap) wrap.insertBefore(w, wrap.firstChild);
      }
    } catch (e) {
      /* Offline or opened from disk — the DocuSign card already says so. */
    }
  }

  /* ---------- wire up ---------- */

  function init() {
    var wrap = document.querySelector(".wrap");
    if (!wrap) return;

    var el = card();
    wrap.appendChild(el);

    if (!SERVED) {
      $("dsConn").style.color = "var(--bad)";
      $("dsConn").innerHTML =
        "&#9888; This page was opened straight from a file, so there is no server to talk to. " +
        "Open the hosted address instead to send through DocuSign.";
      $("dsSend").disabled = true;
      $("dsDraft").disabled = true;
      prefill(true);
      return;
    }

    prefill(true);

    $("dsSend").onclick = function () { send(false); };
    $("dsDraft").onclick = function () { send(true); };
    $("dsPing").onclick = function () { checkConnection(true); };
    $("dsRefresh").onclick = function () {
      prefill(true);
      toast("Refreshed from the fields above");
    };

    // Typing in a section-9 field takes it out of auto-fill.
    TRACKED.forEach(function (id) {
      var f = $(id);
      if (f) f.addEventListener("input", markDirty);
    });

    // Keep the untouched section-9 fields in step with the form above. The section-8
    // email rebuilds on a debounce, so re-derive just after it settles too.
    ["subcontractor", "sName", "sEmail", "project", "site", "cName", "cEmail"].forEach(function (id) {
      var f = $(id);
      if (f) {
        f.addEventListener("input", function () {
          prefill(false);
          setTimeout(function () { prefill(false); }, 120);
        });
      }
    });

    checkConnection(false);
    healthBanner();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
