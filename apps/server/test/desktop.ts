import { onTestFinished } from "vitest";
import { listenForItemChanges, type UserEvent } from "../src/items-listener";
import { createLogger } from "../src/logger";
import { TEST_DATABASE_URL } from "./db";

// Collects what the user's Mac menu bar app would get. Notifications only.
export async function desktopNotifications(userId: string) {
  const listener = await listenForItemChanges({
    connectionString: TEST_DATABASE_URL,
    logger: createLogger({ LOG_LEVEL: "silent" }),
  });
  onTestFinished(() => listener.stop());
  const events: Extract<UserEvent, { type: "notify" }>[] = [];
  listener.subscribe(userId, (event) => {
    if (event.type === "notify") events.push(event);
  });
  return events;
}
