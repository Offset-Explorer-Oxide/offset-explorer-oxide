import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResizableShell } from "./ResizableShell";

beforeEach(() => {
  localStorage.clear();
});

describe("ResizableShell", () => {
  it("renders the left, middle, and right content", () => {
    render(
      <ResizableShell
        storageKey="test-shell-1"
        left={<div>Left content</div>}
        middle={<div>Middle content</div>}
        right={<div>Right content</div>}
      />,
    );

    expect(screen.getByText("Left content")).toBeInTheDocument();
    expect(screen.getByText("Middle content")).toBeInTheDocument();
    expect(screen.getByText("Right content")).toBeInTheDocument();
  });

  it("renders a resize handle between the left and middle panes", () => {
    render(
      <ResizableShell
        storageKey="test-shell-2"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right</div>}
      />,
    );

    expect(screen.getByRole("separator", { name: "Resize left panel" })).toBeInTheDocument();
  });

  it("renders a resize handle between the middle and right panes", () => {
    render(
      <ResizableShell
        storageKey="test-shell-3"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right</div>}
      />,
    );

    expect(screen.getByRole("separator", { name: "Resize right panel" })).toBeInTheDocument();
  });

  it("applies the persisted left and right widths as inline styles", () => {
    localStorage.setItem("test-shell-4", JSON.stringify({ left: 300, right: 280 }));

    render(
      <ResizableShell
        storageKey="test-shell-4"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right</div>}
      />,
    );

    expect(screen.getByTestId("resizable-pane-left")).toHaveStyle({ width: "300px" });
    expect(screen.getByTestId("resizable-pane-right")).toHaveStyle({ width: "280px" });
  });

  it("omits the right pane and its resize handle entirely when no content is given", () => {
    render(
      <ResizableShell storageKey="test-shell-5" left={<div>Left</div>} middle={<div>Middle</div>} />,
    );

    expect(screen.queryByTestId("resizable-pane-right")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize right panel" })).not.toBeInTheDocument();
  });

  it("omits the left pane and its resize handle entirely when no content is given", () => {
    render(<ResizableShell storageKey="test-shell-6" middle={<div>Middle</div>} />);

    expect(screen.queryByTestId("resizable-pane-left")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize left panel" })).not.toBeInTheDocument();
  });

  it("gives the right resize handle a persistently visible affordance, same as the left one", () => {
    render(
      <ResizableShell
        storageKey="test-shell-7"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right</div>}
      />,
    );

    expect(screen.getByRole("separator", { name: "Resize right panel" })).toHaveClass("resizable-divider--persistent");
  });

  it("keeps the left pane mounted but visually hides it and its divider when leftHidden is set", () => {
    const { container } = render(
      <ResizableShell
        storageKey="test-shell-8"
        left={<div>Left content</div>}
        leftHidden
        middle={<div>Middle</div>}
      />,
    );

    expect(screen.getByText("Left content")).toBeInTheDocument();
    expect(screen.getByTestId("resizable-pane-left")).not.toBeVisible();
    expect(container.querySelector('[aria-label="Resize left panel"]')).not.toBeVisible();
  });
});

describe("ResizableShell with the right pane docked at the bottom", () => {
  it("renders the pane full-width below the middle pane, at its persisted height", () => {
    localStorage.setItem("test-shell-bottom-1", JSON.stringify({ bottom: 320 }));

    render(
      <ResizableShell
        storageKey="test-shell-bottom-1"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right content</div>}
        rightPlacement="bottom"
      />,
    );

    expect(screen.getByText("Right content")).toBeInTheDocument();
    expect(screen.getByTestId("resizable-pane-right")).toHaveStyle({ height: "320px" });
  });

  // The whole point of the switch: the middle pane stops sharing its row with
  // the payload panel and takes the width back — and the dock lands under the
  // middle pane, not under the sidebar as well.
  it("stacks the pane under the middle pane, inside the middle column", () => {
    render(
      <ResizableShell
        storageKey="test-shell-bottom-2"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right</div>}
        rightPlacement="bottom"
      />,
    );

    const column = screen.getByTestId("resizable-pane-middle").parentElement;
    expect(column).toHaveClass("resizable-column");
    expect(column).toContainElement(screen.getByTestId("resizable-pane-right"));
    expect(column).not.toContainElement(screen.getByTestId("resizable-pane-left"));
  });

  it("swaps the vertical resize handle for a horizontal one", () => {
    render(
      <ResizableShell
        storageKey="test-shell-bottom-3"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right</div>}
        rightPlacement="bottom"
      />,
    );

    expect(screen.queryByRole("separator", { name: "Resize right panel" })).not.toBeInTheDocument();
    const divider = screen.getByRole("separator", { name: "Resize bottom panel" });
    expect(divider).toHaveAttribute("aria-orientation", "horizontal");
    expect(divider).toHaveClass("resizable-divider--horizontal");
  });

  it("still resizes the sidebar", () => {
    render(
      <ResizableShell
        storageKey="test-shell-bottom-4"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right</div>}
        rightPlacement="bottom"
      />,
    );

    expect(screen.getByRole("separator", { name: "Resize left panel" })).toBeInTheDocument();
  });

  it("omits the bottom pane and its handle entirely when there is no content for it", () => {
    render(<ResizableShell storageKey="test-shell-bottom-5" middle={<div>Middle</div>} rightPlacement="bottom" />);

    expect(screen.queryByTestId("resizable-pane-right")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize bottom panel" })).not.toBeInTheDocument();
  });
});

describe("ResizableShell narrow-window behaviour", () => {
  /**
   * The stylesheet hides the side payload pane below 900px and its divider
   * with it. That divider has to be selectable on its own: the rule used to
   * say `.resizable-divider:last-of-type`, which matches the last sibling of
   * that element *type* — every sibling is a `div`, so it selected the right
   * pane and never the divider, leaving a stray draggable strip beside a
   * hidden pane.
   */
  it("gives the right divider a class of its own to hide it by", () => {
    render(
      <ResizableShell
        storageKey="test-shell-narrow"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right</div>}
      />,
    );

    expect(screen.getByRole("separator", { name: "Resize right panel" })).toHaveClass("resizable-divider--right");
  });

  it("doesn't put that class on the left divider, which stays at any width", () => {
    render(
      <ResizableShell
        storageKey="test-shell-narrow-2"
        left={<div>Left</div>}
        middle={<div>Middle</div>}
        right={<div>Right</div>}
      />,
    );

    expect(screen.getByRole("separator", { name: "Resize left panel" })).not.toHaveClass("resizable-divider--right");
  });
});
