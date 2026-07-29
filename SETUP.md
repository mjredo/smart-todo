# Smart To Do — universal setup

This makes the dashboard reachable from **any device** — PC, phone, tablet —
at one web address, installable as an app, with your saved smart lists synced
across devices through your own OneDrive.

Three one-time parts, ~15 minutes total:

- **Part A** – Publish the app to a free GitHub Pages URL.
- **Part B** – Register it in your Microsoft tenant so it may read/write your To Do.
- **Part C** – Install it on your phone and PC.

Everything runs in your browser and your Microsoft account. No server holds your data.

---

## Part A — Publish to GitHub Pages

1. Create a free account at **https://github.com** (skip if you have one).
2. Click **＋ (top-right) → New repository**.
   - **Repository name:** `smart-todo`
   - **Public** (required for free Pages)
   - Click **Create repository**.
3. On the new repo page: **“uploading an existing file”** link (or **Add file → Upload files**).
4. Open this folder in File Explorer:
   `C:\Users\prome\Documents\Scripts\SmartTodo`
   Select **all files** — `index.html`, `config.js`, `manifest.webmanifest`, `sw.js`,
   `msal-browser.min.js`, and the four `icon-*.png` files — and drag them into the browser.
   (You can skip `launch.bat` and `SETUP.md`; they don't need to be online.)
5. Click **Commit changes**.
6. Go to the repo's **Settings → Pages** (left menu).
   - **Source:** *Deploy from a branch*
   - **Branch:** `main`, folder `/ (root)` → **Save**.
7. Wait ~1 minute, refresh. Pages shows your live URL, which will be:

   ```
   https://<your-github-username>.github.io/smart-todo/
   ```

   **Copy that URL** — you need it in Part B. (Note the trailing slash.)

## Part B — Register the app in Entra (authorize To Do access)

You're admin of `MJPropertyInvestmentsLLC.onmicrosoft.com`, so you can do all of this.

1. Go to **https://entra.microsoft.com**, sign in as
   `mnarang@MJPropertyInvestmentsLLC.onmicrosoft.com`.
2. **Identity → Applications → App registrations → ＋ New registration**.
3. **Name:** `Smart To Do`.
   **Supported account types:** *Accounts in this organizational directory only (Single tenant)*.
   **Redirect URI:** dropdown → **Single-page application (SPA)**, and paste your Pages URL:

   ```
   https://<your-github-username>.github.io/smart-todo/
   ```
   Click **Register**.
4. (Optional, for testing on this PC too) **Authentication → Add a platform → SPA →**
   add `http://localhost:8400/index.html` → **Configure**. Then you can also use `launch.bat` locally.
5. **API permissions → ＋ Add a permission → Microsoft Graph → Delegated permissions.**
   Tick **`Tasks.ReadWrite`** and **`Files.ReadWrite.AppFolder`**, then **Add permissions**.
   (`User.Read` is already present.)
6. Click **✔ Grant admin consent for MJ Property Investments LLC → Yes.**
   All three should show green “Granted”.
7. On the app's **Overview** page copy the **Application (client) ID** and **Directory (tenant) ID**.

### Put the IDs into config.js — then re-upload it

- Edit `config.js` in this folder, paste the two IDs:
  ```js
  clientId: "your Application (client) ID",
  tenantId: "your Directory (tenant) ID",
  ```
  Leave `redirectUri` blank (the app detects its own address automatically).
- Save, then in the GitHub repo do **Add file → Upload files**, drop the updated
  `config.js`, **Commit**. (Any time you change a file, re-upload it the same way.)

## Part C — Install on your devices

Open your Pages URL and click **Sign in with Microsoft** (approve once). Your lists load.

- **Phone (Android/Chrome):** open the URL → menu **⋮ → Add to Home screen / Install app**.
- **iPhone (Safari):** open the URL → **Share → Add to Home Screen**.
- **PC (Edge/Chrome):** open the URL → the **Install** icon in the address bar (or menu → *Install Smart To Do*).

It now launches from an app icon, full screen, like a native app.

---

## Using it

- **Compound filter:** click list chips + a Due window + #hashtag chips + Open/Completed + Search.
  All combine with **AND** (e.g. *627* + *Due today* + *#bills*). The hashtag group toggles
  between "match **all**" and "match **any**".
- **Save a smart list:** build a filter → **＋ Save as smart list** → name it. It becomes a
  sidebar button, saved to your OneDrive, so it appears on every device.
- **Quick-add with list picker:** top box — type the task, **pick the list from the dropdown**,
  optional due date, Enter. `#tags` you type become real To Do hashtags.
- **Complete:** tick the checkbox — writes straight back to To Do.
- **↻** re-pulls from To Do (it also refreshes each time you open it).
- **☰** (phone) opens the sidebar.

## Notes / troubleshooting

- **“redirect URI mismatch”** on sign-in → the address in the browser must exactly match a
  Redirect URI you registered in Part B step 3/4 (trailing slash matters). Fix it in
  **Entra → your app → Authentication**.
- **Saved lists say “this device only”** → the `Files.ReadWrite.AppFolder` permission or admin
  consent (Part B step 5–6) isn't in place. They still work locally; grant consent to sync.
- Your smart lists live in a private folder only this app can see:
  OneDrive → *Apps* → *Smart To Do* → `smart-lists.json`.
- No passwords are stored. Microsoft handles sign-in and returns a short-lived token.
- To update the app later, re-upload the changed file(s) to the repo; devices pick up changes
  next time they're online (the offline cache refreshes automatically).
