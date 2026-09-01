import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyDraft } from "./draft";
import { SecurityTab } from "./SecurityTab";

describe("SecurityTab", () => {
  it("renders a broker security type dropdown defaulting to Plaintext", () => {
    render(<SecurityTab draft={emptyDraft()} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /PLAINTEXT/ })).toBeInTheDocument();
  });

  it("offers Plaintext, SSL, SASL Plaintext, and SASL SSL as options", async () => {
    const user = userEvent.setup();
    render(<SecurityTab draft={emptyDraft()} onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /PLAINTEXT/ }));

    expect(screen.getByRole("option", { name: "SSL" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "SASL_PLAINTEXT" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "SASL_SSL" })).toBeInTheDocument();
  });

  it("calls onChange with the selected security protocol", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SecurityTab draft={emptyDraft()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /PLAINTEXT/ }));
    await user.click(screen.getByRole("option", { name: "SASL_SSL" }));

    expect(onChange).toHaveBeenCalledWith({ securityProtocol: "SASL_SSL" });
  });

  it("disables the type dropdown when disabled is true", () => {
    render(<SecurityTab draft={emptyDraft()} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /PLAINTEXT/ })).toBeDisabled();
  });

  it("names the file types librdkafka accepts next to each store location", () => {
    render(<SecurityTab draft={emptyDraft()} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Truststore location (.pem, .crt, .cer)")).toBeInTheDocument();
    expect(screen.getByLabelText("Keystore location (.p12, .pfx)")).toBeInTheDocument();
    expect(screen.getByText(/Java \.jks stores are not supported/)).toBeInTheDocument();
  });

  it("renders the broker SSL truststore/keystore fields", () => {
    render(<SecurityTab draft={emptyDraft()} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/^Truststore location/)).toBeInTheDocument();
    expect(screen.getByLabelText("Truststore password")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Keystore location/)).toBeInTheDocument();
    expect(screen.getByLabelText("Keystore password")).toBeInTheDocument();
    expect(screen.getByLabelText("Keystore private key password")).toBeInTheDocument();
  });

  it("masks the truststore/keystore password fields", () => {
    render(<SecurityTab draft={emptyDraft()} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Truststore password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Keystore password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Keystore private key password")).toHaveAttribute("type", "password");
  });

  it("calls onChange with each broker SSL field as it's typed into", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SecurityTab draft={emptyDraft()} onChange={onChange} />);

    await user.type(screen.getByLabelText(/^Truststore location/), "a");
    expect(onChange).toHaveBeenCalledWith({ sslTruststoreLocation: "a" });

    await user.type(screen.getByLabelText("Truststore password"), "b");
    expect(onChange).toHaveBeenCalledWith({ sslTruststorePassword: "b" });

    await user.type(screen.getByLabelText(/^Keystore location/), "c");
    expect(onChange).toHaveBeenCalledWith({ sslKeystoreLocation: "c" });

    await user.type(screen.getByLabelText("Keystore password"), "d");
    expect(onChange).toHaveBeenCalledWith({ sslKeystorePassword: "d" });

    await user.type(screen.getByLabelText("Keystore private key password"), "e");
    expect(onChange).toHaveBeenCalledWith({ sslKeystoreKeyPassword: "e" });
  });

  it("disables the broker SSL fields when disabled is true", () => {
    render(<SecurityTab draft={emptyDraft()} onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText(/^Truststore location/)).toBeDisabled();
    expect(screen.getByLabelText("Keystore private key password")).toBeDisabled();
  });
});
