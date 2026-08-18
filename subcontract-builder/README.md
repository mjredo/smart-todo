# Subcontract Builder — online

The subcontract agreement tool from `00 Subcontract Builder`, hosted, with DocuSign
send-for-signature wired in.

**→ To put it online, follow [DEPLOY.md](DEPLOY.md).**

## What changed from the folder version

| | Local folder | This |
|---|---|---|
| Opening it | `Start Subcontract Builder.cmd`, one PC | A URL, any device, behind a login |
| Vendor directory | `vendor_directory.json` on disk via a Node helper | Cloudflare KV, shared, 20 versions kept |
| Getting signatures | Save PDF → upload to DocuSign → tag by hand → send | One button |
| The insurance email | Copy/paste, or `mailto:` | Delivered by DocuSign with the contract |

Everything else — the 22 trade scope presets, milestone %↔$ maths, price-to-words, the
Word and print output, saved projects — is unchanged and behaves exactly as before.

## How the signing works

The browser builds the same `.docx` the **Download Word** button produces. The signature
block carries two anchor strings in white 1pt text — `/sn1/` next to the
subcontractor's *By:* line and `/cn1/` next to yours. They are invisible on screen and
in print.

That file is posted to `/api/docusign/send`, which authenticates to DocuSign with a
JWT grant, creates an envelope, and tells DocuSign to place the signature and date tabs
on those anchors. DocuSign converts the Word file to PDF, emails it to the
subcontractor with your section-8 text as the message, then routes it to you to
countersign.

No document ever passes through a third party — browser → your Cloudflare Worker →
DocuSign.

## Layout

```
public/
  index.html        the tool (unchanged except: DocuSign anchors, reusable .docx generator)
  scb-online.js     section 9 — send for signature, envelope status, health banner
  lib/              docx@8.5.0 + file-saver@2.0.5, byte-identical to the folder version
functions/
  _middleware.js            verifies the Cloudflare Access session on /api/*
  api/whoami.js             is this deployment protected / configured?
  api/directory.js          the shared vendor directory (KV), with versioned snapshots
  api/docusign/ping.js      connection check — run this first after deploying
  api/docusign/send.js      build and send the envelope
  api/docusign/status.js    who has signed
  api/docusign/consent.js   landing page for DocuSign's one-time consent redirect
worker-lib/
  docusign.js       JWT grant, RS256 via WebCrypto, token cache, account discovery
  access.js         Cloudflare Access token verification
  http.js           JSON responses and error shaping
```

`public/index.html` still works opened straight off disk — section 9 simply says there
is no server to talk to.

## Security notes

- **The vendor directory is not in this repo, deliberately.** It holds contact details,
  licence numbers and tax IDs. It lives in KV; `.gitignore` blocks it. Load it once
  through **Import backup** in the tool (DEPLOY.md step 3).
- **Nothing works safely without Cloudflare Access.** Until it is configured the tool
  shows a red banner on every page load. Do not ignore it — the directory and the
  ability to send contracts as you are both behind that URL.
- DocuSign credentials are Cloudflare encrypted environment variables. The private key
  never reaches the browser.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev        # http://127.0.0.1:8788
```

## What was verified

Run against a local Cloudflare runtime and a real headless browser:

- JWT grant signs correctly with a genuine RSA key in PKCS#1, PKCS#8 and
  escaped-newline forms, verified against the public key; the PKCS#1→PKCS#8
  conversion is exercised because that is the format DocuSign hands you.
- Envelope construction: anchors, routing order, CC de-duplication against signers,
  draft vs sent, and every validation path.
- Contract generation in Chromium: `/sn1/` and `/cn1/` each appear exactly once in the
  generated `.docx`, in white 1pt, with the contract body and price-to-words intact.
- Directory API: round-trip, versioned snapshots, and the guard that refuses to
  overwrite a populated directory with an empty one.

Not verified — it needs your DocuSign account: the live token exchange, consent, and a
real envelope. DEPLOY.md step 6 walks through it and the tool reports exactly what
fails.
