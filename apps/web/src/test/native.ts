import { vi } from "vitest";

// The iPhone app's plugins (native.ts), faked. Use it with
// `vi.mock("<path to>/native", () => import("<path to>/test/native"))`, and call
// resetNative() before each test. Keeps each listener, so a test can fire it.

const listeners = new Map<string, (event: unknown) => void>();

// What checkPermissions and requestPermissions answer.
export const permission = { receive: "granted" };

export const PushNotifications = {
  addListener: vi.fn((name: string, listener: (event: unknown) => void) => {
    listeners.set(name, listener);
    return Promise.resolve({ remove: () => listeners.delete(name) });
  }),
  checkPermissions: vi.fn(() => Promise.resolve({ ...permission })),
  requestPermissions: vi.fn(() => Promise.resolve({ ...permission })),
  register: vi.fn(() => Promise.resolve()),
};

export const PrPeek = {
  build: vi.fn(() => Promise.resolve({ sandbox: true })),
  setBadge: vi.fn((_options: { count: number }) => Promise.resolve()),
  openSettings: vi.fn(() => Promise.resolve()),
};

// Not asked yet. Asking answers `receive`, and the permission stays that way, like
// tapping Allow or Don't Allow.
export function answerAsk(receive: "granted" | "denied") {
  permission.receive = "prompt";
  PushNotifications.requestPermissions.mockImplementationOnce(() => {
    permission.receive = receive;
    return Promise.resolve({ receive });
  });
}

// Calls the listener added for `name`, like the app does.
export const fire = (name: string, event: unknown) =>
  listeners.get(name)?.(event);

// How many listeners are still added.
export const listenerCount = () => listeners.size;

// Makes the page look like it's inside the iPhone app, like `?shell=ios` does. Test
// setup clears it after each test.
export const enterIosApp = () => sessionStorage.setItem("pr-peek:shell", "ios");

// Each native tick asked for, by strength.
export const nativeHaptic = vi.fn((_kind: string) => Promise.resolve());

export function resetNative() {
  vi.clearAllMocks();
  listeners.clear();
  permission.receive = "granted";
}
