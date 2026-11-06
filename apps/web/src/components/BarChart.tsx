import styles from "./BarChart.module.css";

export interface Bar {
  key: string;
  value: number;
  // Shown under the bar. Empty for most, so labels don't crowd.
  label: string;
  // Shown on hover, like "21 Oct: 8 MB".
  tip: string;
}

// The top of the scale: 1, 2, or 5 times a power of ten, at or above `max`.
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find((m) => m * power >= max) ?? 10;
  return step * power;
}

// A small bar chart, one series, with its scale on the left. No chart library: the
// admin page needs only this.
export function BarChart({
  bars,
  summary,
  format = String,
  height = 160,
}: {
  bars: Bar[];
  // Read out in place of the chart, like "8 MB a day, down from 100".
  summary: string;
  format?: (value: number) => string;
  height?: number;
}) {
  const top = niceMax(Math.max(...bars.map((bar) => bar.value), 0));
  return (
    <figure className={styles.chart}>
      <div className={styles.plot} role="img" aria-label={summary}>
        <div className={styles.scale} style={{ height }} aria-hidden="true">
          <span>{format(top)}</span>
          <span>{format(top / 2)}</span>
          <span>0</span>
        </div>
        <div className={styles.columns}>
          <div className={styles.bars} style={{ height }}>
            {bars.map((bar) => (
              <div key={bar.key} className={styles.slot} title={bar.tip}>
                <div
                  className={styles.bar}
                  style={{ height: `${(bar.value / top) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className={styles.labels} aria-hidden="true">
            {bars.map((bar) => (
              <span key={bar.key}>{bar.label}</span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
