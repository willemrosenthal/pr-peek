import { useEffect } from "react";
import { useNavigate } from "react-router";
import { startIosPush } from "../iosPush";
import { inIosApp } from "./useIsTray";

// In the iPhone app: saves the phone for notifications, and opens tapped ones.
export function useIosPush() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!inIosApp()) return;
    let stop: (() => void) | undefined;
    let left = false;
    startIosPush((path) => void navigate(path))
      .then((stopIt) => {
        if (left) stopIt();
        else stop = stopIt;
      })
      // The next open tries again.
      .catch(() => undefined);
    return () => {
      left = true;
      stop?.();
    };
  }, [navigate]);
}
