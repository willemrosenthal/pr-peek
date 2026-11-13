import { EXPIRING_DAYS, type AdminOverviewResponse } from "@pr-peek/core";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  DAY_MS,
  egressPace,
  fillSeries,
  formatBytes,
  formatCount,
  formatMs,
  HOUR_MS,
  readings,
  startOfDay,
  startOfHour,
  sum,
  type Reading,
} from "../../admin";
import { ApiError } from "../../api";
import { Alert } from "../../components/Alert";
import { BarChart, type Bar } from "../../components/BarChart";
import { Segmented } from "../../components/Segmented";
import { cx } from "../../cx";
import { useAdminOverview, useSignUpRequests } from "../../queries";
import styles from "./AdminPage.module.css";
import { AdminTests } from "./AdminTests";
import { SignUpRequests } from "./SignUpRequests";
import { SettingsPage } from "./SettingsLayout";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const dayLabel = (at: Date) => `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;

const TABS = ["sign-ups", "stats", "tests"] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | null): value is Tab =>
  TABS.includes(value as Tab);

// Sign-up requests, how Git Buddy is running and what it costs, and test notifications,
// each in its own tab. The tab is in the URL, so a reload stays on it. Admins only:
// Settings only links here for them, and the server answers 404 to anyone else.
export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab = isTab(asked) ? asked : "sign-ups";
  const requests = useSignUpRequests();
  const waiting = requests.data?.requests.length ?? 0;
  // Keeps the other params, like the menu bar app's `shell=tray`.
  const show = (next: Tab) =>
    setParams(
      (current) => {
        current.set("tab", next);
        return current;
      },
      { replace: true },
    );

  if (requests.error instanceof ApiError && requests.error.status === 404) {
    return (
      <SettingsPage title="Admin">
        <Alert>Only admins can see this.</Alert>
      </SettingsPage>
    );
  }
  return (
    <SettingsPage title="Admin">
      <Segmented
        label="Admin section"
        value={tab}
        options={[
          {
            value: "sign-ups",
            label: waiting > 0 ? `Sign-ups (${waiting})` : "Sign-ups",
          },
          { value: "stats", label: "Stats" },
          { value: "tests", label: "Tests" },
        ]}
        onChange={show}
      />
      {tab === "sign-ups" && <SignUpRequests />}
      {tab === "stats" && <Stats />}
      {tab === "tests" && <AdminTests />}
    </SettingsPage>
  );
}

function Stats() {
  const overview = useAdminOverview();
  return (
    <>
      <p className={styles.hint}>
        How Git Buddy is running, and what it costs. Days and hours are UTC.
      </p>
      {overview.isPending && <p className={styles.hint}>Loading</p>}
      {overview.isError && <Alert>{overview.error.message}</Alert>}
      {overview.data && <Overview overview={overview.data} />}
    </>
  );
}

function Overview({ overview }: { overview: AdminOverviewResponse }) {
  return (
    <div className={styles.overview}>
      <section aria-label="At a glance" className={styles.readings}>
        {readings(overview).map((reading) => (
          <ReadingTile key={reading.label} reading={reading} />
        ))}
      </section>
      <Egress overview={overview} />
      <Queries queries={overview.queries} at={overview.at} />
      <Worker overview={overview} />
      <GitHubAndPeople overview={overview} />
    </div>
  );
}

function ReadingTile({ reading }: { reading: Reading }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileTop}>
        <span className={styles.tileLabel}>{reading.label}</span>
        <span className={cx(styles.state, reading.watch && styles.watch)}>
          {reading.watch ? "Worth a look" : "Fine"}
        </span>
      </div>
      <div className={styles.tileValue}>{reading.value}</div>
      <div className={styles.meter} aria-hidden="true">
        <div
          className={cx(styles.meterFill, reading.watch && styles.watch)}
          style={{ width: `${reading.share * 100}%` }}
        />
      </div>
      <div className={styles.hint}>{reading.detail}</div>
      <div className={styles.rule}>{reading.rule}</div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {hint && <p className={styles.hint}>{hint}</p>}
      {children}
    </section>
  );
}

function StatList({ stats }: { stats: [string, string][] }) {
  return (
    <dl className={styles.stats}>
      {stats.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Egress({ overview }: { overview: AdminOverviewResponse }) {
  const { egress } = overview;
  const days = fillSeries(
    egress.days.map((d) => ({ at: d.day, value: d.bytes })),
    startOfDay(new Date(overview.at)),
    30,
    DAY_MS,
  );
  const bars: Bar[] = days.map((d, i) => ({
    key: d.at.toISOString(),
    value: d.value,
    label: i % 7 === 0 ? dayLabel(d.at) : "",
    tip: `${dayLabel(d.at)}: ${formatBytes(d.value)}`,
  }));
  const total = sum(days.map((d) => d.value));
  return (
    <Section
      title="Database egress per day"
      hint={
        <>
          Counted by the server: the bytes Postgres sends it. Supabase&apos;s
          own count is under Usage in the{" "}
          <a href="https://supabase.com/dashboard">Supabase dashboard</a>.
        </>
      }
    >
      <StatList
        stats={[
          ["This month", formatBytes(egress.thisMonth)],
          ["On pace for", formatBytes(egressPace(overview))],
          ["Last month", formatBytes(egress.lastMonth)],
        ]}
      />
      <BarChart
        bars={bars}
        format={formatBytes}
        summary={`Egress per day for the last 30 days, ${formatBytes(total)} in all.`}
      />
      <h4 className={styles.subTitle}>The biggest reads, last 7 days</h4>
      {egress.kinds.length > 0 ? (
        <Table
          head={["Query", "Bytes", "Queries"]}
          rows={egress.kinds.map((k) => [
            <code key="kind">{k.kind}</code>,
            formatBytes(k.bytes),
            formatCount(k.queries),
          ])}
        />
      ) : (
        <p className={styles.hint}>
          Nothing counted yet. Counts are saved once an hour.
        </p>
      )}
    </Section>
  );
}

// Calls per hour since the stats started, as of when the numbers were read (`at`).
function Queries({
  queries,
  at,
}: {
  queries: AdminOverviewResponse["queries"];
  at: string;
}) {
  if (!queries) {
    return (
      <Section title="Busiest queries">
        <p className={styles.hint}>
          Postgres&apos;s query stats (pg_stat_statements) can&apos;t be read on
          this database.
        </p>
      </Section>
    );
  }
  const hours = queries.since
    ? Math.max(
        (new Date(at).getTime() - new Date(queries.since).getTime()) / HOUR_MS,
        1,
      )
    : null;
  return (
    <Section
      title="Busiest queries"
      hint={
        queries.since
          ? `From Postgres's own stats, since ${dayLabel(new Date(queries.since))}.`
          : "From Postgres's own stats."
      }
    >
      <Table
        head={["Query", hours ? "Per hour" : "Calls", "Average", "Rows each"]}
        rows={queries.top.map((q) => [
          <code key="query">{q.query}</code>,
          formatCount(Math.round(hours ? q.calls / hours : q.calls)),
          formatMs(q.meanMs),
          formatCount(Math.round(q.rows / Math.max(q.calls, 1))),
        ])}
      />
    </Section>
  );
}

function Worker({ overview }: { overview: AdminOverviewResponse }) {
  const { worker } = overview;
  const hours = fillSeries(
    worker.hours.map((h) => ({ at: h.hour, value: h.jobs })),
    startOfHour(new Date(overview.at)),
    24,
    HOUR_MS,
  );
  const bars: Bar[] = hours.map((h, i) => ({
    key: h.at.toISOString(),
    value: h.value,
    label: i === 0 ? "24 hours ago" : i === 23 ? "Now" : "",
    tip: `${h.at.getUTCHours()}:00: ${formatCount(h.value)} jobs`,
  }));
  const jobs = sum(worker.queues.map((q) => q.jobs));
  const failed = sum(worker.queues.map((q) => q.failed));
  return (
    <Section
      title="Worker"
      hint="Jobs today, and per hour for the last 24 hours."
    >
      <StatList
        stats={[
          ["Jobs today", formatCount(jobs)],
          ["Failed", formatCount(failed)],
          ["Busiest hour", formatCount(Math.max(...hours.map((h) => h.value)))],
        ]}
      />
      <BarChart
        bars={bars}
        height={120}
        format={formatCount}
        summary={`Jobs per hour for the last 24 hours, ${formatCount(sum(hours.map((h) => h.value)))} in all.`}
      />
      {worker.queues.length > 0 && (
        <Table
          head={["Queue", "Jobs", "Average", "Slowest", "Failed"]}
          rows={worker.queues.map((q) => [
            <code key="queue">{q.queue}</code>,
            formatCount(q.jobs),
            formatMs(q.totalMs / Math.max(q.jobs, 1)),
            formatMs(q.slowestMs),
            formatCount(q.failed),
          ])}
        />
      )}
    </Section>
  );
}

function GitHubAndPeople({ overview }: { overview: AdminOverviewResponse }) {
  const { github, people, tokens, worker } = overview;
  const syncs = worker.queues.find((q) => q.queue === "sync-user")?.jobs ?? 0;
  const pushes = fillSeries(
    people.pushes.map((p) => ({ at: p.day, value: p.sent })),
    startOfDay(new Date(overview.at)),
    14,
    DAY_MS,
  );
  const failed = sum(people.pushes.map((p) => p.failed));
  return (
    <div className={styles.pair}>
      <Section
        title="GitHub today"
        hint="Each person's budget is 5,000 points an hour, shared by their syncs and the repo picker."
      >
        <StatList
          stats={[
            ["Requests", formatCount(github.requests)],
            [
              "Per sync",
              syncs ? (github.syncRequests / syncs).toFixed(1) : "None yet",
            ],
            ["Rate limited", formatCount(github.rateLimited)],
          ]}
        />
      </Section>
      <Section
        title="People and pushes"
        hint={`Pushes sent per day, last 14 days. ${formatCount(failed)} failed.`}
      >
        <StatList
          stats={[
            ["Users", formatCount(people.users)],
            ["Active, last 24 hours", formatCount(people.activeDay)],
            ["Active, last 7 days", formatCount(people.activeWeek)],
          ]}
        />
        <StatList
          stats={[
            ["Tokens working", formatCount(tokens.working)],
            [
              `Expiring within ${EXPIRING_DAYS} days`,
              formatCount(tokens.expiring),
            ],
            ["Tokens stopped", formatCount(tokens.stopped)],
          ]}
        />
        <BarChart
          bars={pushes.map((p) => ({
            key: p.at.toISOString(),
            value: p.value,
            label: "",
            tip: `${dayLabel(p.at)}: ${formatCount(p.value)} pushes`,
          }))}
          height={64}
          format={formatCount}
          summary={`Pushes sent per day for the last 14 days, ${formatCount(sum(pushes.map((p) => p.value)))} in all.`}
        />
      </Section>
    </div>
  );
}
