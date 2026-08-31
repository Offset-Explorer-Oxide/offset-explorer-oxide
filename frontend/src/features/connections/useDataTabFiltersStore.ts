import { create } from "zustand";
import { FilterFormState } from "./dataFilters";
import { dataTabKeyBelongsTo } from "../workspace/useTabDataStore";

/**
 * The Data tab's filter form (Max messages per partition, Partition filter,
 * Offset, From/To, ...), keyed the same way as `useTabDataStore`'s cached
 * messages (`dataTabCacheKey`) — tab + connection + topic + partition. Without
 * this, the form lived in `DataTab`'s own `useState`, reset on every topic
 * switch (including switching back to a topic you'd already set filters on),
 * so returning to a topic showed its cached messages but not the filters
 * that produced them.
 */
interface DataTabFiltersState {
  formByTab: Record<string, FilterFormState>;
  setForm: (key: string, form: FilterFormState) => void;
  /** Forgets every filter form belonging to one connection, in every tab — see `useTabDataStore`'s `clearForConnection`. */
  clearForConnection: (connectionId: string) => void;
}

export const useDataTabFiltersStore = create<DataTabFiltersState>((set) => ({
  formByTab: {},
  setForm: (key, form) => set((state) => ({ formByTab: { ...state.formByTab, [key]: form } })),
  clearForConnection: (connectionId) =>
    set((state) => ({
      formByTab: Object.fromEntries(
        Object.entries(state.formByTab).filter(([key]) => !dataTabKeyBelongsTo(key, connectionId)),
      ),
    })),
}));
