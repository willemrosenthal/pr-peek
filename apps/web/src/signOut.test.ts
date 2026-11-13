import { expect, it } from "vitest";
import { resumeWebPush } from "./push";
import { requestSignOut } from "./signOut";
import { fakeApi, json, offline, sentBodies } from "./test/fake-api";
import { stubPush, THIS_ENDPOINT } from "./test/push";

const USER = "user-1";
const signedOut = (deviceRemoved: boolean) => () => json({ deviceRemoved });

it("sends this browser's push endpoint, and keeps its subscription for signing in again", async () => {
  const push = stubPush({ subscribed: THIS_ENDPOINT });
  const fetch = fakeApi({ "POST /api/auth/signout": signedOut(true) });
  await requestSignOut(USER);
  expect(sentBodies(fetch, "POST /api/auth/signout")).toEqual([
    { endpoint: THIS_ENDPOINT },
  ]);
  expect(push.subscription()?.endpoint).toBe(THIS_ENDPOINT);
});

it("drops a subscription that wasn't the user's device", async () => {
  const push = stubPush({ subscribed: THIS_ENDPOINT });
  fakeApi({ "POST /api/auth/signout": signedOut(false) });
  await requestSignOut(USER);
  expect(push.subscription()).toBeNull();
});

it("keeps everything when signing out fails, to try again", async () => {
  const push = stubPush({ subscribed: THIS_ENDPOINT });
  fakeApi({ "POST /api/auth/signout": offline });
  await expect(requestSignOut(USER)).rejects.toThrow();
  expect(push.subscription()?.endpoint).toBe(THIS_ENDPOINT);
  // Not paused: still the user's device on the server.
  expect(await resumeWebPush(USER)).toBe(false);
});

it("sends no endpoint from a browser without push", async () => {
  const fetch = fakeApi({ "POST /api/auth/signout": signedOut(false) });
  await requestSignOut(USER);
  expect(sentBodies(fetch, "POST /api/auth/signout")).toEqual([{}]);
});

it("still signs out when the browser's push can't be read", async () => {
  stubPush();
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: () => Promise.reject(new Error("no access")) },
  });
  const fetch = fakeApi({ "POST /api/auth/signout": signedOut(false) });
  await requestSignOut(USER);
  expect(sentBodies(fetch, "POST /api/auth/signout")).toEqual([{}]);
});
