import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { GitHubHtml } from "./GitHubHtml";
import styles from "./GitHubHtml.module.css";

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

// The parts of a rendered permalink's lines: number and code text.
function codeRows(container: Element) {
  return Array.from(container.querySelectorAll(`.${styles.line}`), (line) => [
    line.children[0]!.textContent,
    line.children[1]!.textContent,
  ]);
}

it("shows a permalink to code as numbered lines, under its file", () => {
  const { container, getByRole } = render(
    <GitHubHtml
      html={
        '<div class="border rounded-1 my-2">' +
        '<div class="f6 px-3 py-2 border-bottom color-bg-subtle">' +
        '<p class="mb-0 text-bold"><a href="https://github.com/acme/web-app/blob/99dc791/a.test.ts#L335-L336">a.test.ts</a></p>' +
        '<p class="mb-0 color-fg-muted">Lines 335 to 336 in <tt>99dc791</tt></p>' +
        "</div>" +
        '<div class="Box-body p-0 blob-wrapper"><table class="highlight"><tbody>' +
        '<tr><td class="blob-num" data-line-number="335"></td>' +
        '<td class="blob-code blob-code-inner"><span class="pl-en">it</span>(<span class="pl-s">\'works\'</span>, () =&gt; {</td></tr>\n' +
        '<tr><td class="blob-num" data-line-number="336"></td>' +
        '<td class="blob-code blob-code-inner">  // act</td></tr>' +
        "</tbody></table></div></div>"
      }
    />,
  );
  expect(container.querySelector(`.${styles.embed}`)).toBeTruthy();
  expect(container.querySelector(`.${styles.embedHead}`)?.textContent).toBe(
    "a.test.tsLines 335 to 336 in 99dc791",
  );
  expect(getByRole("link", { name: "a.test.ts" })).toBeTruthy();
  expect(container.querySelector("table")).toBeNull();
  expect(codeRows(container)).toEqual([
    ["335", "it('works', () => {"],
    ["336", "  // act"],
  ]);
  expect(container.querySelector(`.${styles.entity}`)?.textContent).toBe("it");
  expect(container.querySelector(`.${styles.string}`)?.textContent).toBe(
    "'works'",
  );
});

it("colors a suggested change's removed and added lines", () => {
  const { container } = render(
    <GitHubHtml
      html={
        "<table><tbody>" +
        '<tr><td class="blob-num" data-line-number="4"></td><td class="blob-num"></td>' +
        '<td class="blob-code blob-code-deletion">old</td></tr>' +
        '<tr><td class="blob-num"></td><td class="blob-num" data-line-number="4"></td>' +
        '<td class="blob-code blob-code-addition">new</td></tr>' +
        "</tbody></table>"
      }
    />,
  );
  const lines = container.querySelectorAll(`.${styles.line}`);
  expect(lines[0]!.className).toContain(styles.removed);
  expect(lines[1]!.className).toContain(styles.added);
  expect(codeRows(container)).toEqual([
    ["4", "old"],
    ["4", "new"],
  ]);
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
