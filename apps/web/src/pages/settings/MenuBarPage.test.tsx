import { cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
import { coloredIcon, countStyle } from "../../desktop";
import { fakeApi, signedInApi } from "../../test/fake-api";
import { renderApp } from "../../test/render";
import { callsOf, stubTauri } from "../../test/tauri";

it("opens Menu bar from the home screen, only inside the Mac app", async () => {
  stubTauri({ launch_at_login: true });
  fakeApi(signedInApi());
  renderApp("/settings");
  await userEvent.click(await screen.findByRole("link", { name: /^Menu bar/ }));
  expect(await screen.findByRole("heading", { name: "Menu bar" })).toBeTruthy();
});

it("sets the menu bar count and icon color, only inside the Mac app", async () => {
  fakeApi(signedInApi());
  const { router } = renderApp("/settings/menu-bar");
  await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));
  expect(screen.queryByRole("link", { name: /^Menu bar/ })).toBe(null);
  expect(screen.queryByLabelText("Menu bar count")).toBe(null);
  cleanup();

  stubTauri({ launch_at_login: true });
  renderApp("/settings/menu-bar");
  const select = await screen.findByLabelText("Menu bar count");
  expect(select).toHaveProperty("value", "total");
  await userEvent.selectOptions(select, "A dot");
  expect(select).toHaveProperty("value", "dot");
  expect(countStyle.get()).toBe("dot");

  const colored = screen.getByRole("switch", { name: "Colored icon" });
  expect(colored.getAttribute("aria-checked")).toBe("true");
  await userEvent.click(colored);
  expect(coloredIcon.get()).toBe(false);
});

it("turns launching at login off, only inside the Mac app", async () => {
  fakeApi(signedInApi());
  renderApp("/settings/menu-bar");
  await screen.findByRole("heading", { name: "Settings" });
  expect(screen.queryByRole("switch", { name: "Launch at login" })).toBe(null);
  cleanup();

  const invoke = stubTauri({ launch_at_login: true });
  renderApp("/settings/menu-bar");
  const toggle = await screen.findByRole("switch", { name: "Launch at login" });
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));

  await userEvent.click(toggle);
  expect(callsOf(invoke, "set_launch_at_login")).toEqual([{ on: false }]);
});
