import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { cx } from "../cx";
import styles from "./Button.module.css";

interface Look {
  // "link": reads as a link in a sentence, for an action that doesn't need a box.
  variant?: "primary" | "secondary" | "link" | undefined;
  wide?: boolean | undefined;
}

const classes = ({ variant = "secondary", wide = false }: Look) =>
  cx(
    styles.button,
    variant === "primary" && styles.primary,
    variant === "link" && styles.link,
    wide && styles.wide,
  );

export function Button({
  variant,
  wide,
  type = "button",
  className,
  ...props
}: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(classes({ variant, wide }), className)}
      {...props}
    />
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
