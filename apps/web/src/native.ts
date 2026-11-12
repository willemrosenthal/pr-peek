import { registerPlugin } from "@capacitor/core";

// The iPhone app's plugins (plan 12). Only loaded inside the app, with import(), so the
// web app's own bundle stays free of Capacitor.
export { PushNotifications } from "@capacitor/push-notifications";

// The app's own plugin (AppPlugin.swift).
interface PrPeekPlugin {
  // Whether it's an Xcode build, which only Apple's sandbox push service reaches.
  build(): Promise<{ sandbox: boolean }>;
  // The count on the app's icon. 0 clears it.
  setBadge(options: { count: number }): Promise<void>;
}

export const PrPeek = registerPlugin<PrPeekPlugin>("PrPeek");
