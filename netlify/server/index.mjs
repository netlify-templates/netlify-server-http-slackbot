import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { onShutdown, onStart } from "@netlify/server";
import { App, HTTPReceiver } from "@slack/bolt";

const instanceId = randomUUID().slice(0, 8);
const startedAt = Date.now();

const { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET } = process.env;

// Slack POSTs each event to this path, and that request starts the server if
// no instance is running. The Request URL to set in the Slack app's Event
// Subscriptions is the site's URL followed by this path.
const SLACK_EVENTS_PATH = "/slack/events";

const state = {
  slack: "not_configured",
  botUserId: null,
  eventsHandled: 0,
  duplicatesSkipped: 0,
  lastEventAt: null,
};

// The last few events this instance received, oldest first, for /status. They
// live in memory, so they cover this instance only. /status is public, so they
// hold no message text or channel IDs.
const recentEvents = [];

const remember = (entry) => {
  recentEvents.push(entry);

  if (recentEvents.length > 20) {
    recentEvents.shift();
  }

  return entry;
};

// The event IDs this instance already handled, so a redelivery of one of them
// is skipped rather than answered twice. Slack retries within about 5 minutes,
// or hourly for a day with Delayed Events, so an hour covers the usual case.
const seenEventIds = new Map();
const SEEN_FOR_MS = 60 * 60 * 1000;

// Returns false when the event was already seen.
const markSeen = (eventId) => {
  const now = Date.now();

  // A Map iterates in insertion order, so the oldest entries come first.
  for (const [id, seenAt] of seenEventIds) {
    if (now - seenAt < SEEN_FOR_MS) {
      break;
    }

    seenEventIds.delete(id);
  }

  if (seenEventIds.has(eventId)) {
    return false;
  }

  seenEventIds.set(eventId, now);

  return true;
};

const log = (message) => console.log(`[bot ${instanceId}] ${message}`);

const formatDuration = (ms) => {
  const seconds = Math.round(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return [h && `${h}h`, (h || m) && `${m}m`, `${s}s`].filter(Boolean).join(" ");
};

// Set when the credentials are there. It checks each request's signature and
// passes Slack's events on to the app.
let receiver;

if (SLACK_BOT_TOKEN && SLACK_SIGNING_SECRET) {
  receiver = new HTTPReceiver({ signingSecret: SLACK_SIGNING_SECRET, endpoints: SLACK_EVENTS_PATH });

  const app = new App({
    token: SLACK_BOT_TOKEN,
    receiver,
    // Bolt checks the token in onStart below. Otherwise it checks it right
    // away, and an invalid token crashes the server.
    deferInitialization: true,
    // Bolt retries failed Slack API calls for about 30 minutes by default,
    // long past the point where a reply or a start is useful.
    clientOptions: { retryConfig: { retries: 2 } },
  });

  // Bolt has already acknowledged the event by the time this runs, so
  // skipping a duplicate here still tells Slack it was received.
  app.use(async ({ body, context, next }) => {
    if (body.event_id && !markSeen(body.event_id)) {
      state.duplicatesSkipped += 1;
      remember({
        at: new Date().toISOString(),
        eventId: body.event_id,
        retry: context.retryNum ?? 0,
        ...(context.retryReason && { retryReason: context.retryReason }),
        outcome: "duplicate_skipped",
      });
      log(`skipped ${body.event_id}, already handled (retry ${context.retryNum ?? 0})`);

      return;
    }

    await next();
  });

  app.event("app_mention", async ({ event, body, say, context }) => {
    const lagMs = Math.round(Date.now() - Number(event.event_ts) * 1000);
    const entry = remember({
      at: new Date().toISOString(),
      eventId: body.event_id,
      retry: context.retryNum ?? 0,
      ...(context.retryReason && { retryReason: context.retryReason }),
      lagMs,
      outcome: "handling",
    });

    state.eventsHandled += 1;
    state.lastEventAt = entry.at;
    log(`app_mention in ${event.channel}, event lag ${lagMs}ms, retry ${entry.retry}`);

    try {
      await say({
        thread_ts: event.thread_ts ?? event.ts,
        text: [
          `pong from instance \`${instanceId}\``,
          `up ${formatDuration(Date.now() - startedAt)}`,
          `event lag ${(lagMs / 1000).toFixed(1)}s`,
          ...(entry.retry ? [`Slack retry #${entry.retry}`] : []),
        ].join(" · "),
      });
      entry.outcome = "replied";
    } catch (error) {
      entry.outcome = `reply_failed: ${error.message}`;
      throw error;
    }
  });

  app.error(async (error) => {
    log(`error: ${error.message}`);
  });

  // Requests wait until this resolves. A production deploy runs it before
  // going live, so a deploy whose bot token is invalid fails instead of being
  // published.
  onStart(async () => {
    const [auth] = await Promise.all([app.client.auth.test(), app.init()]);

    state.slack = "listening";
    state.botUserId = auth.user_id;
    log(`ready as ${auth.user_id} in workspace "${auth.team}"`);
  });
} else {
  log("SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET isn't set, so the bot won't answer Slack");
}

onShutdown(() => {
  log(`instance stopping after ${formatDuration(Date.now() - startedAt)}, handled ${state.eventsHandled} events`);
});

const send = (res, status, body, contentType) => {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
};

// One instance at a time, so the instance that handled an event is the one
// that gets Slack's retries for it, and the duplicate check above catches them.
export const config = {
  scale: { max: 1 },
};

// A Node.js server that doesn't call listen() is run by Netlify as is, which
// lets Bolt's receiver take Slack's requests directly.
export default createServer((req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");

    if (pathname === SLACK_EVENTS_PATH) {
      if (receiver) {
        return receiver.requestListener(req, res);
      }

      return send(res, 503, "The bot's Slack credentials aren't set.\n", "text/plain; charset=utf-8");
    }

    if (pathname === "/status") {
      return send(
        res,
        200,
        JSON.stringify({ instanceId, uptime: formatDuration(Date.now() - startedAt), ...state, recentEvents }),
        "application/json",
      );
    }

    send(res, 404, "Not found\n", "text/plain; charset=utf-8");
  } catch (error) {
    log(`error handling ${req.url}: ${error.message}`);
    send(res, 500, "Internal error\n", "text/plain; charset=utf-8");
  }
});
