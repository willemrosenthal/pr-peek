import type { CapacitorConfig } from "@capacitor/cli";

// The iPhone app: a native shell around the hosted web app, like the Mac app (plan 12).
const config: CapacitorConfig = {
  // Never change it: the App Store, TestFlight, and push all know the app by it.
  appId: "com.git-buddy.pr-peek",
  appName: "Git Buddy",
  // The page shown when the hosted app can't load, like offline (errorPath).
  webDir: "www",
  server: {
    // The app loads the live site, so UI changes ship with each deploy. `shell=ios`
    // tells the web app it's inside the iPhone app.
    url: "https://www.git-buddy.com/?shell=ios",
    // Pages that load inside the app. GitHub's are for signing in, which has to happen
    // here so the session cookie lands in the app. Anything else opens in Safari, and
    // the web app sends links to PRs there too (ios.ts).
    allowNavigation: ["github.com"],
    // Without it, a failed load leaves a blank screen.
    errorPath: "index.html",
  },
  ios: {
    // Keeps the page clear of the notch and the home bar.
    contentInset: "always",
    // Under the page while it loads, and behind the notch: the app's gray (tokens.css).
    backgroundColor: "#f2f2f5",
    // A long press on a row opens Git Buddy's PR preview, not iOS's link preview.
    allowsLinkPreview: false,
  },
  plugins: {
    PushNotifications: {
      // Shows a notification that arrives while the app is open, like when it's closed.
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
