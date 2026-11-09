# Notes for coding agents

You're helping someone deploy this Slack bot on Netlify Server. [README.md](README.md) has the steps, so follow them in order. This file covers how to go about them.

## Who does what

You run the terminal steps (`git clone`, `npm install`, `netlify sites:create`, `netlify deploy --prod` and the `curl` checks), edit `slack/app-manifest.json`, and explain each result.

The person does every step marked **(browser)**. These happen in Slack and need their Slack login, so give them the exact page and button, and wait for them to say it's done.

Before you start, ask for the site name they want, and whether they're using a Slack developer sandbox or another workspace. A sandbox is an Enterprise organization, where installing an app installs it for the whole organization, and the app then has to be added to a workspace (step 3 in the README).

## Secrets

Never ask the person to paste a token or the signing secret into the conversation, and never put one on a command line, in a file or in a commit.

To store the credentials, have the person run `bash scripts/set-tokens.sh` in a terminal they type into. The script reads each value without showing it. If you can open a terminal for them, start the script there and let them paste. Otherwise, give them the command to run.

Don't try to read the values back. `netlify env:list` and the Netlify API don't return secret values anyway. For local development, the person puts their dev app's credentials in `.env` themselves, so don't read that file either.

The credentials are stored for the production context only, so Deploy Previews and branch deploys never act as the bot. Don't copy them to other contexts, and don't use `netlify env:clone` for them, because secret values don't clone.

## Checkpoints

| After | Run | Expect |
|---|---|---|
| Step 2 | `netlify status` | The new project is linked |
| Step 5 | `netlify deploy --prod` | The log mentions deploying "a server" |
| Step 5 | `curl https://<site>.netlify.app/status` | `"slack":"listening"` and a `botUserId` |
| Step 7 | `curl https://<site>.netlify.app/status` | `eventsHandled` went up, and the last entry in `recentEvents` is `replied` |

If `slack` is `not_configured`, the credentials were missing when the deploy was created. Have the person run the script again, then redeploy, since a changed environment variable only takes effect after a redeploy.

## Diagnosing

1. If a mention gets no reply, check `/status`.
   1. If `eventsHandled` didn't change, Slack never delivered the event. Check that the Request URL is verified, that Socket Mode is off, that `app_mention` is subscribed, and that the bot is a member of the channel. In an Enterprise organization, also check that the app was added to the workspace.
   2. If the last entry in `recentEvents` is `reply_failed`, its message gives the Slack API error.
   3. The counts start from zero on each instance, so compare `instanceId` too. If it changed between your checks, the event may have reached the instance that stopped.
2. For the server's logs, run `netlify logs --source server` in the linked folder.
3. Every request to `/status` keeps the instance running for another 5 minutes, so don't poll it while testing what happens after the bot has been idle.
4. Locally, start the server with `npm run dev`, which sets `EXPERIMENTAL_NETLIFY_SERVER=true`. A rejected request returns `500 fetch failed` locally, where a deployed site returns 401. That's how `netlify dev` reports the bot's 401.

## What not to do

- Don't turn on Socket Mode in the Slack app's settings. The bot only takes events over HTTP.
- Don't point the deployed Slack app's Request URL at a local URL. An app has one Request URL, so use a separate app for local development.
- Don't delete Netlify projects or Slack apps yourself. Tell the person what to delete and how, and let them do it.
