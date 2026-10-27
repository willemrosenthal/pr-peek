import { expect, it } from "vitest";
import { orderSections } from "./sections";

const groups = (order: string) =>
  orderSections(order).map((section) => section.group);

it("keeps the default order when none is saved", () => {
  expect(groups("")).toEqual(["review", "replies", "assigned", "mine"]);
});

it("follows the saved order", () => {
  expect(groups("mine,assigned,replies,review")).toEqual([
    "mine",
    "assigned",
    "replies",
    "review",
  ]);
});

it("puts sections the order leaves out at the end, in their default order", () => {
  expect(groups("mine,replies")).toEqual([
    "mine",
    "replies",
    "review",
    "assigned",
  ]);
});

it("ignores names it doesn't know", () => {
  expect(groups("old,mine")).toEqual(["mine", "review", "replies", "assigned"]);
});
