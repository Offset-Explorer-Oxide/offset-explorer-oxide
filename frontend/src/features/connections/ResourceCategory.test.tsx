import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourceCategory } from "./ResourceCategory";
import { useTreeUiStore } from "./useTreeUiStore";

beforeEach(() => {
  useTreeUiStore.setState({ expanded: {}, searchText: {} });
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

  it("calls onExpand exactly once, the first time it's expanded", async () => {
    const user = userEvent.setup();
    const { onExpand } = renderCategory();

    await user.click(screen.getByTestId("category-Topics"));
    await user.click(screen.getByTestId("category-Topics"));
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
});
