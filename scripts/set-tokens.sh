#!/usr/bin/env bash
# Stores the deployed bot's Slack credentials, the bot token and the signing
# secret, as secret Netlify environment variables for the production context
# only. It asks for each value without showing what you paste, so the values
# stay out of the terminal, your shell history and any agent's view. Redeploy
# afterward for the server to see them.
#
# `netlify env:set` takes each value as an argument, so while it runs, other
# users of this machine can see the value in the process list.
#
#   bash scripts/set-tokens.sh

set -euo pipefail

hide() { sed -E 's/(xox[a-z]-)[A-Za-z0-9-]+/\1[hidden]/g'; }

# Prints only the value, since callers capture it: the prompt and the newline
# after it go to stderr.
ask() {
  local prompt=$1 value
  read -rsp "$prompt: " value
  echo >&2
  printf '%s' "$value"
}

set_secret() {
  netlify env:set "$1" "$2" --context production --secret 2>&1 | hide
}

bot=$(ask "Bot User OAuth Token (xoxb-...)")
[[ $bot == xoxb-* ]] || { echo "The bot token should start with xoxb-." >&2; exit 1; }

secret=$(ask "Signing Secret (Basic Information > App Credentials)")
[[ -n $secret && $secret != xox* && $secret != xapp-* ]] || { echo "That looks like a token, not the signing secret." >&2; exit 1; }

set_secret SLACK_BOT_TOKEN "$bot"
set_secret SLACK_SIGNING_SECRET "$secret"

echo "Done. Redeploy for the server to pick them up: netlify deploy --prod"
