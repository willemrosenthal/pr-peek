import { useId, type ReactNode } from "react";
import styles from "./RainbowIcon.module.css";

// A line icon on a 24 by 24 grid, drawn in a rainbow that shifts color. The PR
// preview's marked comment has the same rainbow edge (PrPreview.module.css).
export function RainbowIcon({ children }: { children: ReactNode }) {
  // React's ids have characters that break inside url(#...).
  const gradient = `rainbow${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke={`url(#${gradient})`}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradient}
          gradientUnits="userSpaceOnUse"
          x1="3"
          y1="3"
          x2="21"
          y2="21"
        >
          <stop offset="0" stopColor="#ff3b30" />
          <stop offset="0.25" stopColor="#ff9f0a" />
          <stop offset="0.5" stopColor="#34c759" />
          <stop offset="0.75" stopColor="#0a84ff" />
          <stop offset="1" stopColor="#bf5af2" />
        </linearGradient>
      </defs>
      {children}
    </svg>
  );
}

// The creature from the app icon (public/icon.svg).
export function Mascot() {
  return (
    <RainbowIcon>
      <circle cx="12" cy="9" r="6" />
      <path d="M7.2 12.6c-1 3-4.2 3-4.2 6.4" />
      <path d="M10 14.7c0 2-1 4-3 5.3" />
      <path d="M14 14.7c0 2 1 4 3 5.3" />
      <path d="M16.8 12.6c1 3 4.2 3 4.2 6.4" />
      <path d="M17.7 7.1c2 0 3.3-1.6 3.3-3.6" />
      <path d="M10 8.5h.01" />
      <path d="M14 8.5h.01" />
      <path d="M10.5 11q1.5 1 3 0" />
    </RainbowIcon>
  );
}

// Lucide's arrow-left.
export function BackArrow() {
  return (
    <RainbowIcon>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </RainbowIcon>
  );
}
