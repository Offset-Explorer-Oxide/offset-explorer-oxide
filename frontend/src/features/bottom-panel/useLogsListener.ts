import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { LogEntry, useLogsStore } from "./useLogsStore";

export function useLogsListener() {
  const addEntry = useLogsStore((s) => s.addEntry);

  useEffect(() => {
    const unlisten = listen<LogEntry>("log", (event) => addEntry(event.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addEntry]);
}
