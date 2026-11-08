# netlify-server-http-slackbot

This is a small Slack bot that runs on Netlify Server. When you mention it in a channel, it replies in the thread with a "pong" that says which server instance answered, how long that instance has been up, and how long Slack took to deliver the mention. You can use it to try out Slack bots on Netlify Server, or as a starting point for your own bot.

If a coding agent is helping you with the setup, point it to [AGENTS.md](AGENTS.md).

## How it works

The bot gets its events through Slack's Events API. Slack sends each event as a POST to `https://<your-site>.netlify.app/slack/events`, and the bot handles it with [Bolt for JavaScript](https://docs.slack.dev/tools/bolt-js/), which checks the request's signature, acknowledges the event and runs the bot's code.

The server is [netlify/server/index.mjs](netlify/server/index.mjs). It exports a Node.js HTTP server without calling `listen()`, and Netlify sends requests to it as they are, so Bolt's HTTP receiver handles `/slack/events` directly, next to the bot's own `/status` route.

Netlify Server scales to zero. An instance stops once no HTTP request has reached it for a while (currently 5 minutes), and the next request starts a new one. The Events API fits that well, since Slack's request for the next event is what starts a new instance, and the bot acknowledges the event well within the 3 seconds Slack allows.

That's also why this bot doesn't use Socket Mode. In Socket Mode, events arrive over a WebSocket that the bot keeps open, and they don't count as requests. Once the instance stops, the socket closes with it, and nothing from Slack can start the bot again.

## What you need

- A Netlify account with access to Netlify Server.
- The [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/), version 27.16.2 or later, logged in with `netlify login`.
- Node.js 24 or later.
- A Slack workspace where you can create and install apps. A [developer sandbox](https://docs.slack.dev/tools/developer-sandboxes/) is free and works well. In a company workspace, installing an app may need an admin's approval.

## Setting up the bot

Steps marked **(browser)** are done in Slack's web settings. Everything else is a command, run from this folder.

### 1. Install the dependencies

```bash
npm install
```

### 2. Create the Netlify project

```bash
netlify sites:create --name <your-site-name>
```

The name becomes your site's address (`https://<your-site-name>.netlify.app`), so it has to be one that isn't taken yet. If you're a member of more than one Netlify team, add `--account-slug <team-slug>`, so the CLI doesn't stop to ask which one. The command also links this folder to the new project.

### 3. Create the Slack app (browser)

1. In [slack/app-manifest.json](slack/app-manifest.json), replace `YOUR-SITE` with your site name. You can also change the app and bot names there (Slack allows up to 35 characters for the app name).
2. Go to [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App** > **From a manifest**, pick your workspace, paste the manifest and create the app. Slack doesn't check the Request URL at this point (that happens in step 6).
3. In the app's settings, open **Install App**, install the app to your workspace (or organization), and copy the **Bot User OAuth Token** (`xoxb-…`) shown there.
4. Open **Basic Information**, and under **App Credentials**, show the **Signing Secret** and copy it.

### 4. Store the credentials

```bash
bash scripts/set-tokens.sh
```

Paste the bot token and then the signing secret when asked (what you paste isn't shown). The script stores both as secret environment variables for the production context only. Deploy Previews and branch deploys don't get them, so they never act as the bot.

### 5. Deploy

```bash
netlify deploy --prod
```

The deploy log should say it's deploying "a server". Then check the bot:

```bash
curl https://<your-site-name>.netlify.app/status
```

You should see `"slack":"listening"`, and the bot's user ID in `botUserId`.

If `slack` is `not_configured`, the deploy was created without the credentials, so run step 4 again and redeploy. If the deploy itself fails, the bot token is usually the problem, since the server checks it before a deploy goes live.

### 6. Verify the Request URL (browser)

In the app's settings, open **Event Subscriptions**. The **Request URL** should show **Verified**. If it doesn't, click **Retry** or enter the URL again. Slack then sends a challenge, which the bot answers using the signing secret.

Make sure `app_mention` is listed under **Subscribe to bot events**, and click **Save Changes**. If Slack asks you to reinstall the app, go ahead and reinstall it.

### 7. Try it (browser)

In a channel, invite the bot (`/invite @<bot name>`) and mention it (`@<bot name> hello`). It replies in the thread:

```text
pong from instance `a1b2c3d4` · up 12s · event lag 0.9s
```

Now leave it alone for more than 5 minutes, and mention it again. By then the instance has stopped, so Slack's request starts a new one, and the reply shows a different instance ID with a short uptime.

## Checking on the bot

`/status` shows the state of the instance that answered the request:

- `slack` (`listening` or `not_configured`) and `botUserId`.
- The event counts, `eventsHandled` and `duplicatesSkipped`, and when the last event arrived, in `lastEventAt`.
- `recentEvents`, which lists the last 20 events. Each one has its event ID, Slack's retry count and reason, lag, and outcome (`replied`, `reply_failed` with Slack's error, or `duplicate_skipped`).

Anyone can read `/status`, so it leaves out message text and channel IDs. Every request to it also counts as activity, so it keeps the instance up for another 5 minutes.

The server's logs show each mention, and when each instance starts and stops. To see them, run this from the project's folder:

```bash
netlify logs --source server
```

## Retries and repeat deliveries

When Slack doesn't get an acknowledgement in time, it delivers the event again. It retries almost immediately, then after 1 minute, and then after 5 minutes.

The bot remembers the ID of every event it handled for an hour, and skips repeats, so each mention gets one answer. That memory belongs to the instance, which is why the server runs one instance at a time (`scale: { max: 1 }` in its `config`). If a retry still reaches an instance that never saw the event, such as a new one after the previous instance stopped, the bot answers it, and the pong ends with "Slack retry #n".

## Local development

To run the bot on your machine, create a second Slack app from the same manifest, for development. A Slack app sends its events to one Request URL, so pointing your deployed app at your machine would take the deployed bot offline.

Put the dev app's bot token and signing secret in `.env` (see [.env.example](.env.example)), and start `netlify dev` with a public URL:

```bash
npm run dev -- --live
```

Then set the dev app's Request URL to the live URL, followed by `/slack/events`.

One quirk to know about: a request that the bot rejects (such as one with a bad signature) should get a 401, but `netlify dev` turns that into `500 fetch failed`. Deployed sites return the 401 as expected.

## Troubleshooting

- If the bot never answers, check that it's a member of the channel, that the Request URL is verified, and that `app_mention` is subscribed. Also check that **Socket Mode** is off in the app's settings, since Slack doesn't send events to the Request URL while it's on.
  - In an Enterprise organization (including a developer sandbox), the app has to be org-ready, meaning `org_deploy_enabled: true`, which the manifest already sets. Without it, the install works, but Slack never sends the app any events.
- If there's no bot token on **OAuth & Permissions**, look on the **Install App** page. That's where it is for apps installed to an organization.
- If the Request URL won't verify, deploy with the signing secret first (steps 4 and 5), and check that `/status` shows `"slack":"listening"`. Also make sure the URL ends with `/slack/events`, and that the project isn't password protected, since that blocks Slack's requests too.
- If `/slack/events` returns 503, the deploy doesn't have the credentials, so run step 4 again and redeploy.
- If `netlify dev` tries to run Hugo, keep the `[dev]` and `[build]` settings in [netlify.toml](netlify.toml). Without them, framework detection may find a `config.json` in a parent folder and decide it's a Hugo site.
- If `/status` returns the CLI's own 404 locally, start `netlify dev` with `EXPERIMENTAL_NETLIFY_SERVER=true` (or use `npm run dev`).
- If a local request fails with "Server process exited … before it was ready" right after you saved a server file, just request again. `netlify dev` sometimes reloads the server twice for one save.

## Files

| File | What it does |
|---|---|
| `netlify/server/index.mjs` | The bot. Serves `/slack/events` and `/status`. |
| `slack/app-manifest.json` | The manifest for the Slack app. |
| `scripts/set-tokens.sh` | Stores the Slack credentials as secret production variables, without showing them. |
| `public/index.html` | A small home page, served as a static file. |
| `netlify.toml` | Makes `public` the only folder served as static files, with no build step. |
