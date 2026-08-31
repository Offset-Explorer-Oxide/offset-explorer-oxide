import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyDraft } from "./draft";
import { AdvancedTab } from "./AdvancedTab";

describe("AdvancedTab", () => {
  it("renders all seven Schema Registry fields", () => {
    render(<AdvancedTab draft={emptyDraft()} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Endpoint")).toBeInTheDocument();
    expect(screen.getByLabelText("Basic auth credentials")).toBeInTheDocument();
    expect(screen.getByLabelText("Trust store location")).toBeInTheDocument();
    expect(screen.getByLabelText("Trust store password (not used)")).toBeInTheDocument();
    expect(screen.getByLabelText("Keystore location")).toBeInTheDocument();
    expect(screen.getByLabelText("Keystore password")).toBeInTheDocument();
    expect(screen.getByLabelText("Keystore private key password (not used)")).toBeInTheDocument();
  });

  it("masks the schema registry secret fields as password inputs", () => {
    render(<AdvancedTab draft={emptyDraft()} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Basic auth credentials")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Trust store password (not used)")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Keystore password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Keystore private key password (not used)")).toHaveAttribute("type", "password");
  });

  it("calls onChange when the schema registry endpoint is typed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AdvancedTab draft={emptyDraft()} onChange={onChange} />);

    await user.type(screen.getByLabelText("Endpoint"), "h");

    expect(onChange).toHaveBeenCalledWith({ schemaRegistryEndpoint: "h" });
  });

  it("disables every field when disabled is true", () => {
    render(<AdvancedTab draft={emptyDraft()} onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText("Endpoint")).toBeDisabled();
    expect(screen.getByLabelText("Keystore private key password (not used)")).toBeDisabled();
  });
  // Both password fields are saved and then ignored by the Schema Registry
  // client — the trust store is read as an unencrypted PEM bundle and the
  // keystore as a single-password PKCS#12 — so the UI has to say so rather
  // than presenting inputs that quietly go nowhere.
  it("says which Schema Registry TLS fields are ignored, and what file formats are accepted", () => {
    render(<AdvancedTab draft={emptyDraft()} onChange={() => {}} />);

    expect(screen.getByLabelText("Trust store password (not used)")).toBeInTheDocument();
    expect(screen.getByLabelText("Keystore private key password (not used)")).toBeInTheDocument();
    expect(screen.getByText(/PEM certificate bundle/)).toBeInTheDocument();
    expect(screen.getByText(/PKCS#12 file/)).toBeInTheDocument();
    expect(screen.getByText(/JKS files\s+are not supported/)).toBeInTheDocument();
  });
});
