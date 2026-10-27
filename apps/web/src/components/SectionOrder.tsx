import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ItemGroup } from "@pr-peek/core";
import { GripVertical } from "lucide-react";
import { cx } from "../cx";
import { useLocalSetting } from "../localSetting";
import {
  orderSections,
  saveSectionOrder,
  SECTIONS,
  sectionOrder,
} from "../sections";
import styles from "./SectionOrder.module.css";

const titleOf = (id: string | number) =>
  SECTIONS.find((section) => section.group === id)?.title ?? String(id);

// What screen readers hear while moving a section with the keyboard.
const announcements: Announcements = {
  onDragStart: ({ active }) =>
    `Picked up ${titleOf(active.id)}. Use the arrow keys to move it.`,
  onDragOver: ({ active, over }) =>
    over ? `${titleOf(active.id)} is over ${titleOf(over.id)}.` : undefined,
  onDragEnd: ({ active, over }) =>
    over ? `Dropped ${titleOf(active.id)}.` : undefined,
  onDragCancel: ({ active }) => `Put ${titleOf(active.id)} back.`,
};

// The list's sections as rows you drag by their handle. Quiet always stays last.
export function SectionOrder() {
  const sections = orderSections(useLocalSetting(sectionOrder));
  const groups = sections.map((section) => section.group);
  const sensors = useSensors(
    // A small move starts a drag, so a tap on the handle doesn't.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = groups.indexOf(active.id as ItemGroup);
    const to = groups.indexOf(over.id as ItemGroup);
    saveSectionOrder(arrayMove(groups, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Press space to pick up a section. Use the arrow keys to move it, space to drop it, or escape to cancel.",
        },
      }}
    >
      <SortableContext items={groups} strategy={verticalListSortingStrategy}>
        <ol className={styles.list} aria-label="Section order">
          {sections.map(({ group, title }) => (
            <SectionRow key={group} group={group} title={title} />
          ))}
          <li className={cx(styles.row, styles.fixed)}>Quiet</li>
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SectionRow({ group, title }: { group: ItemGroup; title: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group });
  return (
    <li
      ref={setNodeRef}
      className={cx(styles.row, isDragging && styles.dragging)}
      // Moves up and down only.
      style={{
        transform: CSS.Translate.toString(transform && { ...transform, x: 0 }),
        transition,
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.handle}
        aria-label={`Move ${title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      {title}
    </li>
  );
}
