/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the shape of `frontend/package.json` itself.
 *
 * This exists because of a dependency that broke CI on Windows with a bare
 * `npm error Cannot read properties of null (reading 'edgesOut')`: this
 * package was then named `kafkaoxide` *and* declared
 * `"kafkaoxide": "file:.."`, pointing at the repo root — which carried the
 * same name, and which contains this directory. npm materialised that as a
 * symlink from `frontend/node_modules/kafkaoxide` back to the repo root, so
 * the tree walked `.../frontend/node_modules/...` forever. Nothing ever
 * imported it. Both packages are called `salty` now; the rule is what
 * matters, not the name.
 *
 * None of that is visible reading the file — `"file:.."` looks like an
 * ordinary local dependency — so the rule is asserted rather than left to be
 * noticed again three years from now.
 */
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const allDependencies = { ...manifest.dependencies, ...manifest.devDependencies };

describe("frontend/package.json", () => {
  it("does not depend on itself by name", () => {
    expect(Object.keys(allDependencies)).not.toContain(manifest.name);
  });

  /**
   * A `file:` dependency on `..` (or any ancestor) puts this package inside
   * its own dependency's directory tree — the cycle above. A `file:` on a
   * *sibling* or child would be fine, so the rule is about ancestors, not
   * about `file:` in general.
   */
  it("has no file: dependency pointing at an ancestor directory", () => {
    const ancestorDeps = Object.entries(allDependencies).filter(
      ([, spec]) => spec.startsWith("file:") && /^file:\.\.(\/|$)/.test(spec),
    );

    expect(ancestorDeps).toEqual([]);
  });

  it("still declares the app's real dependencies", () => {
    // A sanity check, so the two rules above can't pass by the file being
    // empty or unparsed.
    expect(Object.keys(allDependencies)).toEqual(expect.arrayContaining(["react", "vite", "vitest"]));
  });
});
