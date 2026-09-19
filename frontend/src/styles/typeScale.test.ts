/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The stylesheet's own source text.
 *
 * Read off disk rather than imported. `import "./global.css"` hands back
 * Vite's processed module, and `?raw` — the obvious alternative — resolves to
 * an **empty string** under Vitest, because the CSS plugin intercepts it
 * before the raw loader sees it. An empty string passes every "does not
 * contain" assertion below, so the guard would have looked green while
 * checking nothing; that is what the length assertion in the first test is
 * there to catch.
 *
 * The triple-slash reference above keeps `@types/node` scoped to this one
 * file instead of putting Node's globals in scope for the whole app.
 */
const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");

/**
 * Guards the fix for "the font settings do nothing to the middle and right
 * panels".
 *
 * That bug was not one mistake — it was ~65 stylesheet rules that each
 * independently hard-coded a pixel size, and five that hard-coded a
 * monospace stack. Nothing about writing `font-size: 12px` in a new rule
 * looks wrong in review, so the only durable guard is one that reads the
 * stylesheet and refuses the absolute value outright.
 */
describe("global.css typography", () => {
  it("declares no absolute font sizes — every size is a step on the scale", () => {
    // Proves the file was actually read: an empty string would satisfy every
    // "does not contain" assertion in this suite. See the note on `css`.
    expect(css.length).toBeGreaterThan(1000);

    const absolute = css.match(/font-size:\s*\d+(\.\d+)?(px|pt)/g) ?? [];
    expect(absolute).toEqual([]);
  });

  it("defines each step of the scale from --font-size-base", () => {
    for (const step of ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]) {
      expect(css).toContain(`--font-size-${step}:`);
    }
    // Each step has to be relative to the base, or the setting moves some of
    // the app and not the rest.
    const scaleBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
    for (const line of scaleBlock.split("\n").filter((line: string) => line.includes("--font-size-") && !line.includes("--font-size-base:"))) {
      expect(line).toContain("var(--font-size-base)");
    }
  });

  /**
   * The one place a literal monospace stack is still correct is the hex
   * dump, whose columns only line up in one — everything else has to follow
   * the user's chosen font via `--font-family-mono`.
   */
  it("pins a literal monospace stack only on the hex view", () => {
    const literalMono = (css.match(/^\s*font-family:\s*ui-monospace[^;]*;/gm) ?? []).length;

    expect(literalMono).toBe(1);
    expect(css).toContain(".code-view--monospace");
  });

  it("routes the code surfaces through --font-family-mono", () => {
    for (const selector of [".logs-panel", ".code-view", ".message-payload-body", ".json-tree", ".topic-schema-editor"]) {
      const start = css.indexOf(`\n${selector} {`);
      expect(start, `${selector} should exist`).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf("}", start));
      expect(block, `${selector} should follow the font setting`).toContain("var(--font-family-mono");
    }
  });
});
