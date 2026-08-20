import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import { usePreferencesStore } from "./usePreferencesStore";
import { useThemeStore } from "../theme/useThemeStore";
import { DEFAULT_FONT_FAMILY_ID, DEFAULT_FONT_SIZE_PX } from "./fonts";
import { DEFAULT_THEME_ID } from "../theme/themes";

beforeEach(() => {
  localStorage.clear();
  usePreferencesStore.setState({
    appliedFontFamilyId: DEFAULT_FONT_FAMILY_ID,
    previewFontFamilyId: null,
    fontSizePx: DEFAULT_FONT_SIZE_PX,
  });
  useThemeStore.setState({ appliedThemeId: DEFAULT_THEME_ID });
  document.documentElement.style.removeProperty("--font-family-base");
});

describe("SettingsPanel", () => {
  it("renders the theme, font style, and font size dropdowns as matching button+listbox controls", () => {
    render(<SettingsPanel />);
    expect(screen.getByRole("button", { name: /Zed Dark/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /System UI/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${DEFAULT_FONT_SIZE_PX}px ▾` })).toBeInTheDocument();
  });

  it("marks the applied font family with a checkmark when the dropdown is open", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /System UI/ }));

    expect(screen.getByRole("option", { name: "✓ System UI" })).toBeInTheDocument();
  });

  it("live-previews a font family on hover without committing it", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /System UI/ }));
    await user.hover(screen.getByRole("option", { name: "Inter" }));

    expect(document.documentElement.style.getPropertyValue("--font-family-base")).toBe("");
    // The dropdown itself doesn't own CSS application (PreferencesProvider does,
    // tested separately) — what SettingsPanel owns is calling setPreviewFontFamily,
    // asserted directly against the store:
    expect(usePreferencesStore.getState().previewFontFamilyId).toBe("inter");
    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe(DEFAULT_FONT_FAMILY_ID);
  });

  it("commits a font family on click", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /System UI/ }));
    await user.click(screen.getByRole("option", { name: "Inter" }));

    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe("inter");
  });

  it("commits a font size change on click, same as the other dropdowns", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: `${DEFAULT_FONT_SIZE_PX}px ▾` }));
    await user.click(screen.getByRole("option", { name: `${DEFAULT_FONT_SIZE_PX + 1}px` }));

    expect(usePreferencesStore.getState().fontSizePx).toBe(DEFAULT_FONT_SIZE_PX + 1);
  });

  it("marks the currently applied theme with a checkmark when the dropdown is open", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /Zed Dark/ }));

    expect(screen.getByRole("option", { name: "✓ Zed Dark" })).toBeInTheDocument();
  });

  it("applies the selected theme immediately and persists it", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /Zed Dark/ }));
    await user.click(screen.getByRole("option", { name: "Zed Light" }));

    expect(useThemeStore.getState().appliedThemeId).toBe("zed-light");
    expect(localStorage.getItem("kafkaoxide.theme")).toBe("zed-light");
  });

  it("closes the font menu when clicking outside of it", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /System UI/ }));
    expect(screen.getByRole("listbox", { name: "Font style" })).toBeInTheDocument();

    await user.click(screen.getByText("Settings"));

    expect(screen.queryByRole("listbox", { name: "Font style" })).not.toBeInTheDocument();
  });

  it("closes the font menu on Escape", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /System UI/ }));
    expect(screen.getByRole("listbox", { name: "Font style" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox", { name: "Font style" })).not.toBeInTheDocument();
  });

  it("selects a font family via keyboard navigation (ArrowDown + Enter)", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /System UI/ }));
    await user.keyboard("{ArrowDown}{Enter}");

    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe("inter");
  });

  it("selects a theme via keyboard navigation (ArrowDown + Enter)", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /Zed Dark/ }));
    await user.keyboard("{ArrowDown}{Enter}");

    expect(useThemeStore.getState().appliedThemeId).toBe("zed-light");
  });
});
