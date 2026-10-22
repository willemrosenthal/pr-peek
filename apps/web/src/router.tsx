import { createBrowserRouter, Link, Navigate } from "react-router";
import { PageMessage } from "./components/PageMessage";
import { RequireAuth } from "./components/RequireAuth";
import { ListPage } from "./pages/ListPage";
import { Onboarding } from "./pages/Onboarding";
import { DevicesTab } from "./pages/settings/DevicesTab";
import { GeneralTab } from "./pages/settings/GeneralTab";
import { ReposTab } from "./pages/settings/ReposTab";
import { RulesTab } from "./pages/settings/RulesTab";
import { TimingTab } from "./pages/settings/TimingTab";
import { SettingsLayout } from "./pages/settings/SettingsLayout";
import { SignIn } from "./pages/SignIn";

// Route paths have no dots. The server treats a path with a file extension as a file.
export const routes = [
  { path: "/signin", element: <SignIn /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <ListPage /> },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { path: "general", element: <GeneralTab /> },
          { path: "repos", element: <ReposTab /> },
          { path: "rules", element: <RulesTab /> },
          { path: "timing", element: <TimingTab /> },
          { path: "devices", element: <DevicesTab /> },
          { index: true, element: <Navigate to="/settings/general" replace /> },
          { path: "*", element: <Navigate to="/settings/general" replace /> },
        ],
      },
      { path: "/onboarding", element: <Onboarding /> },
    ],
  },
  {
    path: "*",
    element: (
      <PageMessage title="Page not found">
        <Link to="/">Go to your list</Link>
      </PageMessage>
    ),
  },
];

export const createRouter = () => createBrowserRouter(routes);
