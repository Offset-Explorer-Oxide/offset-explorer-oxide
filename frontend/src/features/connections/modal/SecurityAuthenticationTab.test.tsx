import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { emptyDraft } from "./draft";
import { SecurityAuthenticationTab } from "./SecurityAuthenticationTab";

describe("SecurityAuthenticationTab", () => {
  it("puts broker security and authentication on one panel", () => {
    render(<SecurityAuthenticationTab draft={emptyDraft()} onChange={vi.fn()} />);

    // One tab panel, not two — the two halves used to be separate tabs.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Security & Authentication");
    expect(screen.getByRole("heading", { name: "Broker security" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Authentication" })).toBeInTheDocument();
  });

  /**
   * Order is the point of merging them: the protocol chosen under Broker
   * security is what decides whether a SASL mechanism is needed at all, so it
   * has to be the thing read first.
   */
  it("shows the security fields before the authentication fields", () => {
    render(<SecurityAuthenticationTab draft={emptyDraft()} onChange={vi.fn()} />);

    const security = screen.getByRole("heading", { name: "Broker security" });
    const authentication = screen.getByRole("heading", { name: "Authentication" });

    expect(security.compareDocumentPosition(authentication) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("carries the fields of both halves", () => {
    const draft = { ...emptyDraft(), saslMechanism: "PLAIN" as const };
    render(<SecurityAuthenticationTab draft={draft} onChange={vi.fn()} />);

    expect(screen.getByLabelText(/^Truststore location/)).toBeInTheDocument();
    expect(screen.getByLabelText("Keystore private key password")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("disables both halves when disabled is true", () => {
    const draft = { ...emptyDraft(), saslMechanism: "PLAIN" as const };
    render(<SecurityAuthenticationTab draft={draft} onChange={vi.fn()} disabled />);

    expect(screen.getByLabelText(/^Truststore location/)).toBeDisabled();
    expect(screen.getByLabelText("Username")).toBeDisabled();
  });
});
