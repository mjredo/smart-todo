# Smart To Do — reminder push server

A Cloudflare Worker (`smart-todo-push.mrnarang.workers.dev`) that makes To Do
reminders pop up on your devices without the Microsoft To Do app.

- Every minute a cron tick checks for due reminders. It re-reads your To Do lists
  from Microsoft Graph about every 5 minutes, and straight away whenever Smart To Do
  changes a reminder.
- It sends a Web Push to each device that turned on **Reminder notifications**
  (sidebar → Maintenance). `sw.js` shows the notification.
- **Done** and **Snooze 15 min** on the notification call `/action` here, which
  updates the task in To Do. Tapping the notification opens the task.

## One-time Entra setup (done by you in the Azure portal)

The Worker reads To Do with its own app sign-in, because it runs while you're signed
out. It uses the existing **Smart To Do** app registration
(`cce7b33a-e049-4ee1-9859-a8d6a6b38a0e`):

1. **Entra admin center → App registrations → Smart To Do → API permissions → Add a
   permission → Microsoft Graph → Application permissions → `Tasks.ReadWrite.All`**,
   then click **Grant admin consent for MJ Property Investments LLC**.
2. **Certificates & secrets → New client secret** (24 months). Copy the **Value**.
3. In this folder, run `npx wrangler secret put CLIENT_SECRET` and paste the value
   when it asks.

## Secrets (already set, except CLIENT_SECRET)

| Name | What |
|---|---|
| `CLIENT_SECRET` | Entra client secret (step 2 above). Renew it before it expires. |
| `VAPID_PRIVATE_KEY` | Web Push signing key. Its public half is `VAPID_PUBLIC_KEY` in `wrangler.jsonc`. If you replace it, every device must turn reminders on again. |
| `ACTION_SECRET` | Signs the Done / Snooze buttons so only real notifications can change tasks. |

## Commands

```
npx wrangler deploy        # ship changes
npx wrangler tail          # live logs
```

KV namespace `smart-todo-push` holds the device list (`subs`), the upcoming
reminders (`sched:<userId>`) and which reminders have already fired (`fired:<userId>`).
