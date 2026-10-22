import { createBrowserRouter, Link, Navigate } from "react-router";
import { PageMessage } from "./components/PageMessage";
import { RequireAuth } from "./components/RequireAuth";
import { Home } from "./pages/Home";
import { SignIn } from "./pages/SignIn";

// Route paths have no dots. The server treats a path with a file extension as a file.
export const routes = [
  { path: "/signin", element: <SignIn /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Home /> },
      // Onboarding comes in plan 07 part 3.
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
