import { registerPlugin } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import type { Haptic } from "./haptics";

// The iPhone app's plugins (plan 12). Only loaded inside the app, with import(), so the
// web app's own bundle stays free of Capacitor.
export { PushNotifications } from "@capacitor/push-notifications";

// The app's own plugin (AppPlugin.swift).
interface PrPeekPlugin {
  // Whether it's an Xcode build, which only Apple's sandbox push service reaches.
  build(): Promise<{ sandbox: boolean }>;
  // The count on the app's icon. 0 clears it.
  setBadge(options: { count: number }): Promise<void>;
  // Opens the app's notification settings in iPhone Settings.
  openSettings(): Promise<void>;
}

export const PrPeek = registerPlugin<PrPeekPlugin>("PrPeek");

// A tick from the phone's own haptics (haptics.ts).
export async function nativeHaptic(kind: Haptic) {
  switch (kind) {
    case "firm":
      return Haptics.impact({ style: ImpactStyle.Medium });
    case "light":
      return Haptics.impact({ style: ImpactStyle.Light });
    case "selection":
      // A single tick needs the start and end around it.
      await Haptics.selectionStart();
      await Haptics.selectionChanged();
      return Haptics.selectionEnd();
    case "success":
      return Haptics.notification({ type: NotificationType.Success });
  }
}
