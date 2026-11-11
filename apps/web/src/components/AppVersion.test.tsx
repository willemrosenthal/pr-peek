import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AppVersion } from "./AppVersion";

const commit = "cb85fd4a1b2c3d4e5f60718293a4b5c6d7e8f901";

it("shows the version, and links the commit to GitHub", () => {
  render(<AppVersion build={{ version: "1.2.0", after: "", commit }} />);
  expect(screen.getByText(/Version 1\.2\.0/)).toBeTruthy();
  const link = screen.getByRole("link", { name: "cb85fd4" });
  expect(link.getAttribute("href")).toBe(
    `https://github.com/willemrosenthal/pr-peek/commit/${commit}`,
  );
});

it("shows the commit and the last release before it, between releases", () => {
  const { container } = render(
    <AppVersion build={{ version: "", after: "1.2.0", commit }} />,
  );
  expect(container.textContent).toBe("Build cb85fd4, after 1.2.0");
});

it("shows just the commit when the build can't see any release", () => {
  const { container } = render(
    <AppVersion build={{ version: "", after: "", commit }} />,
  );
  expect(container.textContent).toBe("Build cb85fd4");
});

it("shows nothing without a commit", () => {
  const { container } = render(
    <AppVersion build={{ version: "", after: "", commit: "" }} />,
  );
  expect(container.textContent).toBe("");
});
