import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { getVersion } from "@tauri-apps/api/app";
import { AppTitle } from "./AppTitle";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));

describe("AppTitle", () => {
  it("shows the app name", () => {
    vi.mocked(getVersion).mockResolvedValue("0.4.0");
    render(<AppTitle />);

    expect(screen.getByText("Offset Explorer Oxide")).toBeInTheDocument();
  });

  it("shows the version once it resolves", async () => {
    vi.mocked(getVersion).mockResolvedValue("0.4.0");
    render(<AppTitle />);

    expect(await screen.findByText("v0.4.0")).toBeInTheDocument();
  });

  it("shows just the app name if the version can't be read", async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error("not available"));
    render(<AppTitle />);

    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
    expect(screen.getByText("Offset Explorer Oxide")).toBeInTheDocument();
  });
});
