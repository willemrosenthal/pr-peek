import {
  addAppleDeviceBody,
  addPushSubscriptionBody,
  MAX_PUSH_DEVICES,
  updatePushSubscriptionBody,
  type AppleDeviceDto,
  type AppleDeviceResponse,
  type AppleTestResponse,
  type PushKeyResponse,
  type PushSubscriptionDto,
  type PushSubscriptionResponse,
  type PushSubscriptionsResponse,
} from "@pr-peek/core";
import express, { type Router } from "express";
import type { Logger } from "pino";
import type { SendApple } from "../apns";
import type { Db } from "../db";
import type { AppleDevice, PushSubscription } from "../generated/prisma/client";
import { HttpError, parseInput, sentFields } from "../http-error";
import { NOTIFY_TTL_SECONDS, pushToAppleDevice } from "../push";
import { pushSamples } from "../push-samples";
import { userLimiter } from "../rate-limit";
import { currentUser, requireUser } from "./auth";

export interface PushRouteDeps {
  db: Db;
  // Null when push is off, because the VAPID keys aren't set.
  push: { publicKey: string } | null;
  // Null when Apple push is off, because the APNs settings aren't set.
  apple: SendApple | null;
  logger: Logger;
}

// "Send a test" sends a burst of pushes, so it's kept to a few a minute.
const TESTS_PER_MINUTE = 3;

function toDto(row: PushSubscription): PushSubscriptionDto {
  return {
    id: row.id,
    endpoint: row.endpoint,
    label: row.label,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAppleDto(row: AppleDevice): AppleDeviceDto {
  return {
    id: row.id,
    label: row.label,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const tooMany = () =>
  new HttpError(
    422,
    "too_many_devices",
    `You can have up to ${MAX_PUSH_DEVICES} devices`,
  );

const notFound = () => new HttpError(404, "not_found", "Device not found");
const pushOff = () =>
  new HttpError(503, "push_off", "Push notifications aren't set up");

export function pushRouter(deps: PushRouteDeps): Router {
  const router = express.Router();
  const { db } = deps;
  router.use(["/push/subscriptions", "/apple-devices"], requireUser(db));

  router.get("/push/key", (_req, res) => {
    if (!deps.push) throw pushOff();
    const body: PushKeyResponse = { publicKey: deps.push.publicKey };
    res.json(body);
  });

  router.get("/push/subscriptions", async (_req, res) => {
    const rows = await db.pushSubscription.findMany({
      where: { userId: currentUser(res).id },
      orderBy: { createdAt: "asc" },
    });
    const body: PushSubscriptionsResponse = { subscriptions: rows.map(toDto) };
    res.json(body);
  });

  // Also called each time the app opens, so sending the same device again just updates it.
  router.post("/push/subscriptions", async (req, res) => {
    const userId = currentUser(res).id;
    const { endpoint, keys, label, onMac } = parseInput(
      addPushSubscriptionBody,
      req.body,
    );
    const known = onMac === undefined ? {} : { onMac };

    const others = await db.pushSubscription.count({
      where: { userId, endpoint: { not: endpoint } },
    });
    if (others >= MAX_PUSH_DEVICES) throw tooMany();

    const existing = await db.pushSubscription.findUnique({
      where: { endpoint },
    });
    const isMine = existing?.userId === userId;
    const fresh = { userId, label, ...keys, ...known };
    const saved = await db.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, ...fresh },
      // Someone else signed in on this browser: start over as their device.
      update: isMine
        ? { ...keys, ...known }
        : {
            ...fresh,
            onMac: onMac ?? null,
            lastSuccessAt: null,
            failureCount: 0,
          },
    });
    const body: PushSubscriptionResponse = { subscription: toDto(saved) };
    res.status(isMine ? 200 : 201).json(body);
  });

  // A `subscription` moves the device to the browser's new one, keeping its settings.
  router.patch("/push/subscriptions/:id", async (req, res) => {
    const { subscription, ...changes } = parseInput(
      updatePushSubscriptionBody,
      req.body,
    );
    const where = { id: req.params.id, userId: currentUser(res).id };
    if (subscription) {
      const taken = await db.pushSubscription.findUnique({
        where: { endpoint: subscription.endpoint },
        select: { id: true },
      });
      if (taken && taken.id !== where.id) {
        throw new HttpError(
          409,
          "device_exists",
          "This subscription is already a device",
        );
      }
    }
    const { count } = await db.pushSubscription.updateMany({
      where,
      data: {
        ...sentFields(changes),
        ...(subscription && {
          endpoint: subscription.endpoint,
          ...subscription.keys,
          failureCount: 0,
        }),
      },
    });
    if (count === 0) throw notFound();
    const saved = await db.pushSubscription.findUniqueOrThrow({ where });
    const body: PushSubscriptionResponse = { subscription: toDto(saved) };
    res.json(body);
  });

  router.delete("/push/subscriptions/:id", async (req, res) => {
    const { count } = await db.pushSubscription.deleteMany({
      where: { id: req.params.id, userId: currentUser(res).id },
    });
    if (count === 0) throw notFound();
    res.sendStatus(204);
  });

  // The iPhone app (plan 12). Called each time it opens, so the same phone just updates.
  router.post("/apple-devices", async (req, res) => {
    const userId = currentUser(res).id;
    const { token, label, sandbox } = parseInput(addAppleDeviceBody, req.body);

    const others = await db.appleDevice.count({
      where: { userId, token: { not: token } },
    });
    if (others >= MAX_PUSH_DEVICES) throw tooMany();

    const existing = await db.appleDevice.findUnique({ where: { token } });
    const isMine = existing?.userId === userId;
    const fresh = { userId, label, sandbox };
    const saved = await db.appleDevice.upsert({
      where: { token },
      create: { token, ...fresh },
      // Someone else signed in on this phone: start over as their device.
      update: isMine
        ? { label, sandbox }
        : { ...fresh, lastSuccessAt: null, failureCount: 0 },
    });
    const body: AppleDeviceResponse = { device: toAppleDto(saved) };
    res.status(isMine ? 200 : 201).json(body);
  });

  // One sample of each kind to each of the user's iPhone apps, to check the tiles (12.6).
  router.post(
    "/apple-devices/test",
    userLimiter(60 * 1000, TESTS_PER_MINUTE),
    async (_req, res) => {
      const { apple } = deps;
      if (!apple) {
        throw new HttpError(503, "push_off", "iPhone push isn't set up");
      }
      const user = currentUser(res);
      const phones = await db.appleDevice.findMany({
        where: { userId: user.id },
      });
      if (phones.length === 0) throw notFound();

      const samples = pushSamples(user.login);
      const options = {
        ttlSeconds: NOTIFY_TTL_SECONDS,
        urgency: "high" as const,
      };
      // Each phone's samples go one at a time, and stop at a failure, so one bad moment
      // counts once against the phone, not once per sample.
      const reached = await Promise.all(
        phones.map(async (phone) => {
          for (const sample of samples) {
            const result = await pushToAppleDevice(
              deps,
              apple,
              phone,
              sample,
              options,
            );
            if (result !== "sent") return false;
          }
          return true;
        }),
      );
      const sent = reached.filter(Boolean).length;
      const body: AppleTestResponse = { sent, failed: phones.length - sent };
      res.json(body);
    },
  );

  // By token, since the app knows its own token, like when signing out.
  router.delete("/apple-devices/:token", async (req, res) => {
    const { count } = await db.appleDevice.deleteMany({
      where: {
        token: req.params.token.toLowerCase(),
        userId: currentUser(res).id,
      },
    });
    if (count === 0) throw notFound();
    res.sendStatus(204);
  });

  return router;
}
