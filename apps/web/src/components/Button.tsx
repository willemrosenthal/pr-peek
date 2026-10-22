import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface Look {
  variant?: "primary" | "secondary" | undefined;
  wide?: boolean | undefined;
}

const classes = ({ variant = "secondary", wide = false }: Look) =>
  [styles.button, variant === "primary" && styles.primary, wide && styles.wide]
    .filter(Boolean)
    .join(" ");

export function Button({
  variant,
  wide,
  type = "button",
  ...props
}: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={classes({ variant, wide })} {...props} />
  );
}

// A link that looks like a button, for full page navigations like sign in.
export function ButtonLink({
  variant,
  wide,
  ...props
}: Look & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={classes({ variant, wide })} {...props} />;
}
