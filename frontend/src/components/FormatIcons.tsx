/**
 * The payload-format glyphs shown in the format dropdown, one per
 * `ValueMode`.
 *
 * Drawn here rather than pulled from an icon set for the same reason every
 * other icon in this app is: the app ships no icon dependency, and these are
 * a dozen path commands each. They are deliberately *shape*-distinct rather
 * than lettered — at 14px a "J" and an "X" are two smudges, while braces,
 * angle brackets and a hexagon are still telling apart at a glance.
 */

const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  "aria-hidden": true,
} as const;

/** JSON — the braces that open and close every JSON document. */
export function JsonFormatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        d="M6.2 2.5C4.8 2.5 4.6 3.4 4.6 4.6v1.2c0 1-.5 1.6-1.4 1.8v.8c.9.2 1.4.8 1.4 1.8v1.2c0 1.2.2 2.1 1.6 2.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.8 2.5c1.4 0 1.6.9 1.6 2.1v1.2c0 1 .5 1.6 1.4 1.8v.8c-.9.2-1.4.8-1.4 1.8v1.2c0 1.2-.2 2.1-1.6 2.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** XML — a tag's angle brackets with the closing slash between them. */
export function XmlFormatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9.2 3l-2.4 10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Avro — stacked layers, for a payload read through a schema. */
export function AvroFormatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M8 1.8 14.2 5 8 8.2 1.8 5 8 1.8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="m1.8 8.6 6.2 3.2 6.2-3.2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="m1.8 11.8 6.2 3.2 6.2-3.2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Protobuf — a schema graph: one node branching into fields, which is what a
 * `.proto` describes and what separates it at a glance from Avro's stacked
 * layers beside it in the list.
 */
export function ProtobufFormatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="3.6" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12.4" cy="3.8" r="1.7" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12.4" cy="12.2" r="1.7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.1 7.2 10.9 4.5M5.1 8.8l5.8 2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Raw — lines of text on a page. */
export function RawFormatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        d="M3.5 2.5h9v11h-9z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Hex — a hexagon, the one shape the word itself suggests. */
export function HexFormatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        d="M8 1.8 13.4 5v6L8 14.2 2.6 11V5L8 1.8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M6 6.5h4M6 9.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Base64 — blocks of encoded data, four to a group. */
export function Base64FormatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.2" y="2.2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.8" y="2.2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.2" y="8.8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.8" y="8.8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
