import { useMemo } from "react";

export interface LineNumberedTextProps {
  text: string;
  /** aria-label for the code region, e.g. "Payload as hex". */
  ariaLabel?: string;
  /**
   * Forces a monospace stack instead of following the app's font setting.
   *
   * For the hex dump only, where the columns *are* the view: a proportional
   * font turns an aligned grid of byte pairs into ragged text and the offset
   * and ASCII columns stop lining up at all. Everywhere else the chosen font
   * is what the user asked to read payloads in.
   */
  forceMonospace?: boolean;
}

/**
 * Monospaced text with a line-number gutter, the way an editor shows a file.
 *
 * The gutter is its own `<pre>` beside the content rather than a number
 * prepended to each line, so selecting and copying the payload yields the
 * payload — not the payload with a line number welded to the front of every
 * line, which is what any markup that interleaves them produces.
 *
 * That alignment is only true while one logical line occupies exactly one
 * visual row, so the content deliberately does not wrap (`white-space: pre`)
 * and scrolls horizontally instead. Wrapping would slide the payload down
 * against a gutter that cannot know it happened, and every number below a
 * wrapped line would point at the wrong text.
 */
export function LineNumberedText({ text, ariaLabel, forceMonospace = false }: LineNumberedTextProps) {
  // Counting newlines is O(text) and this renders on every re-render of the
  // viewer (panel tab switches, a hover, a parent's state change), so it is
  // memoised alongside the gutter string it feeds — on a 256 KB preview that
  // is tens of thousands of numbers to build.
  const gutter = useMemo(() => {
    let lines = 1;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) lines++;
    }
    // A trailing newline ends the last line rather than starting an empty
    // one; numbering it would show a number against no text.
    if (text.endsWith("\n")) lines--;
    const numbers: string[] = [];
    for (let n = 1; n <= Math.max(lines, 1); n++) numbers.push(String(n));
    return numbers.join("\n");
  }, [text]);

  return (
    <div className={`code-view${forceMonospace ? " code-view--monospace" : ""}`} role="group" aria-label={ariaLabel}>
      <pre className="code-gutter" aria-hidden="true">
        {gutter}
      </pre>
      <pre className="code-body message-payload-body">{text}</pre>
    </div>
  );
}
