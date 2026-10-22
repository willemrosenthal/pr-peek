import {
  addPushSubscriptionBody,
  MAX_PUSH_DEVICES,
  updatePushSubscriptionBody,
  type PushKeyResponse,
  type PushPayload,
  type PushSubscriptionDto,
  type PushSubscriptionResponse,
  type PushSubscriptionsResponse,
} from "@pr-peek/core";
import express, { type Router } from "express";
import type { Db } from "../db";
import type { PushSubscription } from "../generated/prisma/client";
import { HttpError, parseInput, sentFields } from "../http-error";
import { pushToDevice, type SendPush } from "../push";
import { currentUser, requireUser } from "./auth";

export interface PushRouteDeps {
  db: Db;
  // Null when push is off, because the VAPID keys aren't set.
  push: { publicKey: string; send: SendPush } | null;
}

const TEST_PUSH: PushPayload = {
  title: "pr-peek",
  body: "Notifications work on this device.",
  url: "/",
  tag: "test",
};

function toDto(row: PushSubscription): PushSubscriptionDto {
  return {
    id: row.id,
    endpoint: row.endpoint,
    label: row.label,
    minSeverity: row.minSeverity,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const notFound = () => new HttpError(404, "not_found", "Device not found");
const pushOff = () =>
  new HttpError(503, "push_off", "Push notifications aren't set up");

export function pushRouter(deps: PushRouteDeps): Router {
  const router = express.Router();
  const { db } = deps;
  router.use("/push/subscriptions", requireUser(db));

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
    const { endpoint, keys, label } = parseInput(
      addPushSubscriptionBody,
      req.body,
    );

    const others = await db.pushSubscription.count({
      where: { userId, endpoint: { not: endpoint } },
    });
    if (others >= MAX_PUSH_DEVICES) {
      throw new HttpError(
        422,
        "too_many_devices",
        `You can have up to ${MAX_PUSH_DEVICES} devices`,
      );
    }

    const existing = await db.pushSubscription.findUnique({
      where: { endpoint },
    });
    const isMine = existing?.userId === userId;
    const fresh = { userId, label, ...keys };
    const saved = await db.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, ...fresh },
      // Someone else signed in on this browser: start over as their device.
      update: isMine
        ? keys
        : {
            ...fresh,
            minSeverity: "low",
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

  router.post("/push/subscriptions/:id/test", async (req, res) => {
    if (!deps.push) throw pushOff();
    const where = { id: req.params.id, userId: currentUser(res).id };
    const device = await db.pushSubscription.findFirst({ where });
    if (!device) throw notFound();

    const result = await pushToDevice(
      { db, send: deps.push.send, logger: req.log },
      device,
      TEST_PUSH,
      { ttlSeconds: 60, urgency: "high" },
    );
    if (result === "removed") {
      throw new HttpError(
        410,
        "device_gone",
        "This device stopped taking notifications, so it was removed",
      );
    }
    if (result === "failed") {
      throw new HttpError(
        502,
        "push_failed",
        "The test didn't send. Try again",
      );
    }
    const saved = await db.pushSubscription.findUniqueOrThrow({ where });
    const body: PushSubscriptionResponse = { subscription: toDto(saved) };
    res.json(body);
  });

  return router;
}
