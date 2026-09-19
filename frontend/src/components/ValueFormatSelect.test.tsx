import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ValueFormatSelect, valueFormat, VALUE_FORMATS } from "./ValueFormatSelect";
import { VALUE_MODES } from "../features/workspace/useMessageViewerPrefsStore";

describe("ValueFormatSelect", () => {
  it("shows the selected format on the closed toggle", () => {
    render(<ValueFormatSelect value="hex" onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Value format: Hex" })).toHaveTextContent("Hex");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  // The order is the whole point of the grouping: the formats a user opens a
  // message to read come first, and the three literal renderings of the bytes
  // sit under a rule at the bottom.
  it("lists the structured formats above the literal ones", async () => {
    const user = userEvent.setup();
    render(<ValueFormatSelect value="raw" onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Value format:/ }));

    expect(screen.getAllByRole("option").map((option) => option.textContent?.replace("✓", ""))).toEqual([
      "JSON",
      "XML",
      "Avro",
      "Protobuf",
      "Raw",
      "Hex",
      "Base64",
    ]);
  });

  it("draws the rule above the first literal format and nowhere else", async () => {
    const user = userEvent.setup();
    render(<ValueFormatSelect value="raw" onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Value format:/ }));

    const separated = screen
      .getAllByRole("option")
      .filter((option) => option.classList.contains("value-format-option--group-start"));
    expect(separated).toHaveLength(1);
    expect(separated[0]).toHaveTextContent("Raw");
  });

  it("shows an icon beside every format name", async () => {
    const user = userEvent.setup();
    render(<ValueFormatSelect value="raw" onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Value format:/ }));

    for (const option of screen.getAllByRole("option")) {
      expect(option.querySelector(".value-format-icon svg")).not.toBeNull();
    }
  });

  it("marks the applied format as selected", async () => {
    const user = userEvent.setup();
    render(<ValueFormatSelect value="avro" onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Value format:/ }));

    expect(screen.getByRole("option", { name: "Avro" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "JSON" })).toHaveAttribute("aria-selected", "false");
  });

  it("commits the clicked format and closes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ValueFormatSelect value="raw" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /^Value format:/ }));
    await user.click(screen.getByRole("option", { name: "Base64" }));

    expect(onChange).toHaveBeenCalledWith("base64");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("commits with the keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ValueFormatSelect value="json" onChange={onChange} />);

    // Focus opens on the applied format (JSON, the first entry); one step
    // down is XML.
    await user.click(screen.getByRole("button", { name: /^Value format:/ }));
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("xml");
  });

  it("closes on Escape without committing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ValueFormatSelect value="raw" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /^Value format:/ }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on an outside click without committing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <ValueFormatSelect value="raw" onChange={onChange} />
        <button type="button">elsewhere</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /^Value format:/ }));
    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives the checkmark to the applied format only", async () => {
    const user = userEvent.setup();
    render(<ValueFormatSelect value="xml" onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^Value format:/ }));

    expect(within(screen.getByRole("option", { name: "XML" })).getByText("✓")).toBeInTheDocument();
    expect(within(screen.getByRole("option", { name: "JSON" })).queryByText("✓")).not.toBeInTheDocument();
  });
});

describe("valueFormat", () => {
  it("gives every format a file extension for the Save button", () => {
    for (const format of VALUE_FORMATS) {
      expect(valueFormat(format.id).extension).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("saves Avro as .json — the decoded document is JSON, whatever the wire format was", () => {
    expect(valueFormat("avro").extension).toBe("json");
  });
});

describe("the format lists stay in step", () => {
  /**
   * There are two runtime lists of formats — the dropdown's `VALUE_FORMATS`
   * and the prefs store's `VALUE_MODES`, which validates what comes back out
   * of localStorage — plus the `ValueMode` type over both. TypeScript catches
   * a bad *id*, but not a format that is missing from one list entirely, and
   * the symptom of that is indirect: the format can be chosen, and is then
   * silently reset to Raw on the next run.
   */
  it("offers exactly the formats the prefs store will accept back from storage", () => {
    expect([...VALUE_FORMATS.map((format) => format.id)].sort()).toEqual([...VALUE_MODES].sort());
  });

  it("puts every structured format above every literal one", () => {
    const groups = VALUE_FORMATS.map((format) => format.group);

    expect(groups.lastIndexOf("structured")).toBeLessThan(groups.indexOf("literal"));
  });

  it("has no duplicate ids", () => {
    const ids = VALUE_FORMATS.map((format) => format.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
