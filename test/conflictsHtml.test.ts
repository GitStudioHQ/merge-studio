import { test } from "node:test";
import assert from "node:assert/strict";
import { renderConflictsHtml, UNDO_HOLD_MS } from "../src/conflictsHtml";

// Invariants of the Conflicts dialog document that broke (or nearly broke)
// during development — cheap string-level regression guards.

test("the hidden attribute always wins over display rules", () => {
  // Regression: `.done { display: flex }` once overrode the hidden
  // attribute, so "All conflicts resolved" rendered next to live conflicts.
  assert.match(renderConflictsHtml(), /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test("every script tag carries the CSP nonce", () => {
  const html = renderConflictsHtml();
  const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
  assert.ok(nonce, "CSP nonce present");
  const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
  assert.ok(scripts.length > 0, "has script tags");
  for (const tag of scripts) {
    assert.ok(
      tag.includes(`nonce="${nonce}"`),
      `script tag missing nonce: ${tag}`,
    );
  }
});

test("branch names are built as text nodes, never via innerHTML", () => {
  // setBranch renders attacker-influenceable git branch names (HEAD / incoming).
  // It must route them through DOM text nodes, never an HTML sink, so a name
  // can't inject markup. Guards against a regression to `el(id).innerHTML = …`.
  const html = renderConflictsHtml();
  // Capture the whole setBranch function — from its declaration up to the next
  // function in the rendered script — so the guard holds regardless of how the
  // body is restructured internally. assert.ok narrows `body` to a string.
  const body = /function setBranch\b[\s\S]*?(?=\n\s*function )/.exec(html)?.[0];
  assert.ok(body, "setBranch present in rendered document");
  assert.doesNotMatch(body, /\.innerHTML\s*=/, "setBranch must not assign innerHTML");
  assert.match(body, /createTextNode/, "branch name built from text nodes");
  assert.match(body, /createElement\("wbr"\)/, "<wbr> inserted as an element");
});

test("nonces differ between renders", () => {
  const a = /'nonce-([^']+)'/.exec(renderConflictsHtml())?.[1];
  const b = /'nonce-([^']+)'/.exec(renderConflictsHtml())?.[1];
  assert.ok(a && b && a !== b);
});

test("the undo hold duration is embedded in the document", () => {
  assert.ok(renderConflictsHtml().includes(`const HOLD_MS = ${UNDO_HOLD_MS}`));
  assert.equal(UNDO_HOLD_MS, 750);
});

test("the dialog wires every message the controller handles", () => {
  const html = renderConflictsHtml();
  for (const type of ["accept", "merge", "undo", "abort", "close"]) {
    assert.ok(
      html.includes(`type: "${type}"`),
      `webview never posts "${type}"`,
    );
  }
});
