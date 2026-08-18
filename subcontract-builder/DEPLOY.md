# Getting it online — start to finish

Six steps. Steps 1–4 get the tool on the web, privately. Steps 5–6 turn on DocuSign.
Do them in order; each one is testable on its own, so you always know where you are.

Everything here is on free tiers except DocuSign, which you already pay for.

---

## Step 1 — Put the code on GitHub

The code is written and committed, but it needs a repository of its own — the
integration I run under is allowed to push to repositories, not to create them, so
this one step is yours.

1. Go to <https://github.com/new>.
2. **Repository name:** `subcontract-builder`
3. **Private.** The contract language and the deployment guide should not be public.
4. Do **not** tick "Add a README" — the repository must start empty.
5. **Create repository.**

Then tell me it exists and I will push everything to it. Or do it yourself — the
finished code is on the `claude/subcontract-builder-online-yliiey` branch of
`mjredo/smart-todo`, under `subcontract-builder/`:

```bash
git clone -b claude/subcontract-builder-online-yliiey https://github.com/mjredo/smart-todo tmp
cd tmp/subcontract-builder
git init -b main && git add -A && git commit -m "Subcontract Builder online"
git remote add origin https://github.com/mjredo/subcontract-builder
git push -u origin main
```

Cloudflare then builds from that repository and redeploys on every push.

---

## Step 2 — Create the Cloudflare Pages project

1. Sign in at <https://dash.cloudflare.com> → **Workers & Pages** → **Create** →
   **Pages** → **Connect to Git**.
2. Pick this repository. Then set:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
3. **Save and Deploy.**

You get a URL like `https://subcontract-builder.pages.dev`. Open it — the tool loads
and works, but with a red warning banner at the top and a red DocuSign line. Both are
expected until steps 4 and 6.

---

## Step 3 — Create the vendor directory store

The directory (your 45 subs and the project LLCs) needs somewhere to live so every
device sees the same list.

1. **Workers & Pages** → **KV** → **Create a namespace**. Name it `subcontract-directory`.
2. Back in the Pages project → **Settings** → **Bindings** → **Add** → **KV namespace**:
   - **Variable name:** `DIRECTORY`  ← must be exactly this
   - **KV namespace:** `subcontract-directory`
3. **Deployments** → **Retry deployment** on the latest one, so it picks up the binding.

**Load your vendors in, once.** Open the site, go to the **Directory** card, click
**Import backup**, and choose `vendor_directory.json` from
`00 Subcontract Builder` in OneDrive. The status line turns green and says it saved to
the shared directory. That is the last time you ever import it — from here the tool
reads and writes the hosted copy, and your phone, laptop and office PC all see the
same list.

> The directory keeps the last 20 versions automatically. `GET /api/directory?backups`
> lists them; `GET /api/directory?restore=<key>` rolls one back.

---

## Step 4 — Lock it down (do not skip this)

Right now anyone who guesses the URL can read every subcontractor's phone, licence
number and tax ID, and send contracts as you. Cloudflare Access fixes that, free, for
up to 50 users.

1. **Zero Trust** (left sidebar) → set up a team domain if you have not before; you
   will pick a name like `mjproperty`, giving you `mjproperty.cloudflareaccess.com`.
2. **Access** → **Applications** → **Add an application** → **Self-hosted**.
   - **Application name:** Subcontract Builder
   - **Session duration:** 24 hours (or a week — your call)
   - **Public hostname:** your `*.pages.dev` domain, or a custom domain if you add one
3. Add a policy:
   - **Policy name:** Me
   - **Action:** Allow
   - **Include** → **Emails** → `mj@mjconnect.info` (add anyone else who should get in)
4. Save.

Now the site asks for a one-time email code before it opens. **Reload the tool — the
red "not access-protected" banner should be gone.**

**Optional hardening.** The banner disappears once Access is on, but the API itself
only re-verifies the login if you tell it the application's identity. On the Access
application page, copy the **Application Audience (AUD) Tag**, then in the Pages
project → **Settings** → **Environment variables** add:

| Name | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `mjproperty.cloudflareaccess.com` |
| `ACCESS_AUD` | the AUD tag you copied |

---

## Step 5 — Check what your DocuSign plan allows

This is the one thing I could not determine for you. You need an **Integration Key**
with **JWT Grant** — available on DocuSign's Business Pro and above, and on any
developer account.

1. Sign in to DocuSign → **Settings** → **Integrations** → **Apps and Keys**.
2. If you can see that page and **Add App and Integration Key** is clickable, you have
   what you need. Skip to step 6.
3. If the page is missing or the button is greyed out, your plan does not include API
   access. Two options:
   - Ask DocuSign support to add API access to your plan, or
   - Create a **free developer account** at <https://developers.docusign.com>, do
     everything in step 6 there, and set `DS_ENV = demo`. Envelopes will carry a
     "demo" watermark and are not legally binding, but the whole flow works end to
     end and switching to production later is one variable change.

---

## Step 6 — Connect DocuSign

On the **Apps and Keys** page:

1. **Add App and Integration Key.** Name it `Subcontract Builder`.
2. Copy the **Integration Key** (a GUID).
3. Under **Authentication**, pick **Authorization Code Grant / JWT** (not Implicit).
4. **Service Integration** → **Generate RSA** → copy the **private key**, the whole
   thing including the `-----BEGIN RSA PRIVATE KEY-----` and `-----END-----` lines.
   DocuSign shows it once. Save it somewhere safe now.
5. **Redirect URIs** → add exactly:
   `https://<your-site>/api/docusign/consent`
6. At the top of the same page, copy your **API Username** — a GUID, *not* your email
   address. (Also under **Settings → Users →** your user → **API Username**.)

Then in the Pages project → **Settings** → **Environment variables** → **Production**,
add these and mark each **Encrypted**:

| Name | Value |
|---|---|
| `DS_INTEGRATION_KEY` | the Integration Key GUID |
| `DS_USER_ID` | the API Username GUID |
| `DS_PRIVATE_KEY` | the full RSA private key, BEGIN/END lines included |
| `DS_ENV` | `production`, or `demo` for a developer account |

Redeploy (**Deployments** → **Retry deployment**).

### Grant consent — the step everyone misses

JWT impersonation needs one human approval before it will ever work.

Open the tool and press **Check DocuSign connection** in section 9. The first time it
will fail with a **Grant consent →** link. Click it, sign in as the API user, click
**Accept**. You land on a "Consent granted" page.

Press **Check DocuSign connection** again. It should turn green:

> ✓ Connected to DocuSign **production** as mj@mjconnect.info — account **MJ Property Investments**.

That is it. You are live.

---

## Using it

1. Open the site, sign in through Access.
2. Fill in the contract as you always have — entity, sub, trade scope, price, milestones.
3. Scroll to **9 · Send for signature**. The signer, countersigner, subject and message
   are already filled in from the form. Edit anything you like.
4. **Send for signature.**

DocuSign emails the subcontractor the agreement with your insurance/paperwork request
as the message, places the signature and date fields automatically, and routes it to
you to countersign afterwards. **Check status** tells you who has signed without
opening DocuSign.

Use **Create as draft** for the first one or two: the envelope is built in DocuSign but
not emailed, so you can look it over before anyone sees it.

---

## When something goes wrong

The tool reports the actual reason rather than a status code. The common ones:

| Message | What it means |
|---|---|
| *consent_required* / a **Grant consent** link | The one-time approval above has not been done, or was done against the wrong environment. |
| *invalid_grant* | Usually `DS_USER_ID` is your email instead of the API Username GUID. Also check the RSA key matches this Integration Key, and that `DS_ENV` matches where the key lives. |
| *missing DS_…* | The environment variable is not set, or was added to Preview instead of Production. |
| *No KV namespace is bound … as DIRECTORY* | Step 3's binding is missing, or the deployment predates it — retry the deployment. |
| *Not signed in* | Access is on and the API was called without a session. Reload the page. |
| *anchorString not found* | The contract was generated by an older copy of `index.html` without the signature anchors. Reload with a hard refresh (Ctrl-F5). |

To see everything at once: `https://<your-site>/api/whoami` reports whether the site is
protected, whether DocuSign is configured, and whether the directory is bound.

---

## Running it locally

```bash
npm install
cp .dev.vars.example .dev.vars     # then put your real DocuSign values in it
npm run dev                        # http://127.0.0.1:8788
```

`.dev.vars` is gitignored. Never commit a private key.
