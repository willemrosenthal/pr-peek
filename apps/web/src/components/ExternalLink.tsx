import type { ReactNode } from "react";

// A link to another site, opened in a new tab (in the Mac app, the browser).
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
