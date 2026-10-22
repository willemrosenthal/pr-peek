import { vi } from "vitest";

// Stands in for the browser's EventSource. Tests send events with `dispatchEvent`.
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;

  constructor(readonly url: string) {
    super();
    FakeEventSource.opened.push(this);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

// Installs the fake. setup.ts does this before each test.
export function fakeStream() {
  FakeEventSource.opened = [];
  vi.stubGlobal("EventSource", FakeEventSource);
}

// The stream opened most recently.
export const latestStream = () => FakeEventSource.opened.at(-1)!;
