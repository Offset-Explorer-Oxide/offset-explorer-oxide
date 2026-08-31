import { QueryClient } from "@tanstack/react-query";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { useTabDataStore } from "../workspace/useTabDataStore";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { useDataTabFiltersStore } from "./useDataTabFiltersStore";
import { useDataTabGridStateStore } from "./useDataTabGridStateStore";
import { useTreeUiStore } from "./useTreeUiStore";

/**
 * React Query roots holding data *read from* a cluster, as opposed to facts
 * about the connection itself.
 *
 * Every one of these is keyed `[root, connectionId, ...]`, and every one is a
 * snapshot of a cluster the app has stopped talking to — they are dropped on
 * disconnect. The cluster listings in particular are fetched once and then
 * held for the life of the app (see `CLUSTER_LISTING_OPTIONS`), so nothing
 * else would ever replace them.
 *
 * Deliberately an allow-list rather than "every query whose second element is
 * this id": `connection-connected`, `connection-status`, `connection-auth-block`
 * and `connections` are keyed identically but describe the connection rather
 * than the cluster. Removing those would blank the very rows — the status dot,
 * the auth-failure banner — that have to keep working after a disconnect, and
 * would drop the queries whose own transitions detect one.
 */
export const CLUSTER_DATA_QUERY_ROOTS = [
  "brokers",
  "topics",
  "consumer-groups",
  "partitions",
  "topic-config",
  "topic-schema",
  "full-payload",
] as const;

/**
 * Forgets everything the app holds about one cluster's *contents*, across
 * every top-level tab.
 *
 * Called when a connection drops, by whichever route: the Disconnect button,
 * the 120-minute idle timer, the auth circuit breaker tripping, or the
 * reachability poll finding the cluster gone. All four end in the same place
 * — the backend no longer has a session for this connection — so they share
 * one cleanup rather than each remembering its own subset.
 *
 * What this deliberately does *not* touch is the connection itself: it stays
 * saved, listed, and selectable, with its status dot live, and Reconnect
 * brings it back. This is about the cluster's contents — the tree below it,
 * the panes showing them, and the fetched rows behind those — none of which
 * can be trusted once the session is gone, and all of which would otherwise
 * sit there looking live: an expanded topic list of a cluster that may have
 * been re-provisioned since, a Data tab of messages from a broker nothing is
 * connected to, and a right pane offering to fetch a payload that no longer
 * has anywhere to come from.
 */
export function clearConnectionState(queryClient: QueryClient, connectionId: string): void {
  // The tree, back to a single collapsed row.
  useTreeUiStore.getState().collapseConnection(connectionId);

  // The middle and right panes. Both are driven off these two stores rather
  // than off local component state, so clearing them here empties whichever
  // panel any tab happened to be showing — including tabs that are not
  // currently on screen.
  useWorkspaceSelectionStore.getState().clearForConnection(connectionId);
  useMessageViewerStore.getState().clearForConnection(connectionId);

  // Everything the Data tab was holding for this cluster: fetched rows and
  // their byte accounting, the fetch filter form, and the grid's sort,
  // column filters and search box.
  useTabDataStore.getState().clearForConnection(connectionId);
  useDataTabFiltersStore.getState().clearForConnection(connectionId);
  useDataTabGridStateStore.getState().clearForConnection(connectionId);

  // `removeQueries`, not `invalidateQueries`: invalidating marks the data
  // stale and refetches it the moment anything observes it, which against a
  // disconnected cluster means an immediate round of failing requests.
  // Removing drops it outright, so the tree simply has nothing to show until
  // the user reconnects and asks again.
  queryClient.removeQueries({
    predicate: (query) => {
      const [root, id] = query.queryKey as [unknown, unknown];
      return (
        typeof root === "string" &&
        (CLUSTER_DATA_QUERY_ROOTS as readonly string[]).includes(root) &&
        id === connectionId
      );
    },
  });
}
