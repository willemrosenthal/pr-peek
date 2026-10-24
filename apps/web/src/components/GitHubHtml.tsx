import { createElement, Fragment, useMemo, type ReactNode } from "react";
import { cx } from "../cx";
import styles from "./GitHubHtml.module.css";

// Tags kept from GitHub's HTML. Others are unwrapped: their text stays, the tag goes.
const TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

// Dropped with everything in them.
const DROPPED = new Set([
  "audio",
  "button",
  "embed",
  "form",
  "iframe",
  "math",
  "noscript",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);

const EMPTY = new Set(["br", "hr", "img", "input"]);

// Tables can't hold text between their rows and cells.
const TABLE_PARTS = new Set(["table", "thead", "tbody", "tr"]);

const ALIGNS = new Set(["left", "center", "right"]);

// GitHub's syntax colors, as our classes. Other classes are dropped.
const SYNTAX: Record<string, string | undefined> = {
  "pl-k": styles.keyword,
  "pl-s": styles.string,
  "pl-pds": styles.string,
  "pl-sr": styles.string,
  "pl-c": styles.comment,
  "pl-en": styles.entity,
  "pl-e": styles.entity,
  "pl-ent": styles.entity,
  "pl-c1": styles.constant,
  "pl-v": styles.variable,
};

// The class for a span GitHub colored, if any.
const syntaxClass = (el: Element) =>
  Array.from(el.classList, (name) => SYNTAX[name]).find(Boolean);

// An http(s) link, or mailto: when allowed. Relative links are GitHub's.
function safeUrl(value: string | null, protocols: string[]): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://github.com");
    return protocols.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// The few attributes kept for each tag. Null drops the element.
function propsFor(el: Element, tag: string): Record<string, unknown> | null {
  switch (tag) {
    case "a": {
      const href = safeUrl(el.getAttribute("href"), [
        "https:",
        "http:",
        "mailto:",
      ]);
      return href ? { href, target: "_blank", rel: "noopener noreferrer" } : {};
    }
    case "img": {
      const src = safeUrl(el.getAttribute("src"), ["https:"]);
      if (!src) return null;
      // Keeps emoji like :shipit: at text size. CSS still fits big images.
      const size = (name: string) => {
        const value = Number.parseInt(el.getAttribute(name) ?? "", 10);
        return Number.isInteger(value) ? { [name]: value } : {};
      };
      return {
        src,
        alt: el.getAttribute("alt") ?? "",
        loading: "lazy",
        ...size("width"),
        ...size("height"),
      };
    }
    case "input":
      // Task list boxes. Ticking them happens on GitHub.
      return el.getAttribute("type") === "checkbox"
        ? {
            type: "checkbox",
            disabled: true,
            defaultChecked: el.hasAttribute("checked"),
          }
        : null;
    case "ol": {
      // NaN when there's no start, so the list counts from 1.
      const start = Number.parseInt(el.getAttribute("start") ?? "", 10);
      return Number.isInteger(start) ? { start } : {};
    }
    case "th":
    case "td": {
      const align = el.getAttribute("align");
      return align && ALIGNS.has(align) ? { style: { textAlign: align } } : {};
    }
    case "span": {
      const className = syntaxClass(el);
      return className ? { className } : {};
    }
    case "div":
      // The box around a permalink to code, and its header with the file and lines.
      if (el.classList.contains("rounded-1")) {
        return { className: styles.embed };
      }
      if (el.classList.contains("color-bg-subtle")) {
        return { className: styles.embedHead };
      }
      return {};
    default:
      return {};
  }
}

// GitHub shows lines of code from a permalink or a suggested change as a table, one
// row per line, with the line number in an attribute. This makes it a code block with
// the numbers showing, and added or removed lines colored.
function codeLines(table: Element, key: number): ReactNode {
  const lines = Array.from(table.querySelectorAll("tr")).flatMap((row) => {
    const code = row.querySelector("td.blob-code");
    if (!code) return [];
    // A suggested change has old and new numbers. The last one is the line's.
    const numbers = row.querySelectorAll("td[data-line-number]");
    const number =
      numbers[numbers.length - 1]?.getAttribute("data-line-number") ?? "";
    const change = code.classList.contains("blob-code-addition")
      ? styles.added
      : code.classList.contains("blob-code-deletion")
        ? styles.removed
        : undefined;
    return [{ code, number, change }];
  });
  return (
    <div key={key} className={styles.lines}>
      {lines.map(({ code, number, change }, i) => (
        <div key={i} className={cx(styles.line, change)}>
          <span className={styles.lineNumber} aria-hidden="true">
            {number}
          </span>
          <code className={styles.lineCode}>
            {Array.from(code.childNodes, (child, j) => toReact(child, j))}
          </code>
        </div>
      ))}
    </div>
  );
}

function toReact(node: Node, key: number, parentTag = ""): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return TABLE_PARTS.has(parentTag) && !text.trim() ? null : text;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROPPED.has(tag)) return null;
  if (tag === "table" && el.querySelector("td.blob-code")) {
    return codeLines(el, key);
  }
  const children = () =>
    Array.from(el.childNodes, (child, i) => toReact(child, i, tag));
  if (!TAGS.has(tag)) return createElement(Fragment, { key }, ...children());

  const props = propsFor(el, tag);
  if (!props) return null;
  return createElement(
    tag,
    { ...props, key },
    ...(EMPTY.has(tag) ? [] : children()),
  );
}

// GitHub's HTML for a description or comment, styled like GitHub shows it. It's read
// with DOMParser, which runs nothing and loads nothing, and only safe tags and
// attributes are kept, so no HTML is ever injected.
export function GitHubHtml({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const content = useMemo(() => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.body.childNodes, (node, i) => toReact(node, i));
  }, [html]);
  return <div className={cx(styles.html, className)}>{content}</div>;
}
