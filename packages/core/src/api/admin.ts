// From GET /api/admin/overview: how Git Buddy is running, for admins. Days and hours
// are UTC. Times are ISO strings. Each list is small: grouped and limited by the server.
export interface AdminOverviewResponse {
  // When the numbers were read.
  at: string;
  health: {
    dbBytes: number;
    // Rows in pg-boss's job table. Null when it can't be read.
    jobRows: number | null;
    syncingUsers: number;
    // 15 minutes or more past their sync interval.
    lateUsers: number;
    // Failed 3 syncs in a row or more.
    failingUsers: number;
  };
  // The free plans' sizes, and the share of each where a reading is worth a look.
  limits: {
    dbBytes: number;
    dbWatchShare: number;
    egressBytesPerMonth: number;
    egressWatchShare: number;
    // pg-boss keeps about this many job rows, plus this many per syncing user. Worth a
    // look at twice that.
    jobRowsBase: number;
    jobRowsPerUser: number;
    // Worth a look when more than this share of syncing users keep failing.
    failingShare: number;
  };
  egress: {
    // Bytes per day, last 30 days, oldest first. Days with nothing are left out.
    days: { day: string; bytes: number }[];
    thisMonth: number;
    lastMonth: number;
    // The kinds of query that read the most in the last 7 days, most first.
    kinds: { kind: string; bytes: number; queries: number }[];
  };
  // The most frequent queries, from Postgres's own stats. Null when they can't be read.
  queries: {
    // When the stats started counting.
    since: string | null;
    top: { query: string; calls: number; meanMs: number; rows: number }[];
  } | null;
  worker: {
    // Jobs per hour, last 24 hours, oldest first. Hours with none are left out.
    hours: { hour: string; jobs: number }[];
    // Today, per queue, most jobs first.
    queues: {
      queue: string;
      jobs: number;
      totalMs: number;
      slowestMs: number;
      failed: number;
    }[];
  };
  // Today.
  github: {
    requests: number;
    // Made by the worker's syncs, without the web service's, like the repo picker.
    syncRequests: number;
    // The lowest budget left on any request. Null before any request today.
    lowestBudget: number | null;
    rateLimited: number;
  };
  people: {
    users: number;
    // Opened the app in the last 24 hours, and the last 7 days.
    activeDay: number;
    activeWeek: number;
    // Pushes per day, last 14 days, oldest first. Days with none are left out.
    pushes: { day: string; sent: number; failed: number }[];
  };
}

// From POST /api/admin/test-alert.
export interface TestAlertResponse {
  // Whether any of the admin's devices, or the Mac app, got it.
  sent: boolean;
}
