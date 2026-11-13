import { expect, it } from "vitest";
import { requestSignOut } from "./signOut";
import { fakeApi, noContent, offline, sentBodies } from "./test/fake-api";
import { stubPush, THIS_ENDPOINT } from "./test/push";

it("sends this browser's push endpoint, then drops its subscription", async () => {
  const push = stubPush({ subscribed: THIS_ENDPOINT });
  const fetch = fakeApi({ "POST /api/auth/signout": noContent });
  await requestSignOut();
  expect(sentBodies(fetch, "POST /api/auth/signout")).toEqual([
    { endpoint: THIS_ENDPOINT },
  ]);
  expect(push.subscription()).toBeNull();
});

it("keeps the subscription when signing out fails, to try again", async () => {
  const push = stubPush({ subscribed: THIS_ENDPOINT });
  fakeApi({ "POST /api/auth/signout": offline });
  await expect(requestSignOut()).rejects.toThrow();
  expect(push.subscription()?.endpoint).toBe(THIS_ENDPOINT);
});

it("sends no endpoint from a browser without push", async () => {
  const fetch = fakeApi({ "POST /api/auth/signout": noContent });
  await requestSignOut();
  expect(sentBodies(fetch, "POST /api/auth/signout")).toEqual([{}]);
});

it("still signs out when the browser's push can't be read", async () => {
  stubPush();
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: () => Promise.reject(new Error("no access")) },
  });
  const fetch = fakeApi({ "POST /api/auth/signout": noContent });
  await requestSignOut();
  expect(sentBodies(fetch, "POST /api/auth/signout")).toEqual([{}]);
});
