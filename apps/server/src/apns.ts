import type { PushPayload } from "@pr-peek/core";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import type { Config } from "./config";
import type { PushOptions } from "./push";

// Apple's push service (APNs), for the iPhone app (plan 12). Xcode builds can only be
// reached through the sandbox, TestFlight and App Store builds through production.
export const APNS_ORIGINS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

// Apple takes a signed token for up to an hour, and refuses new ones more often than
// every 20 minutes. So each lasts this long.
export const APNS_TOKEN_MS = 50 * 60 * 1000;

// A push Apple hasn't answered by now fails, so a stuck connection can't hold up the rest.
export const APNS_TIMEOUT_MS = 15_000;

// The longest collapse ID Apple takes, in bytes.
const MAX_COLLAPSE_ID = 64;

export interface Apns {
  key: string;
  keyId: string;
  teamId: string;
  // The app's bundle ID.
  topic: string;
}

// The APNs settings, or null when they aren't set. Config checks they're all set or none
// are.
export function apnsFrom(config: Config): Apns | null {
  const { APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC } = config;
  if (!APNS_KEY || !APNS_KEY_ID || !APNS_TEAM_ID || !APNS_TOPIC) return null;
  return {
    key: APNS_KEY,
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
    topic: APNS_TOPIC,
  };
}

// Apple refused a push. `reason` is Apple's, like "BadDeviceToken".
export class ApnsError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`APNs ${status}: ${reason}`);
  }
}

// Apple's answers when the app was removed, or the token isn't this app's anymore.
export const isGoneFromApple = (err: unknown) =>
  err instanceof ApnsError &&
  (err.status === 410 ||
    err.reason === "BadDeviceToken" ||
    err.reason === "DeviceTokenNotForTopic");

export type AppleTarget = { token: string; sandbox: boolean };

// Sends one push to the iPhone app. Throws ApnsError when Apple refuses it.
export type SendApple = (
  target: AppleTarget,
  payload: PushPayload,
  options: PushOptions,
) => Promise<void>;

const base64url = (data: string | Buffer) =>
  Buffer.from(data).toString("base64url");

// The token that proves the push is ours: ES256 over the key ID and team ID.
export function apnsToken(key: KeyObject, apns: Apns, now: number) {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: apns.keyId }));
  const claims = base64url(
    JSON.stringify({ iss: apns.teamId, iat: Math.floor(now / 1000) }),
  );
  const signed = `${header}.${claims}`;
  // Apple wants the raw signature, not the DER that Node gives by default.
  const signature = sign("sha256", Buffer.from(signed), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signed}.${base64url(signature)}`;
}

// What Apple shows, and what the app reads when it's tapped.
export function apnsBody(payload: PushPayload) {
  return {
    aps: {
      alert: { title: payload.title, body: payload.body },
      ...(payload.badge !== undefined && { badge: payload.badge }),
      sound: "default",
      // Groups a PR's notifications together.
      "thread-id": payload.tag,
      // Lets the app's notification extension add the picture and the tile (12.6).
      "mutable-content": 1,
    },
    url: payload.url,
    ...(payload.itemId && { itemId: payload.itemId }),
  };
}

// The tag, cut to Apple's limit, so a newer push with the same tag replaces the old one.
const collapseId = (tag: string) =>
  Buffer.from(tag).subarray(0, MAX_COLLAPSE_ID).toString();

export function appleSender(
  apns: Apns,
  origins = APNS_ORIGINS,
  clock = () => Date.now(),
): SendApple {
  const key = createPrivateKey(apns.key);
  let token: { value: string; madeAt: number } | null = null;
  const bearer = () => {
    const now = clock();
    if (!token || now - token.madeAt >= APNS_TOKEN_MS) {
      token = { value: apnsToken(key, apns, now), madeAt: now };
    }
    return token.value;
  };

  // One connection per origin, kept open, as Apple asks. A closed one opens again.
  const sessions = new Map<string, ClientHttp2Session>();
  const sessionFor = (origin: string) => {
    const open = sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const session = connect(origin);
    // An error closes it. The next push opens a new one.
    session.on("error", () => sessions.delete(origin));
    session.on("close", () => sessions.delete(origin));
    // Doesn't keep the process alive between pushes.
    session.unref();
    sessions.set(origin, session);
    return session;
  };

  return (target, payload, options) =>
    new Promise((resolve, reject) => {
      const origin = target.sandbox ? origins.sandbox : origins.production;
      const request = sessionFor(origin).request({
        ":method": "POST",
        ":path": `/3/device/${target.token}`,
        authorization: `bearer ${bearer()}`,
        "apns-topic": apns.topic,
        "apns-push-type": "alert",
        // 10 shows it now. 5 lets iOS wait to save battery.
        "apns-priority": options.urgency === "high" ? "10" : "5",
        "apns-expiration": String(
          Math.floor(clock() / 1000) + options.ttlSeconds,
        ),
        "apns-collapse-id": collapseId(payload.tag),
      });
      let status = 0;
      let answer = "";
      request.setEncoding("utf8");
      request.on("response", (headers) => {
        status = Number(headers[":status"]);
      });
      request.on("data", (chunk: string) => (answer += chunk));
      request.on("error", reject);
      request.setTimeout(APNS_TIMEOUT_MS, () => {
        request.close();
        reject(new ApnsError(0, "Timeout"));
      });
      request.on("end", () => {
        if (status === 200) return resolve();
        reject(new ApnsError(status, reasonOf(answer)));
      });
      request.end(JSON.stringify(apnsBody(payload)));
    });
}

// Apple's reason, from a body like {"reason":"BadDeviceToken"}.
function reasonOf(answer: string): string {
  try {
    const { reason } = JSON.parse(answer) as { reason?: unknown };
    return typeof reason === "string" ? reason : "Unknown";
  } catch {
    return "Unknown";
  }
}
