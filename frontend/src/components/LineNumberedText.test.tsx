import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LineNumberedText } from "./LineNumberedText";

function gutter(container: HTMLElement): string {
  return container.querySelector(".code-gutter")?.textContent ?? "";
}

describe("LineNumberedText", () => {
  it("numbers every line of the text", () => {
    const { container } = render(<LineNumberedText text={"alpha\nbeta\ngamma"} />);

    expect(gutter(container)).toBe("1\n2\n3");
  });

  it("numbers a single line as line 1", () => {
    const { container } = render(<LineNumberedText text="alpha" />);

    expect(gutter(container)).toBe("1");
  });

  // A trailing newline ends the last line rather than starting an empty one —
  // numbering it would put a number against no text.
  it("doesn't number a phantom line after a trailing newline", () => {
    const { container } = render(<LineNumberedText text={"alpha\nbeta\n"} />);

    expect(gutter(container)).toBe("1\n2");
  });

  it("numbers empty text as one line rather than none", () => {
    const { container } = render(<LineNumberedText text="" />);

    expect(gutter(container)).toBe("1");
  });

  // The gutter is its own element beside the content, never interleaved with
  // it, so selecting and copying the payload yields the payload.
  it("keeps the numbers out of the copyable text", () => {
    const { container } = render(<LineNumberedText text={"alpha\nbeta"} />);

    expect(container.querySelector(".code-body")?.textContent).toBe("alpha\nbeta");
  });

  it("hides the gutter from assistive technology", () => {
    const { container } = render(<LineNumberedText text="alpha" />);

    expect(container.querySelector(".code-gutter")).toHaveAttribute("aria-hidden", "true");
  });

  it("labels the region when given a label", () => {
    render(<LineNumberedText text="alpha" ariaLabel="Payload as Hex" />);

    expect(screen.getByRole("group", { name: "Payload as Hex" })).toBeInTheDocument();
  });
});

describe("LineNumberedText monospace override", () => {
  it("follows the app's font setting by default", () => {
    const { container } = render(<LineNumberedText text="alpha" />);

    expect(container.querySelector(".code-view")).not.toHaveClass("code-view--monospace");
  });

  // The hex dump's columns are the view; a proportional font turns an aligned
  // grid of byte pairs into ragged text.
  it("pins monospace when asked", () => {
    const { container } = render(<LineNumberedText text="alpha" forceMonospace />);

    expect(container.querySelector(".code-view")).toHaveClass("code-view--monospace");
  });
});
