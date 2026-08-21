import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { disconnectAllConnections, IDLE_DISCONNECT_MS } from "./idleDisconnect";

/** Activity that counts as "the user is still here" — resets the idle clock. */
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;

export function IdleTimerProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function resetTimer() {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        void disconnectAllConnections(queryClient);
      }, IDLE_DISCONNECT_MS);
    }

    resetTimer();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer);
    }

    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, resetTimer);
      }
    };
  }, [queryClient]);

  return <>{children}</>;
}
