import { createBrowserRouter, Link, Navigate } from "react-router";
import { PageMessage } from "./components/PageMessage";
import { RequireAuth } from "./components/RequireAuth";
import { ListPage } from "./pages/ListPage";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";

// Route paths have no dots. The server treats a path with a file extension as a file.
export const routes = [
  { path: "/signin", element: <SignIn /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <ListPage /> },
      { path: "/settings", element: <Settings /> },
      // Onboarding comes in plan 07 part 4.
      { path: "/onboarding", element: <Navigate to="/" replace /> },
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
