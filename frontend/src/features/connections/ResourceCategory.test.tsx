import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourceCategory } from "./ResourceCategory";
import { useTreeUiStore } from "./useTreeUiStore";

beforeEach(() => {
  useTreeUiStore.setState({ expanded: {}, searchText: {}, hideEmptyConsumerGroups: {} });
});

interface Item {
  id: string;
  name: string;
}

const items: Item[] = [
  { id: "1", name: "orders" },
  { id: "2", name: "payments" },
];

function renderCategory(overrides: Partial<Parameters<typeof ResourceCategory<Item>>[0]> = {}) {
  const onExpand = vi.fn();
  const onSelect = vi.fn();
  render(
    <ResourceCategory<Item>
      label="Topics"
      items={items}
      isLoading={false}
      getKey={(item) => item.id}
      getLabel={(item) => item.name}
      matchesSearch={(item, query) => item.name.toLowerCase().includes(query.toLowerCase())}
      isSelected={() => false}
      onSelect={onSelect}
      onExpand={onExpand}
      treeKey="test-tab:conn-1:Topics"
      {...overrides}
    />,
  );
  return { onExpand, onSelect };
}

describe("ResourceCategory", () => {
  it("warns in the header when the listing failed, so the problem is visible while collapsed", () => {
    renderCategory({ items: undefined, error: new Error("authentication error: failed to fetch consumer group list") });

    expect(screen.getByTestId("category-Topics-warning")).toBeInTheDocument();
  });

  it("has no warning marker when the listing succeeded", () => {
    renderCategory();

    expect(screen.queryByTestId("category-Topics-warning")).not.toBeInTheDocument();
  });

  it("explains the failure, and that the rest of the cluster is unaffected, once expanded", async () => {
    const user = userEvent.setup();
    renderCategory({ items: undefined, error: new Error("group authorization failed") });

    await user.click(screen.getByTestId("category-Topics"));

    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent("Topics could not be loaded");
    expect(warning).toHaveTextContent("group authorization failed");
    expect(warning).toHaveTextContent(/rest of the cluster is unaffected/i);
  });

  it("still shows previously loaded items alongside the warning", async () => {
    // A refetch can fail while React Query still holds the last good list —
    // dropping those rows would lose data the user can still act on.
    const user = userEvent.setup();
    renderCategory({ error: new Error("Local: Timed out") });

    await user.click(screen.getByTestId("category-Topics"));

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });


  it("starts collapsed, showing neither the search box nor items", () => {
    renderCategory();
    expect(screen.queryByLabelText("Search Topics")).not.toBeInTheDocument();
    expect(screen.queryByText("orders")).not.toBeInTheDocument();
  });

  it("expands on click, showing the search box and every item", async () => {
    const user = userEvent.setup();
    renderCategory();

    await user.click(screen.getByTestId("category-Topics"));

    expect(screen.getByLabelText("Search Topics")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
  });

  // A category's listing is fetched once and then held for the life of the
  // app, so opening the category is the user's only way to ask for a current
  // one. Firing just the first time — as this did — made that refresh work
  // exactly once per session and silently never again.
  it("calls onExpand every time it is opened, so each open can refresh the listing", async () => {
    const user = userEvent.setup();
    const { onExpand } = renderCategory();

    await user.click(screen.getByTestId("category-Topics"));
    await user.click(screen.getByTestId("category-Topics"));
    await user.click(screen.getByTestId("category-Topics"));

    // Three clicks: open, close, open.
    expect(onExpand).toHaveBeenCalledTimes(2);
  });

  it("does not call onExpand when the category is collapsed — closing asks for nothing", async () => {
    const user = userEvent.setup();
    const { onExpand } = renderCategory();

    await user.click(screen.getByTestId("category-Topics"));
    expect(onExpand).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("category-Topics"));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("filters items using matchesSearch as the user types", async () => {
    const user = userEvent.setup();
    renderCategory();
    await user.click(screen.getByTestId("category-Topics"));

    await user.type(screen.getByLabelText("Search Topics"), "pay");

    expect(screen.queryByText("orders")).not.toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked item", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderCategory();
    await user.click(screen.getByTestId("category-Topics"));

    await user.click(screen.getByText("orders"));

    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("shows a loading indicator while items are loading", async () => {
    const user = userEvent.setup();
    renderCategory({ isLoading: true, items: undefined });
    await user.click(screen.getByTestId("category-Topics"));

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("excludes items rejected by additionalFilter, even ones that match the search text", async () => {
    const user = userEvent.setup();
    renderCategory({ additionalFilter: (item) => item.id !== "1" });
    await user.click(screen.getByTestId("category-Topics"));

    expect(screen.queryByText("orders")).not.toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
  });

  it("does not render a context menu trigger when contextMenuItems is omitted", async () => {
    const user = userEvent.setup();
    renderCategory();

    fireEvent.contextMenu(screen.getByTestId("category-Topics"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // onSelect is unaffected by this — sanity check the row is still usable.
    await user.click(screen.getByTestId("category-Topics"));
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("opens a context menu on right-click when contextMenuItems is given, and runs the selected item's action", () => {
    const onMenuSelect = vi.fn();
    renderCategory({ contextMenuItems: [{ label: "Do the thing", onSelect: onMenuSelect }] });

    fireEvent.contextMenu(screen.getByTestId("category-Topics"), { clientX: 10, clientY: 20 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Do the thing")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Do the thing"));

    expect(onMenuSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders every item in a plain list when the count is at or below the virtualization threshold", async () => {
    const user = userEvent.setup();
    const manyItems = Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: `item-${i}` }));
    renderCategory({ items: manyItems });
    await user.click(screen.getByTestId("category-Topics"));

    expect(screen.getByText("item-0")).toBeInTheDocument();
    expect(screen.getByText("item-49")).toBeInTheDocument();
  });

  it("switches to a virtualized list once the item count exceeds the threshold, rendering only the visible rows", async () => {
    const user = userEvent.setup();
    const manyItems = Array.from({ length: 60 }, (_, i) => ({ id: String(i), name: `item-${i}` }));
    renderCategory({ items: manyItems });
    await user.click(screen.getByTestId("category-Topics"));

    expect(screen.getByText("item-0")).toBeInTheDocument();
    // Far past the visible window (react-window only renders rows near the viewport) — should not be in the DOM at all.
    expect(screen.queryByText("item-59")).not.toBeInTheDocument();
  });

  it("still respects onSelect for a virtualized row", async () => {
    const user = userEvent.setup();
    const manyItems = Array.from({ length: 60 }, (_, i) => ({ id: String(i), name: `item-${i}` }));
    const { onSelect } = renderCategory({ items: manyItems });
    await user.click(screen.getByTestId("category-Topics"));

    await user.click(screen.getByText("item-0"));

    expect(onSelect).toHaveBeenCalledWith(manyItems[0]);
  });
});
