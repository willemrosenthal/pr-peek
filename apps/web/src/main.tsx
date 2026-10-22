import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { createRouter } from "./router";
import "./styles/tokens.css";
import "./styles/global.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createRouter()} />
    </QueryClientProvider>
    <UpdatePrompt />
  </StrictMode>,
);
