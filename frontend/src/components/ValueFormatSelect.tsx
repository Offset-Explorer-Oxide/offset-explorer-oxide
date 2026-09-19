import { KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useRef, useState } from "react";
import { ValueMode } from "../features/workspace/useMessageViewerPrefsStore";
import {
  AvroFormatIcon,
  Base64FormatIcon,
  HexFormatIcon,
  JsonFormatIcon,
  ProtobufFormatIcon,
  RawFormatIcon,
  XmlFormatIcon,
} from "./FormatIcons";

export interface ValueFormat {
  id: ValueMode;
  label: string;
  icon: ReactNode;
  /**
   * `"structured"` formats interpret the payload and can fail to; `"literal"`
   * ones render the bytes themselves and always succeed. The dropdown draws a
   * rule between the two groups.
   */
  group: "structured" | "literal";
  /** The extension a payload saved in this format gets by default. */
  extension: string;
}

/**
 * Every format the Value view can render, in the order the dropdown lists
 * them: the structured readings first, because they are what a user opens a
 * message to see, then the three literal ones — which exist for the moments
 * a structured read fails and the question becomes "what *are* these bytes?"
 * — under a rule at the bottom, where they stay out of the way.
 */
export const VALUE_FORMATS: ValueFormat[] = [
  { id: "json", label: "JSON", icon: <JsonFormatIcon />, group: "structured", extension: "json" },
  { id: "xml", label: "XML", icon: <XmlFormatIcon />, group: "structured", extension: "xml" },
  { id: "avro", label: "Avro", icon: <AvroFormatIcon />, group: "structured", extension: "json" },
  { id: "protobuf", label: "Protobuf", icon: <ProtobufFormatIcon />, group: "structured", extension: "json" },
  { id: "raw", label: "Raw", icon: <RawFormatIcon />, group: "literal", extension: "txt" },
  { id: "hex", label: "Hex", icon: <HexFormatIcon />, group: "literal", extension: "hex" },
  { id: "base64", label: "Base64", icon: <Base64FormatIcon />, group: "literal", extension: "b64" },
];

export function valueFormat(id: ValueMode): ValueFormat {
  return VALUE_FORMATS.find((format) => format.id === id) ?? VALUE_FORMATS[0];
}

export interface ValueFormatSelectProps {
  value: ValueMode;
  onChange: (value: ValueMode) => void;
}

/**
 * The Value view's format picker.
 *
 * A dropdown rather than the row of Text/JSON/Avro/XML buttons it replaced:
 * the row cost one line of a pane that is often only a few hundred pixels
 * wide, and every format added to it took more. A dropdown costs the same
 * space whatever the list holds, which is what makes room for Hex and Base64
 * without pushing the payload itself further down.
 *
 * Built here rather than on the shared `Dropdown` because that one renders
 * plain string labels in a flat list, and this needs an icon beside each name
 * and a rule between the two groups. The open/close, outside-click, Escape
 * and arrow-key behaviour deliberately mirrors it so the two feel identical.
 */
export function ValueFormatSelect({ value, onChange }: ValueFormatSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const selected = valueFormat(value);

  function close() {
    setOpen(false);
  }

  function commit(id: ValueMode) {
    onChange(id);
    close();
    toggleRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        toggleRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Focus lands on the applied format when the list opens, so Enter without
  // moving is a no-op rather than a silent jump to the first entry.
  useEffect(() => {
    if (!open) return;
    const index = Math.max(
      VALUE_FORMATS.findIndex((format) => format.id === value),
      0,
    );
    optionRefs.current[index]?.focus();
    // Only on the transition to open — re-running on `value` would fight the
    // user's own arrow keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleOptionKeyDown(e: ReactKeyboardEvent<HTMLLIElement>, index: number, id: ValueMode) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        optionRefs.current[Math.min(index + 1, VALUE_FORMATS.length - 1)]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        optionRefs.current[Math.max(index - 1, 0)]?.focus();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(id);
        break;
      default:
        break;
    }
  }

  return (
    <div className="value-format-select" ref={rootRef}>
      <button
        type="button"
        ref={toggleRef}
        className="value-format-toggle"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Value format: ${selected.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="value-format-icon">{selected.icon}</span>
        <span className="value-format-label">{selected.label}</span>
        <span className="value-format-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className="value-format-list" role="listbox" aria-label="Value format">
          {VALUE_FORMATS.map((format, index) => (
            <li
              key={format.id}
              role="option"
              tabIndex={-1}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              aria-selected={format.id === value}
              className={`value-format-option${
                // The rule sits above the first literal format, so the two
                // groups read as two groups however many formats each holds.
                index > 0 && format.group === "literal" && VALUE_FORMATS[index - 1].group !== "literal"
                  ? " value-format-option--group-start"
                  : ""
              }${format.id === value ? " value-format-option--selected" : ""}`}
              onClick={() => commit(format.id)}
              onKeyDown={(e) => handleOptionKeyDown(e, index, format.id)}
            >
              <span className="value-format-icon">{format.icon}</span>
              <span className="value-format-label">{format.label}</span>
              {format.id === value && (
                <span className="value-format-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
