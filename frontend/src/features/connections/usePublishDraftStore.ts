import { create } from "zustand";
import { dataTabKeyBelongsTo } from "../workspace/useTabDataStore";
import { DraftMessage, emptyMessage } from "./publishMessages";

/**
 * Messages typed into the Publish tab, keyed the same way as the Data tab's
 * cached rows and filters (`dataTabCacheKey`) — tab + connection + topic +
 * partition.
 *
 * Kept in a store rather than the component's own `useState` for the same reason
 * the Data tab's filters are: selecting another topic unmounts the panel, and
 * losing a hand-authored message to a stray click in the tree is a poor trade
 * for a few lines of state. It also means each top-level tab composes
 * independently, which is the per-tab behaviour the rest of the workspace
 * already has.
 *
 * Never persisted to disk. A half-written message to a production topic is not
 * something to find waiting after a restart.
 */
interface PublishDraftState {
  /** Absent for a key nobody has typed into yet — the Publish tab renders a blank message for that case without writing one here. */
  messagesByTab: Record<string, DraftMessage[]>;
  set: (key: string, messages: DraftMessage[]) => void;
  /** Back to one empty message — what a successful publish does, so the same batch cannot be sent twice by reflex. */
  reset: (key: string) => void;
  /** Forgets every draft belonging to one connection, in every tab — see `useTabDataStore`'s `clearForConnection`. */
  clearForConnection: (connectionId: string) => void;
}

export const usePublishDraftStore = create<PublishDraftState>((set) => ({
  messagesByTab: {},
  set: (key, messages) =>
    set((state) => ({ messagesByTab: { ...state.messagesByTab, [key]: messages } })),
  reset: (key) =>
    set((state) => ({ messagesByTab: { ...state.messagesByTab, [key]: [emptyMessage()] } })),
  clearForConnection: (connectionId) =>
    set((state) => ({
      messagesByTab: Object.fromEntries(
        Object.entries(state.messagesByTab).filter(([key]) => !dataTabKeyBelongsTo(key, connectionId)),
      ),
    })),
}));
