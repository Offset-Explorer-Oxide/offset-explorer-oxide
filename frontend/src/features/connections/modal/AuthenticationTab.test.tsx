import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyDraft } from "./draft";
import { AuthenticationTab } from "./AuthenticationTab";

describe("AuthenticationTab", () => {
  it("renders the SASL mechanism dropdown", () => {
    render(<AuthenticationTab draft={emptyDraft()} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /None/ })).toBeInTheDocument();
  });

  it("hides Username, Password, and OAuth URL until a mechanism is selected", () => {
    render(<AuthenticationTab draft={emptyDraft()} onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SASL OAuth/OIDC identity provider URL")).not.toBeInTheDocument();
  });

  it("shows Username, Password, and OAuth URL once a mechanism is selected", () => {
    const draft = { ...emptyDraft(), saslMechanism: "PLAIN" as const };
    render(<AuthenticationTab draft={draft} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("SASL OAuth/OIDC identity provider URL")).toBeInTheDocument();
  });

  it("masks the password field", () => {
    const draft = { ...emptyDraft(), saslMechanism: "SCRAM-SHA-256" as const };
    render(<AuthenticationTab draft={draft} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("calls onChange with the selected sasl mechanism", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AuthenticationTab draft={emptyDraft()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /None/ }));
    await user.click(screen.getByRole("option", { name: "SCRAM-SHA-256" }));

    expect(onChange).toHaveBeenCalledWith({ saslMechanism: "SCRAM-SHA-256" });
  });

  it("calls onChange when username and password are typed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const draft = { ...emptyDraft(), saslMechanism: "PLAIN" as const };
    render(<AuthenticationTab draft={draft} onChange={onChange} />);

    await user.type(screen.getByLabelText("Username"), "k");
    expect(onChange).toHaveBeenCalledWith({ saslUsername: "k" });

    await user.type(screen.getByLabelText("Password"), "p");
    expect(onChange).toHaveBeenCalledWith({ saslPassword: "p" });
  });

  it("disables every field when disabled is true", () => {
    const draft = { ...emptyDraft(), saslMechanism: "PLAIN" as const };
    render(<AuthenticationTab draft={draft} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /PLAIN/ })).toBeDisabled();
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByLabelText("SASL OAuth/OIDC identity provider URL")).toBeDisabled();
  });
});
