import type { PushPayload } from "@pr-peek/core";
import { verify } from "node:crypto";
import {
  createServer,
  type Http2Server,
  type IncomingHttpHeaders,
} from "node:http2";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { apnsKeyPair, pemOf } from "../test/fakes";
import {
  ApnsError,
  APNS_TOKEN_MS,
  apnsBody,
  apnsToken,
  appleSender,
  collapseId,
  isGoneFromApple,
  type Apns,
} from "./apns";

const { privateKey, publicKey } = apnsKeyPair();
const APNS: Apns = {
  key: pemOf(privateKey),
  keyId: "KEY1234567",
  teamId: "TEAM123456",
  topic: "com.git-buddy.pr-peek",
};
const TOKEN = "ab".repeat(32);
const PAYLOAD: PushPayload = {
  title: "maya asked for your review",
  body: "Add retry · api #812",
  url: "https://github.com/acme/api/pull/812",
  tag: "item-1",
  itemId: "item-1",
  badge: 3,
};
const NORMAL = { ttlSeconds: 60, urgency: "normal" as const };

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, "base64url").toString()) as unknown;

describe("apnsToken", () => {
  it("signs the key ID and team ID with the key, as Apple asks", () => {
    const token = apnsToken(privateKey, APNS, 1_700_000_000_500);
    const [header = "", claims = "", signature = ""] = token.split(".");
    expect(decode(header)).toEqual({ alg: "ES256", kid: APNS.keyId });
    expect(decode(claims)).toEqual({ iss: APNS.teamId, iat: 1_700_000_000 });
    const signed = verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(signed).toBe(true);
  });
});

it("puts the notification under aps, and the link beside it", () => {
  expect(apnsBody(PAYLOAD)).toEqual({
    aps: {
      alert: { title: PAYLOAD.title, body: PAYLOAD.body },
      badge: 3,
      sound: "default",
      "thread-id": "item-1",
      "mutable-content": 1,
    },
    url: PAYLOAD.url,
    itemId: "item-1",
  });
  // A push about no item, like the morning summary, has no item or badge to send.
  const { itemId: _item, badge: _badge, ...summary } = PAYLOAD;
  const { aps, ...rest } = apnsBody(summary);
  expect(aps).not.toHaveProperty("badge");
  expect(rest).toEqual({ url: PAYLOAD.url });
});

it("cuts the collapse ID to Apple's 64 bytes, without splitting a character", () => {
  expect(collapseId("item-1")).toBe("item-1");
  const cut = collapseId(`${"x".repeat(63)}é`);
  expect(cut).toBe("x".repeat(63));
  expect(Buffer.byteLength(collapseId("é".repeat(40)))).toBe(64);
});

it.each([
  [410, "Unregistered", true],
  [400, "BadDeviceToken", true],
  [400, "DeviceTokenNotForTopic", true],
  [429, "TooManyRequests", false],
  [500, "InternalServerError", false],
])("treats %i %s as gone: %s", (status, reason, gone) => {
  expect(isGoneFromApple(new ApnsError(status, reason))).toBe(gone);
});

describe("appleSender", () => {
  // A stand in for Apple: answers each push with the next answer, and keeps what came.
  interface Received {
    headers: IncomingHttpHeaders;
    body: string;
  }
  let servers: Http2Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.map((server) => new Promise((done) => server.close(done))),
    );
    servers = [];
  });

  async function fakeApple(answers: { status: number; body?: string }[] = []) {
    const received: Received[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        const answer = answers.shift() ?? { status: 200 };
        res.writeHead(answer.status);
        res.end(answer.body ?? "");
      });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    return { received, origin: `http://127.0.0.1:${port}` };
  }

  it("sends to the device, with the topic, priority, expiry, and collapse ID", async () => {
    const apple = await fakeApple();
    const now = 1_700_000_000_000;
    const send = appleSender(
      APNS,
      { production: apple.origin, sandbox: "http://unused" },
      () => now,
    );
    await send({ token: TOKEN, sandbox: false }, PAYLOAD, NORMAL);
    await send(
      { token: TOKEN, sandbox: false },
      { ...PAYLOAD, tag: "x".repeat(100) },
      { ttlSeconds: 60, urgency: "high" },
    );

    const [first, second] = apple.received;
    expect(first?.headers).toMatchObject({
      ":method": "POST",
      ":path": `/3/device/${TOKEN}`,
      "apns-topic": APNS.topic,
      "apns-push-type": "alert",
      "apns-priority": "5",
      "apns-expiration": String(now / 1000 + 60),
      "apns-collapse-id": "item-1",
    });
    expect(JSON.parse(first?.body ?? "")).toEqual(apnsBody(PAYLOAD));
    // High urgency shows at once. Apple takes up to 64 bytes of collapse ID.
    expect(second?.headers["apns-priority"]).toBe("10");
    expect(second?.headers["apns-collapse-id"]).toBe("x".repeat(64));
  });

  it("sends Xcode builds to the sandbox", async () => {
    const production = await fakeApple();
    const sandbox = await fakeApple();
    const send = appleSender(APNS, {
      production: production.origin,
      sandbox: sandbox.origin,
    });
    await send({ token: TOKEN, sandbox: true }, PAYLOAD, NORMAL);
    expect(sandbox.received).toHaveLength(1);
    expect(production.received).toHaveLength(0);
  });

  it("keeps its signed token, and makes a new one once it's old", async () => {
    const apple = await fakeApple();
    let now = 1_700_000_000_000;
    const send = appleSender(
      APNS,
      { production: apple.origin, sandbox: apple.origin },
      () => now,
    );
    const target = { token: TOKEN, sandbox: false };
    await send(target, PAYLOAD, NORMAL);
    now += APNS_TOKEN_MS - 1;
    await send(target, PAYLOAD, NORMAL);
    now += 1;
    await send(target, PAYLOAD, NORMAL);

    const [a, b, c] = apple.received.map((r) => r.headers.authorization);
    expect(a).toMatch(/^bearer /);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  // Apple refuses new tokens more often than every 20 minutes, so only an expired one is
  // made again. Another refusal, like a wrong key, keeps it.
  it.each([
    ["ExpiredProviderToken", true],
    ["InvalidProviderToken", false],
  ])(
    "after Apple answers 403 %s, makes a new token: %s",
    async (reason, fresh) => {
      const apple = await fakeApple([
        { status: 403, body: JSON.stringify({ reason }) },
      ]);
      const send = appleSender(APNS, {
        production: apple.origin,
        sandbox: apple.origin,
      });
      const target = { token: TOKEN, sandbox: false };
      await expect(send(target, PAYLOAD, NORMAL)).rejects.toEqual(
        new ApnsError(403, reason),
      );
      await send(target, PAYLOAD, NORMAL);
      const [refused, next] = apple.received.map(
        (r) => r.headers.authorization,
      );
      expect(next !== refused).toBe(fresh);
    },
  );

  it("throws Apple's status and reason when it refuses", async () => {
    const apple = await fakeApple([
      { status: 410, body: JSON.stringify({ reason: "Unregistered" }) },
      { status: 500, body: "not json" },
    ]);
    const send = appleSender(APNS, {
      production: apple.origin,
      sandbox: apple.origin,
    });
    const target = { token: TOKEN, sandbox: false };
    await expect(send(target, PAYLOAD, NORMAL)).rejects.toEqual(
      new ApnsError(410, "Unregistered"),
    );
    await expect(send(target, PAYLOAD, NORMAL)).rejects.toEqual(
      new ApnsError(500, "Unknown"),
    );
  });
});
