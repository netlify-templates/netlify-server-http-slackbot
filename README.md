# Slack bot on Netlify Server

This is a small Slack bot that runs on Netlify Server. When you mention it in a channel, it replies in the thread with a "pong" that says which server instance answered, how long that instance has been up, and how long Slack took to deliver the mention:

<img width="567" height="217" alt="slackbot" src="https://github.com/user-attachments/assets/302b58ce-06f8-48bf-9073-e13db85b1fed" />

You can use it to see how a Slack bot behaves on Netlify Server, or as a starting point for your own bot. If a coding agent is helping you set it up, point it to [AGENTS.md](AGENTS.md).

## How it works

Slack sends each event as a POST to `https://<your-site>.netlify.app/slack/events` (that's Slack's Events API). The server, [netlify/server/index.mjs](netlify/server/index.mjs), is a plain Node.js HTTP server. It passes the requests for that path to [Bolt for JavaScript](https://docs.slack.dev/tools/bolt-js/), which checks each request's signature, acknowledges the event and runs the bot's code.

Netlify Server scales to zero. Once no request has reached an instance for 5 minutes, the instance stops, and the next request starts a new one. That works well with the Events API, since the request from Slack starts the instance. In our tests, a mention sent while no instance was running was handled 1.3 seconds after it was posted (cold start included), and Slack didn't have to send it again. That's also why the bot doesn't use Socket Mode. Events that arrive over a socket don't count as requests, so once the instance stops, nothing from Slack can start it again.

If Slack doesn't get an acknowledgement in time, it sends the event again, almost immediately, then after 1 minute and again after 5 minutes. The bot keeps the IDs of the events it handled in memory for an hour, and skips any repeats. Each instance has its own memory, so the server runs only one instance at a time (`scale: { max: 1 }` in its `config`). When the bot does answer a retry (for example, one that reached a different instance), the pong ends with "Slack retry #n".

## Deploy your own

What you need:

- A Netlify account that can deploy Netlify Server projects.
- The [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/), version 27.16.2 or later, logged in with `netlify login`.
- Node.js 24 or later.
- A Slack developer sandbox. It's free. To get one, join the [Slack Developer Program](https://api.slack.com/developer-program), open **Sandboxes** and click **Provision Sandbox** (see [Slack's docs](https://docs.slack.dev/tools/developer-sandboxes/)). A company workspace works too, but installing an app there may need an admin's approval.

Steps marked **(browser)** happen in Slack, and the rest are commands to run in the repo's folder.

### 1. Get the code

```bash
git clone https://github.com/netlify-templates/netlify-server-http-slackbot.git
cd netlify-server-http-slackbot
npm install
```

### 2. Create the Netlify project

```bash
netlify sites:create --name <your-site-name>
```

The name becomes the site's address, `https://<your-site-name>.netlify.app`, and the command links this folder to the new project. If you're a member of more than one Netlify team, add `--account-slug <team-slug>` so the CLI doesn't stop to ask which one.

### 3. Create the Slack app (browser)

Before you open Slack, replace `YOUR-SITE` in [slack/app-manifest.json](slack/app-manifest.json) with your site name. You can rename the app and the bot there too (Slack allows up to 35 characters for the app name). Then:

1. Go to [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App** > **From a manifest**, pick your workspace, and paste the manifest. Slack doesn't check the Request URL yet (that's step 6).
2. Open **Install App** and install the app. A sandbox is an Enterprise organization, so this installs the app for the whole organization, and you still need to add it to your workspace. In Slack, click the organization's name, choose **Organization Settings** > **Integrations** > **Installed apps**, click the three dots next to the app, and choose **Add to more workspaces**.
3. Keep the app's settings open. In the next step, you'll need the **Bot User OAuth Token** (`xoxb-…`) from the **Install App** page, and the **Signing Secret** from **Basic Information** > **App Credentials**.

### 4. Store the credentials

```bash
bash scripts/set-tokens.sh
```

Paste the bot token and then the signing secret when the script asks for them (what you paste isn't shown). It stores both as secret environment variables for the production context only, so Deploy Previews and branch deploys never act as the bot.

### 5. Deploy

```bash
netlify deploy --prod
curl https://<your-site-name>.netlify.app/status
```

The deploy log should say it's deploying "a server", and `/status` should show `"slack":"listening"`, with the bot's user ID in `botUserId`.

If `slack` is `not_configured`, the credentials weren't there when you deployed, so run step 4 again and redeploy. If the deploy itself fails, check the bot token first, since the server checks it before a deploy goes live.

### 6. Verify the Request URL (browser)

In the app's settings, open **Event Subscriptions**. The **Request URL** should show **Verified** (if it doesn't, click **Retry**). Check that `app_mention` is listed under **Subscribe to bot events**, click **Save Changes**, and reinstall the app if Slack asks.

### 7. Try it (browser)

In a channel, invite the bot (`/invite @<bot name>`) and mention it. It replies in the thread. Now leave it alone for more than 5 minutes and mention it again. By then the instance has stopped, so the reply comes from a new instance, with a different ID and a short uptime.

## Checking on the bot

`/status` shows the state of the instance that answered:

- `instanceId` and `uptime`.
- `slack` and `botUserId`.
- The counts, `eventsHandled` and `duplicatesSkipped`.
- `recentEvents`, the last 20 events, each with Slack's retry count, the lag and the outcome (`replied`, `reply_failed` with Slack's error, or `duplicate_skipped`).

Anyone can read it, so it leaves out message text and channel IDs. Each request to it also keeps the instance running for another 5 minutes, so don't poll it while you wait for the bot to scale to zero.

The server's logs show each mention, and when each instance starts and stops. To see them, run `netlify logs --source server` in the repo's folder.

## Local development

Use a second Slack app for this, created from the same manifest. An app sends its events to one Request URL, so pointing your deployed app at your machine would take the deployed bot offline.

Put the dev app's bot token and signing secret in `.env` (see [.env.example](.env.example)), and start `netlify dev` with a public URL:

```bash
npm run dev -- --live
```

Then set the dev app's Request URL to that URL, followed by `/slack/events`.

One quirk - a request that the bot rejects (such as one with a bad signature) should get a 401, but `netlify dev` turns it into `500 fetch failed`. Deployed sites return the 401.

## Troubleshooting

- If the bot never answers, check that it's a member of the channel, that the Request URL is verified, that `app_mention` is subscribed, and that **Socket Mode** is off in the app's settings (while it's on, Slack doesn't send events to the Request URL).
  - In a sandbox or another Enterprise organization, also check that the app was added to your workspace (step 3), and that the manifest still has `org_deploy_enabled: true`. Without that setting, the install works, but Slack never sends the app any events.
- If the Request URL won't verify, deploy first (steps 4 and 5) and check that `/status` shows `"slack":"listening"`. Also check that the URL ends with `/slack/events`, and that the project isn't password protected, since that blocks Slack's requests too.
- If the deploy fails with "Netlify Server is only available on credit-based plans", your Netlify team's plan doesn't include Netlify Server.
- If `/slack/events` returns 503, the deploy doesn't have the credentials, so run step 4 again and redeploy.
- If `netlify dev` tries to run Hugo, keep the `[build]` and `[dev]` settings in [netlify.toml](netlify.toml). Without them, framework detection may find a `config.json` in a parent folder and decide it's a Hugo site.
- If `/status` returns the CLI's own 404 locally, start the server with `npm run dev`, which sets `EXPERIMENTAL_NETLIFY_SERVER=true`.
- If a local request fails with "Server process exited … before it was ready" right after you saved a file, just request again. `netlify dev` sometimes reloads the server twice for one save.
