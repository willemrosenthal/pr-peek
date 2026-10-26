import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useWhenHidden } from "./useWhenHidden";

// Goes back to the list whenever the app is hidden, so it always opens there.
export function useReturnToList() {
  const navigate = useNavigate();
  useWhenHidden(useCallback(() => void navigate("/"), [navigate]));
}
