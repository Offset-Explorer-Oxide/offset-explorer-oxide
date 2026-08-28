import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { retryDelay, RETRY_DELAY_CAP_MS, shouldRetry } from "../../lib/queryRetry";
import { useBrokers, useConsumerGroups, useTopics } from "./useClusterResources";

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

  // A cluster listing used to go stale after a minute, after which any
  // remount (every top-level tab switch) or any window focus re-asked the
  // broker for the whole list. On a desktop app that is alt-tabbed all day
  // that read as the app polling the cluster on a timer forever, long after
  // the list had been fetched successfully. A listing now stays put until
  // something asks for it again.
  it("never refetches a successfully loaded listing on its own, however long it has been cached", async () => {
    vi.useFakeTimers();
    try {
      const listTopics = vi.fn(() => [{ name: "orders", partitionCount: 3 }]);
      setInvokeHandlers({ connection_list_topics: listTopics });
      const client = newClient();

      const first = renderWith(client, <Topics />);
      await vi.waitFor(() => expect(listTopics).toHaveBeenCalledTimes(1));
      first.unmount();

      await vi.advanceTimersByTimeAsync(60 * 60_000);
      renderWith(client, <Topics />);
      await vi.advanceTimersByTimeAsync(60 * 60_000);

      expect(listTopics).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Every attempt is a fresh Kafka client, a socket and — on a secured
  // cluster — a TLS/SASL handshake. A listing that failed is shown as failed
  // and left alone until the user asks again, rather than dialling the
  // broker repeatedly on its own.
  it("does not retry a failed listing", async () => {
    const listTopics = vi.fn(() => {
      throw new Error("broker unreachable");
    });
    setInvokeHandlers({ connection_list_topics: listTopics });
    vi.useFakeTimers();
    try {
      // The app's own retry policy, not the test client's — `shouldRetry`
      // allows two retries, and this is the default these queries have to
      // override. Fake timers because that policy backs off ~1-8s between
      // attempts, so a real-time wait short enough for a test would pass
      // whether or not retrying was actually switched off.
      const client = new QueryClient({ defaultOptions: { queries: { retry: shouldRetry, retryDelay } } });

      renderWith(client, <Topics />);
      await vi.waitFor(() => expect(listTopics).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_CAP_MS * 4);

      expect(listTopics).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches when asked to, so opening a category can pull a fresh list", async () => {
    const listTopics = vi.fn(() => [{ name: "orders", partitionCount: 3 }]);
    setInvokeHandlers({ connection_list_topics: listTopics });
    const client = newClient();
    let refetchTopics: () => void = () => {};

    function RefetchableTopics() {
      const { data, refetch } = useTopics("1", true);
      refetchTopics = refetch;
      return <div>topics: {data?.length ?? "…"}</div>;
    }

    renderWith(client, <RefetchableTopics />);
    await screen.findByText("topics: 1");
    expect(listTopics).toHaveBeenCalledTimes(1);

    refetchTopics();

    await waitFor(() => expect(listTopics).toHaveBeenCalledTimes(2));
  });
});
