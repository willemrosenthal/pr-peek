import { vi } from "vitest";
import type * as Haptics from "../haptics";

// haptics.ts with `haptic` faked, so a test can read each tick. Use it with
// `vi.mock("<path to>/haptics", () => import("<path to>/test/haptics"))`, and call
// `haptic.mockClear()` first, since the fake keeps its calls between tests.

const actual = await vi.importActual<typeof Haptics>("../haptics");

export const { canTickAnytime, canVibrate } = actual;

export const haptic = vi.fn<typeof actual.haptic>();

// The strength of each tick so far, oldest first.
export const ticks = () => haptic.mock.calls.map(([kind]) => kind);
