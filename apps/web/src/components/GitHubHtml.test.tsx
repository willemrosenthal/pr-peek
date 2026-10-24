import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { GitHubHtml } from "./GitHubHtml";

const html = (source: string) =>
  render(<GitHubHtml html={source} />).container.firstElementChild!.innerHTML;

it("keeps GitHub's formatting", () => {
  const source =
    "<h2>Why</h2><p>Uses <code>fetch</code> and <strong>retries</strong>.</p>" +
    "<pre><code>const a = 1;\n</code></pre><ul><li>One</li></ul>" +
    "<blockquote><p>Quote</p></blockquote>";
  expect(html(source)).toBe(source);
});

it("drops scripts, handlers, styles, and classes", () => {
  expect(
    html(
      '<p class="x" style="color:red" onclick="steal()">Hi</p>' +
        "<script>steal()</script><iframe src='https://evil.example'></iframe>",
    ),
  ).toBe("<p>Hi</p>");
});

it("opens links in a new tab, and drops unsafe ones", () => {
  expect(html('<a href="/acme/web-app/pull/7">#7</a>')).toBe(
    '<a href="https://github.com/acme/web-app/pull/7" target="_blank" rel="noopener noreferrer">#7</a>',
  );
  expect(html('<a href="javascript:steal()">Click</a>')).toBe("<a>Click</a>");
});

it("keeps https images only", () => {
  expect(html('<img src="https://example.com/a.png" alt="Shot">')).toBe(
    '<img src="https://example.com/a.png" alt="Shot" loading="lazy">',
  );
  expect(html('<img src="http://example.com/a.png">')).toBe("");
});

it("keeps the text of tags it doesn't know, like GitHub's emoji", () => {
  expect(html('<p><g-emoji alias="tada">🎉</g-emoji> Done</p>')).toBe(
    "<p>🎉 Done</p>",
  );
});

it("shows task list boxes, ticked or not, that can't be changed", () => {
  const out = html(
    '<ul><li><input type="checkbox" checked> Done</li><li><input type="checkbox"> Not yet</li></ul>',
  );
  const boxes = new DOMParser()
    .parseFromString(out, "text/html")
    .querySelectorAll("input");
  expect(boxes).toHaveLength(2);
  expect([...boxes].map((box) => box.disabled)).toEqual([true, true]);
});
