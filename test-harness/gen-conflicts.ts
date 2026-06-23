// Generates test-harness/conflicts.html: the REAL Conflicts dialog document
// (renderConflictsHtml) plus a shim that fakes the VS Code webview API and
// posts a representative state. Run: npx tsx test-harness/gen-conflicts.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderConflictsHtml } from "../src/conflictsHtml";

let html = renderConflictsHtml();
const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
if (!nonce) {
  throw new Error("nonce not found in generated HTML");
}

const shim = `<script nonce="${nonce}">
  globalThis.acquireVsCodeApi = () => ({
    postMessage: (m) => { (window.__sent = window.__sent || []).push(m); },
    getState: () => undefined,
    setState: () => {},
  });
</script>`;

const state = {
  type: "state",
  operation: "merge",
  yoursName: "feature/auth-hardening",
  theirsName: "main",
  busy: false,
  total: 8,
  resolved: 3,
  files: [
    { uri: "file:///r/src/auth/authorizeRequest.ts", rel: "src/auth/authorizeRequest.ts", badge: "", status: "pending", choice: null },
    { uri: "file:///r/src/auth/session.ts", rel: "src/auth/session.ts", badge: "", status: "pending", choice: null },
    { uri: "file:///r/src/server/rateLimit.ts", rel: "src/server/rateLimit.ts", badge: "added by both", status: "pending", choice: null },
    { uri: "file:///r/src/api/routes.ts", rel: "src/api/routes.ts", badge: "", status: "busy", choice: null },
    { uri: "file:///r/src/db/migrations/0042_audit.sql", rel: "src/db/migrations/0042_audit.sql", badge: "deleted by them", status: "pending", choice: null },
    { uri: "file:///r/src/config/flags.ts", rel: "src/config/flags.ts", badge: "", status: "resolved", choice: "theirs" },
    { uri: "file:///r/package.json", rel: "package.json", badge: "", status: "resolved", choice: "merged" },
    { uri: "file:///r/README.md", rel: "README.md", badge: "", status: "resolved", choice: "yours" },
  ],
};

const poster = `<script nonce="${nonce}">
  window.postMessage(${JSON.stringify(state)}, "*");
</script>`;

html = html.replace("<script nonce", `${shim}<script nonce`);
html = html.replace("</body>", `${poster}</body>`);
// Theme vars for a standalone browser (VS Code injects these normally).
html = html.replace(
  "<body>",
  `<body style="--vscode-foreground:#ccc;--vscode-editor-background:#1e1e1e;` +
    `--vscode-descriptionForeground:#9d9d9d;--vscode-panel-border:#3c3c3c;` +
    `--vscode-font-family:-apple-system,sans-serif;--vscode-font-size:13px;` +
    `--vscode-badge-background:#4d4d4d;--vscode-badge-foreground:#fff;` +
    `--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;` +
    `--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#f0f0f0;` +
    `--vscode-errorForeground:#f48771;--vscode-editorWidget-background:#252526;">`,
);

writeFileSync(join(import.meta.dirname, "conflicts.html"), html);

const doneState = {
  ...state,
  resolved: 8,
  files: state.files.map((f) =>
    f.status === "resolved" ? f : { ...f, status: "resolved", choice: f.rel.includes("api") ? "theirs" : "yours" },
  ),
};
const doneHtml = html.replace(JSON.stringify(state), JSON.stringify(doneState));
writeFileSync(join(import.meta.dirname, "conflicts-done.html"), doneHtml);

// Long branch name: confirms the name truncates (ellipsis + hover title)
// instead of wrapping the branch pill onto multiple lines.
const longState = {
  ...state,
  yoursName: "main",
  theirsName: "origin/feature/payments-refactor-experimental-do-not-merge",
};
const longHtml = html.replace(JSON.stringify(state), JSON.stringify(longState));
writeFileSync(join(import.meta.dirname, "conflicts-longnames.html"), longHtml);

console.log(
  "wrote test-harness/conflicts.html, conflicts-done.html, conflicts-longnames.html",
);
