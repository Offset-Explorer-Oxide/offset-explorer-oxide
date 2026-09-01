import { create } from "zustand";

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

interface LogsState {
  entries: LogEntry[];
  isExpanded: boolean;
  addEntry: (entry: LogEntry) => void;
  /** Backs the logs panel's right-click "Clear logs" action. */
  clearEntries: () => void;
  toggleExpanded: () => void;
}

const STORAGE_KEY = "kafkaoxide.logs-expanded";

function loadStoredExpanded(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export const useLogsStore = create<LogsState>((set, get) => ({
  entries: [],
  isExpanded: loadStoredExpanded(),
  addEntry: (entry) => set((state) => ({ entries: [...state.entries, entry] })),
  clearEntries: () => set({ entries: [] }),
  toggleExpanded: () => {
    const next = !get().isExpanded;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(next));
    }
    set({ isExpanded: next });
  },
}));
