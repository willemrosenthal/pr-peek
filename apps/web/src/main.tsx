import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LucideProvider } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { createRouter } from "./router";
// Starts listening for the browser's install offer. See install.ts.
import "./install";
import "./styles/tokens.css";
import "./styles/global.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LucideProvider size={16} strokeWidth={2.2}>
        <RouterProvider router={createRouter()} />
      </LucideProvider>
    </QueryClientProvider>
    <UpdatePrompt />
  </StrictMode>,
);
