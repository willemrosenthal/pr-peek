import { useSyncExternalStore } from "react";
import { getCountStyle, subscribeCountStyle } from "../desktop";

// The menu bar count style, shared by every component that reads it.
export const useCountStyle = () =>
  useSyncExternalStore(subscribeCountStyle, getCountStyle);
