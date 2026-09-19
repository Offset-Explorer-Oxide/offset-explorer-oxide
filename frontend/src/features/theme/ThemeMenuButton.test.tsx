import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeMenuButton } from "./ThemeMenuButton";
import { DEFAULT_THEME_ID } from "./themes";
import { useThemeStore } from "./useThemeStore";

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ appliedThemeId: DEFAULT_THEME_ID, lastByKind: {} });
});

describe("ThemeMenuButton", () => {
  it("starts closed and names the applied kind", () => {
    render(<ThemeMenuButton />);

    expect(screen.getByRole("button", { name: "Theme: dark" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Theme" })).not.toBeInTheDocument();
  });

  it("opens the picker and changes the theme from the status strip", async () => {
    const user = userEvent.setup();
    render(<ThemeMenuButton />);

    await user.click(screen.getByRole("button", { name: /^Theme:/ }));
    expect(screen.getByRole("dialog", { name: "Theme" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Light" }));

    expect(useThemeStore.getState().appliedThemeId).toBe("zed-light");
    expect(screen.getByRole("button", { name: "Theme: light" })).toBeInTheDocument();
  });

  // The picker stays open across a change: trying themes one after another is
  // the whole reason it is down here rather than behind a Settings tab.
  it("stays open after a theme is applied", async () => {
    const user = userEvent.setup();
    render(<ThemeMenuButton />);

    await user.click(screen.getByRole("button", { name: /^Theme:/ }));
    await user.click(screen.getByRole("radio", { name: "Ayu Dark" }));

    expect(screen.getByRole("dialog", { name: "Theme" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<ThemeMenuButton />);

    await user.click(screen.getByRole("button", { name: /^Theme:/ }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Theme" })).not.toBeInTheDocument();
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ThemeMenuButton />
        <button type="button">elsewhere</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /^Theme:/ }));
    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(screen.queryByRole("dialog", { name: "Theme" })).not.toBeInTheDocument();
  });
});
