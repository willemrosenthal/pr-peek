import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LucideProvider } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { AppUpdatePrompt } from "./components/AppUpdatePrompt";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { startDesktop } from "./desktop";
import { createRouter } from "./router";
import { applyScale } from "./scale";
// Starts listening for the browser's install offer. See install.ts.
import "./install";
import "./styles/tokens.css";
import "./styles/global.css";

const queryClient = new QueryClient();
// Before the first render, so the app never shows at the wrong size.
applyScale();
startDesktop();
// iPhones ignore the viewport's user-scalable=no, so this stops pinch zoom there.
// Touch screens only: a Mac's trackpad pinch sends this too, and keeps its zoom.
if (window.matchMedia("(pointer: coarse)").matches) {
  document.addEventListener("gesturestart", (event) => event.preventDefault());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LucideProvider size={16} strokeWidth={2.2}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={createRouter()} />
      </QueryClientProvider>
      <UpdatePrompt />
      <AppUpdatePrompt />
    </LucideProvider>
  </StrictMode>,
);
