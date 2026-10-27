import type { ItemGroup } from "@pr-peek/core";
import { localSetting } from "./localSetting";

// The list's sections, in their default order. Quiet always comes last, so it's not here.
export const SECTIONS: { group: ItemGroup; title: string }[] = [
  { group: "review", title: "Needs my review" },
  { group: "replies", title: "Replies to me" },
  { group: "assigned", title: "Assigned to me" },
  { group: "mine", title: "My PRs" },
];

// Kept on this device, like collapsed sections. Saved as text, like "mine,review",
// since local settings must be primitives. An empty string means the default order.
export const sectionOrder = localSetting<string>(
  "pr-peek:section-order",
  "",
  (value): value is string => typeof value === "string",
);

// The sections in the saved order. Ones the order doesn't name, like a section added
// after it was saved, keep their default place at the end.
export function orderSections(order: string) {
  const saved = order.split(",");
  const rank = (group: ItemGroup) => {
    const at = saved.indexOf(group);
    return at === -1 ? saved.length + SECTIONS.length : at;
  };
  return SECTIONS.map((section, i) => ({ section, i }))
    .sort((a, b) => rank(a.section.group) - rank(b.section.group) || a.i - b.i)
    .map(({ section }) => section);
}

export const saveSectionOrder = (groups: ItemGroup[]) =>
  sectionOrder.set(groups.join(","));
