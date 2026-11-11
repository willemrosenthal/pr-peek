import type { ListSection, ShowAuthors } from "@pr-peek/core";
import { localSetting } from "./localSetting";

// The list's sections, in their default order. Quiet always comes last, so it's not here.
export const SECTIONS: { group: ListSection; title: string }[] = [
  { group: "review", title: "Needs my review" },
  { group: "replies", title: "Replies to me" },
  { group: "assigned", title: "Assigned to me" },
  { group: "mine", title: "My PRs" },
  { group: "watching", title: "Watching" },
];

// Kept on this device, like collapsed sections. Saved as text, like "mine,review",
// since local settings must be primitives. An empty string means the default order.
export const sectionOrder = localSetting<string>(
  "pr-peek:section-order",
  "",
  (value): value is string => typeof value === "string",
);

// The sections in the saved order. Ones the order doesn't name, like a section added
// after it was saved, go at the end in their default order.
export function orderSections(order: string) {
  const saved = order.split(",");
  const at = ({ group }: (typeof SECTIONS)[number]) => saved.indexOf(group);
  return [
    ...SECTIONS.filter((section) => at(section) !== -1).sort(
      (a, b) => at(a) - at(b),
    ),
    ...SECTIONS.filter((section) => at(section) === -1),
  ];
}

export const saveSectionOrder = (groups: ListSection[]) =>
  sectionOrder.set(groups.join(","));

// Whether a section's rows show their authors' pictures.
export const showsAuthors = (setting: ShowAuthors, group: ListSection) =>
  setting === "all" || (setting === "review" && group === "review");
