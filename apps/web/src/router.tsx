import { createBrowserRouter, Link, Navigate } from "react-router";
import { PageMessage } from "./components/PageMessage";
import { RequireAuth } from "./components/RequireAuth";
import { InstallPage } from "./pages/InstallPage";
import { ListPage } from "./pages/ListPage";
import { Onboarding } from "./pages/Onboarding";
import { PrivacyPage } from "./pages/PrivacyPage";
import { SharePage } from "./pages/SharePage";
import { AccountPage } from "./pages/settings/AccountPage";
import { AddReposPage } from "./pages/settings/AddReposPage";
import { AdminPage } from "./pages/settings/AdminPage";
import { DisplayPage } from "./pages/settings/DisplayPage";
import { HomePage } from "./pages/settings/HomePage";
import { MenuBarPage } from "./pages/settings/MenuBarPage";
import { NotificationsPage } from "./pages/settings/NotificationsPage";
import { OverduePage } from "./pages/settings/OverduePage";
import { ReposPage } from "./pages/settings/ReposPage";
import { RulesPage } from "./pages/settings/RulesPage";
import { SettingsLayout } from "./pages/settings/SettingsLayout";
import { SignIn } from "./pages/SignIn";

// Route paths have no dots. The server treats a path with a file extension as a file.
export const routes = [
  { path: "/signin", element: <SignIn /> },
  { path: "/install", element: <InstallPage /> },
  { path: "/privacy", element: <PrivacyPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <ListPage /> },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "account", element: <AccountPage /> },
          { path: "repos", element: <ReposPage /> },
          { path: "repos/add", element: <AddReposPage /> },
          { path: "rules", element: <RulesPage /> },
          { path: "overdue", element: <OverduePage /> },
          { path: "display", element: <DisplayPage /> },
          { path: "notifications", element: <NotificationsPage /> },
          { path: "menu-bar", element: <MenuBarPage /> },
          { path: "admin", element: <AdminPage /> },
          // Old pages, from links in pushes and older apps. General held the tokens.
          {
            path: "general",
            element: <Navigate to="/settings/account" replace />,
          },
          {
            path: "timing",
            element: <Navigate to="/settings/overdue" replace />,
          },
          { path: "*", element: <Navigate to="/settings" replace /> },
        ],
      },
      { path: "/onboarding", element: <Onboarding /> },
      { path: "/add", element: <SharePage /> },
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
