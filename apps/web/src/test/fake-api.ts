import {
  rules,
  type IdlePrDto,
  type ItemDto,
  type ItemsResponse,
  type MeResponse,
  type PushSubscriptionDto,
  type RepoOption,
  type SearchReposResponse,
  type SettingsResponse,
  type SummaryResponse,
  type SyncStatusResponse,
  type UserSettingsDto,
  type WatchedRepoDto,
} from "@pr-peek/core";
import { vi } from "vitest";

// Requests with no fake. Checked after each test (setup.ts), since the app catches the error.
export const unknownRequests: string[] = [];

// Fake answers, keyed like "GET /api/me". A promise holds the request open.
export type Handlers = Record<string, () => Response | Promise<Response>>;

// Fakes the API.
export function fakeApi(handlers: Handlers) {
  const fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${url}`;
    const handler = handlers[key];
    if (!handler) {
      unknownRequests.push(key);
      return Promise.reject(new Error(`No fake for ${key}`));
    }
    return Promise.resolve(handler());
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

// The calls the fake got for `url`.
export const callsTo = (fetch: ReturnType<typeof fakeApi>, url: string) =>
  fetch.mock.calls.filter(([calledUrl]) => calledUrl === url);

// The JSON bodies the fake got for `key`, like "POST /api/repos".
export const sentBodies = (fetch: ReturnType<typeof fakeApi>, key: string) =>
  fetch.mock.calls
    .filter(([url, init = {}]) => `${init.method ?? "GET"} ${url}` === key)
    .map(([, init]) => JSON.parse(init!.body as string) as unknown);

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status });

export const apiError = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

export const signedOut = () =>
  apiError(401, "unauthorized", "Sign in required");

let itemCount = 0;

// A PR numbered and titled after the row count, so each row's text differs.
const prRef = (): ItemDto["pr"] => ({
  id: `pr-${itemCount}`,
  title: `PR ${itemCount}`,
  owner: "acme",
  repo: "web-app",
  number: itemCount,
  url: `https://github.com/acme/web-app/pull/${itemCount}`,
  author: "sam",
  color: null,
});

export const item = (fields: Partial<ItemDto> = {}): ItemDto => {
  itemCount += 1;
  return {
    id: `item-${itemCount}`,
    kind: "review_requested",
    summary: "jlee asked for your review",
    actorLogin: "jlee",
    actorIsBot: false,
    occurredAt: "2026-10-21T10:00:00.000Z",
    waitingSince: "2026-10-21T10:00:00.000Z",
    age: "2h",
    staleLevel: "fresh",
    severity: "normal",
    unseen: false,
    otherIds: [],
    pr: prRef(),
    ...fields,
  };
};

export const idlePr = (fields: Partial<IdlePrDto> = {}): IdlePrDto => {
  itemCount += 1;
  return {
    id: `pr-${itemCount}`,
    isDraft: false,
    age: "1d",
    pr: prRef(),
    ...fields,
  };
};

export const groups = (fields: Partial<ItemsResponse> = {}): ItemsResponse => ({
  review: [],
  replies: [],
  mine: [],
  idlePrs: [],
  quiet: { items: [], idlePrs: [] },
  ...fields,
});

let repoCount = 0;

export const watchedRepo = (
  fields: Partial<WatchedRepoDto> = {},
): WatchedRepoDto => {
  repoCount += 1;
  return {
    id: `repo-${repoCount}`,
    githubRepoId: repoCount,
    owner: "acme",
    name: `repo-${repoCount}`,
    enabled: true,
    muted: false,
    color: null,
    colorOn: false,
    ...fields,
  };
};

export const repoOption = (fields: Partial<RepoOption> = {}): RepoOption => {
  repoCount += 1;
  return {
    githubRepoId: repoCount,
    owner: "acme",
    name: `repo-${repoCount}`,
    isPrivate: false,
    ...fields,
  };
};

let deviceCount = 0;

export const device = (
  fields: Partial<PushSubscriptionDto> = {},
): PushSubscriptionDto => {
  deviceCount += 1;
  return {
    id: `device-${deviceCount}`,
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${deviceCount}`,
    label: `Device ${deviceCount}`,
    minSeverity: "low",
    lastSuccessAt: null,
    createdAt: "2026-10-21T10:00:00.000Z",
    ...fields,
  };
};

export const searchResults = (
  repos: RepoOption[] = [],
  nextCursor: string | null = null,
): SearchReposResponse => ({ repos, nextCursor });

export const syncStatus = (
  fields: Partial<SyncStatusResponse> = {},
): SyncStatusResponse => ({
  lastSyncedAt: null,
  syncError: null,
  running: false,
  ...fields,
});

export const summary = (
  fields: Partial<SummaryResponse> = {},
): SummaryResponse => ({
  total: 0,
  review: 0,
  replies: 0,
  mine: 0,
  hasStale: false,
  hasFailing: false,
  ...fields,
});

export const noContent = () => new Response(null, { status: 204 });

// What signed in pages ask for, including the settings the settings tabs load, and the
// Mac menu bar app's heartbeat.
export const signedInApi = (overrides: Handlers = {}): Handlers => ({
  "GET /api/me": () => json(me()),
  "GET /api/summary": () => json(summary()),
  "GET /api/settings": () => json(settingsResponse()),
  "POST /api/desktop/heartbeat": () => noContent(),
  ...overrides,
});

// The default settings, and every rule at its defaults.
export const settingsResponse = (
  fields: Partial<UserSettingsDto> = {},
): SettingsResponse => ({
  settings: {
    timezone: "UTC",
    staleWarnHours: 4,
    staleLateHours: 24,
    workHoursOnly: false,
    remindEveryHours: null,
    quietStart: null,
    quietEnd: null,
    quietWeekends: false,
    highBreaksQuiet: false,
    digestTime: null,
    hideBots: false,
    includeTeamRequests: true,
    showAuthors: "off",
    ...fields,
  },
  rules: rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    group: rule.group,
    defaultSeverity: rule.defaultSeverity,
    defaultChannels: rule.defaultChannels,
    enabled: true,
    severity: rule.defaultSeverity,
    channels: rule.defaultChannels,
    options: {},
  })),
});

// What the list page asks for: a signed in user with nothing to show.
export const listApi = (overrides: Handlers = {}): Handlers => ({
  ...signedInApi(),
  "GET /api/items": () => json(groups()),
  "POST /api/items/seen": noContent,
  "GET /api/sync/status": () => json(syncStatus()),
  "GET /api/repos": () => json({ repos: [watchedRepo()] }),
  ...overrides,
});

export const me = (
  fields: Partial<Omit<MeResponse, "user">> = {},
): MeResponse => ({
  user: {
    id: "u1",
    login: "octocat",
    name: "The Octocat",
    avatarUrl: null,
    scopes: ["repo", "read:org"],
  },
  githubToken: null,
  needsReauth: false,
  ...fields,
});
