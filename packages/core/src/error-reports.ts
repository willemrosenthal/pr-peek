// What the server and the web app hold back from Sentry, their error reports. Shared so
// both keep the same promise as the privacy page.

// Each kind of extra data Sentry can collect, off. Named one by one: an option left out
// can default to on. For Sentry.init's `dataCollection`.
export const NO_EXTRA_DATA = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

// GitHub's own hosts. Their paths name repos and PRs, which can be private.
const GITHUB_HOST =
  /^https?:\/\/(?:[\w-]+\.)*(?:github\.com|githubusercontent\.com)$/;

// A URL without what it could say about someone: no query string or fragment, and just
// the host for GitHub's URLs.
export function cleanUrl(url: string): string {
  const [path = ""] = url.split(/[?#]/);
  const origin = /^https?:\/\/[^/]+/.exec(path)?.[0];
  return origin && GITHUB_HOST.test(origin) ? origin : path;
}

// The same for every URL or path in a longer text, like a trace's "GET https://…".
export const cleanUrls = (text: string): string =>
  text.replace(/(?:https?:\/\/|\/)[^\s"'<>]*/g, cleanUrl);

type Strings = Record<string, unknown> | undefined;

function cleanValues(values: Strings): void {
  if (!values) return;
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") values[key] = cleanUrls(value);
  }
}

interface Breadcrumb {
  message?: string;
  data?: Strings;
}
// Sentry's streamed spans: `name` is like "GET https://api.github.com/…".
interface Span {
  name: string;
  attributes?: Strings;
}
interface ReportEvent {
  transaction?: string;
  request?: { url?: string };
}

// Sentry.init hooks that clean every URL in what's sent: the steps before an error
// (breadcrumbs), timings (spans), and the error reports themselves.
export const cleanReports = {
  beforeBreadcrumb<T extends Breadcrumb>(breadcrumb: T): T {
    if (breadcrumb.message) breadcrumb.message = cleanUrls(breadcrumb.message);
    cleanValues(breadcrumb.data);
    return breadcrumb;
  },
  beforeSendSpan<T extends Span>(span: T): T {
    span.name = cleanUrls(span.name);
    cleanValues(span.attributes);
    return span;
  },
  beforeSend<T extends ReportEvent>(event: T): T {
    if (event.transaction) event.transaction = cleanUrls(event.transaction);
    if (event.request?.url) event.request.url = cleanUrl(event.request.url);
    return event;
  },
};
