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
