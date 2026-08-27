import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { CLUSTER_LISTING_STALE_MS, useBrokers, useConsumerGroups, useTopics } from "./useClusterResources";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

/** One client for the whole test, so a remount hits the same cache a real tab switch would. */
function renderWith(client: QueryClient, ui: React.ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Topics() {
  const { data } = useTopics("1", true);
  return <div>topics: {data?.length ?? "…"}</div>;
}

function Brokers() {
  const { data } = useBrokers("1", true);
  return <div>brokers: {data?.length ?? "…"}</div>;
}

function Groups() {
  const { data } = useConsumerGroups("1", true);
  return <div>groups: {data?.length ?? "…"}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Each of these is a full cluster-metadata request on the broker. The tree
 * remounts whenever the user switches top-level tabs, and React Query
 * refetches every stale query when the window regains focus — so without a
 * stale window, ordinary app use re-asks a production cluster for its entire
 * topic list over and over.
 */
describe("cluster resource queries", () => {
  it("serves a remounted topic list from cache instead of asking the broker again", async () => {
    const listTopics = vi.fn(() => [{ name: "orders", partitionCount: 3 }]);
    setInvokeHandlers({ connection_list_topics: listTopics });
    const client = newClient();

    const first = renderWith(client, <Topics />);
    await screen.findByText("topics: 1");
    first.unmount();

    renderWith(client, <Topics />);
    await screen.findByText("topics: 1");

    expect(listTopics).toHaveBeenCalledTimes(1);
  });

  it("serves a remounted broker list from cache", async () => {
    const listBrokers = vi.fn(() => [{ id: 1, host: "localhost", port: 9092 }]);
    setInvokeHandlers({ connection_list_brokers: listBrokers });
    const client = newClient();

    const first = renderWith(client, <Brokers />);
    await screen.findByText("brokers: 1");
    first.unmount();

    renderWith(client, <Brokers />);
    await screen.findByText("brokers: 1");

    expect(listBrokers).toHaveBeenCalledTimes(1);
  });

  it("serves a remounted consumer group list from cache", async () => {
    const listGroups = vi.fn(() => [{ groupId: "g1", state: "Stable" }]);
    setInvokeHandlers({ connection_list_consumer_groups: listGroups });
    const client = newClient();

    const first = renderWith(client, <Groups />);
    await screen.findByText("groups: 1");
    first.unmount();

    renderWith(client, <Groups />);
    await screen.findByText("groups: 1");

    expect(listGroups).toHaveBeenCalledTimes(1);
  });

  it("still refetches once the cached cluster listing has gone stale", async () => {
    vi.useFakeTimers();
    try {
      const listTopics = vi.fn(() => [{ name: "orders", partitionCount: 3 }]);
      setInvokeHandlers({ connection_list_topics: listTopics });
      const client = newClient();

      const first = renderWith(client, <Topics />);
      await vi.waitFor(() => expect(listTopics).toHaveBeenCalledTimes(1));
      first.unmount();

      await vi.advanceTimersByTimeAsync(CLUSTER_LISTING_STALE_MS + 1_000);
      renderWith(client, <Topics />);

      await vi.waitFor(() => expect(listTopics).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
