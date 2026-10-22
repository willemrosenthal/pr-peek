import { useSyncExternalStore } from "react";
import {
  detectPlatform,
  getInstallState,
  isStandalone,
  subscribeInstall,
} from "../install";

// Whether the app is installed here, and how to install it if not.
export function useInstall() {
  const { offer, installed } = useSyncExternalStore(
    subscribeInstall,
    getInstallState,
  );
  return {
    installed: installed || isStandalone(),
    canPrompt: offer !== null,
    platform: detectPlatform(),
  };
}
