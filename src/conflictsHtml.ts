// The Conflicts dialog webview document. vscode-free on purpose: the test
// harness (test-harness/gen-conflicts.ts) renders this in a real browser for
// visual verification, and the controller (conflictsPanel.ts) hosts it.

/** How long the Undo button must be held before it fires (the "unlock"). */
export const UNDO_HOLD_MS = 750;

export function renderConflictsHtml(): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Conflicts</title>
  <style>
    [hidden] { display: none !important; }
    html, body { height: 100%; margin: 0; padding: 0; }
    body {
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      display: flex;
      justify-content: center;
      --jb-accent: var(--vscode-gitDecoration-conflictingResourceForeground, #d9604c);
      --jb-ok: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #56a05e));
    }
    .dialog {
      width: min(760px, 100%);
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
      padding: 26px 28px 16px;
    }

    header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .mark { width: 30px; height: 30px; flex: none; }
    h1 { font-size: 16px; font-weight: 600; margin: 0; letter-spacing: 0.2px; }
    .chip {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 2px 8px;
      border-radius: 9px;
      color: var(--jb-accent);
      border: 1px solid var(--jb-accent);
      opacity: 0.9;
    }
    .sub {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin: 6px 0 0 42px;
    }

    .branches {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }
    .branch {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }
    .branch .who { opacity: 0.75; font-family: var(--vscode-font-family); }
    .arrow { color: var(--vscode-descriptionForeground); }

    .progress-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 16px 0 10px;
    }
    .bar {
      flex: 1;
      height: 5px;
      border-radius: 3px;
      background: var(--vscode-widget-border, var(--vscode-panel-border));
      overflow: hidden;
    }
    .bar > div {
      height: 100%;
      width: 0;
      border-radius: 3px;
      background: var(--jb-ok);
      transition: width 0.25s ease;
    }
    .progress-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }

    .done {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      margin-bottom: 14px;
      padding: 16px 12px 14px;
      border-radius: 6px;
      border: 1px solid var(--jb-ok);
      color: var(--jb-ok);
      background: rgba(86, 160, 94, 0.07);
      text-align: center;
    }
    .done h2 { margin: 4px 0 0; font-size: 14px; font-weight: 600; }
    .done .note { color: var(--vscode-descriptionForeground); font-size: 12px; }
    /* Success animation: the ring sweeps in like a loader, then the check draws. */
    .done-ring circle {
      fill: none;
      stroke: var(--jb-ok);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-dasharray: 138;
      stroke-dashoffset: 138;
      transform: rotate(-90deg);
      transform-origin: center;
      animation: ring-sweep 0.7s ease-out forwards;
    }
    .done-ring path {
      fill: none;
      stroke: var(--jb-ok);
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 30;
      stroke-dashoffset: 30;
      animation: check-draw 0.35s ease-out 0.6s forwards;
    }
    @keyframes ring-sweep { to { stroke-dashoffset: 0; } }
    @keyframes check-draw { to { stroke-dashoffset: 0; } }

    .list {
      min-height: 0;
      overflow-y: auto;
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 6px;
      background: var(--vscode-editorWidget-background, transparent);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    .row:last-child { border-bottom: none; }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .row-resolved { background: rgba(86, 160, 94, 0.06); }
    .row-resolved:hover { background: rgba(86, 160, 94, 0.1); }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: none;
      margin: 0 4px;
      background: var(--jb-accent);
      /* Plain fallback first: color-mix needs Chromium 111 (VS Code 1.82+). */
      box-shadow: 0 0 0 3px rgba(217, 96, 76, 0.22);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--jb-accent) 22%, transparent);
    }
    .check-ring {
      width: 16px;
      height: 16px;
      flex: none;
      border-radius: 50%;
      border: 1.5px solid var(--jb-ok);
      color: var(--jb-ok);
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    .file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dir { color: var(--vscode-descriptionForeground); }
    .name { font-weight: 600; }
    .badge {
      font-size: 10px;
      color: var(--jb-accent);
      border: 1px solid var(--jb-accent);
      border-radius: 8px;
      padding: 1px 7px;
      white-space: nowrap;
      opacity: 0.9;
    }
    .choice {
      font-size: 10px;
      color: var(--jb-ok);
      border: 1px solid var(--jb-ok);
      border-radius: 8px;
      padding: 1px 7px;
      white-space: nowrap;
      opacity: 0.9;
    }

    button {
      font-family: inherit;
      font-size: 12px;
      padding: 4px 12px;
      border-radius: 3px;
      cursor: pointer;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      white-space: nowrap;
    }
    button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    button:disabled { opacity: 0.45; cursor: default; }
    .primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .danger {
      background: transparent;
      border-color: var(--vscode-errorForeground);
      color: var(--vscode-errorForeground);
    }
    .danger:hover:not(:disabled) {
      background: var(--vscode-inputValidation-errorBackground, transparent);
    }

    /* Hold-to-unlock Undo: a fill sweeps the button while held; releasing
     * early cancels. Prevents accidental single-click undos. */
    .undo-hold {
      position: relative;
      overflow: hidden;
      background: transparent;
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      color: var(--vscode-descriptionForeground);
      user-select: none;
      touch-action: none;
    }
    .undo-hold:hover:not(:disabled) {
      background: transparent;
      color: var(--vscode-foreground);
      border-color: var(--vscode-descriptionForeground);
    }
    .undo-fill {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0;
      background: rgba(217, 96, 76, 0.3);
      transition-property: width;
      transition-timing-function: linear;
      z-index: 0;
    }
    .undo-label { position: relative; z-index: 1; }
    .undo-hold.arming {
      color: var(--vscode-foreground);
      border-color: var(--jb-accent);
    }

    .spinner {
      width: 14px;
      height: 14px;
      flex: none;
      border: 2px solid var(--vscode-descriptionForeground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 14px;
    }
    .spacer { flex: 1; }
    .counter { color: var(--vscode-descriptionForeground); font-size: 12px; }
  </style>
</head>
<body>
  <div class="dialog">
    <header>
      <svg class="mark" viewBox="0 0 256 256" aria-hidden="true">
        <rect width="256" height="256" rx="56" fill="#1E222A"/>
        <rect x="36" y="44" width="76" height="168" rx="10" fill="#2A303C"/>
        <rect x="144" y="44" width="76" height="168" rx="10" fill="#2A303C"/>
        <rect x="36" y="76" width="76" height="24" fill="#D95F49"/>
        <rect x="144" y="76" width="76" height="24" fill="#D95F49"/>
        <rect x="112" y="76" width="32" height="24" fill="#D95F49" opacity="0.55"/>
        <rect x="36" y="130" width="76" height="24" fill="#4E9456"/>
        <path d="M112 130 L144 140 L144 144 L112 154 Z" fill="#4E9456" opacity="0.55"/>
        <rect x="144" y="184" width="76" height="24" fill="#4173AE"/>
        <path d="M144 184 L112 194 L112 198 L144 208 Z" fill="#4173AE" opacity="0.55"/>
      </svg>
      <h1>Merge Conflicts</h1>
      <span class="chip" id="chip"></span>
      <div class="branches" id="branches" hidden>
        <span class="branch"><span class="who">yours</span><span id="yours"></span></span>
        <span class="arrow">⟵</span>
        <span class="branch"><span class="who">theirs</span><span id="theirs"></span></span>
      </div>
    </header>
    <div class="sub" id="sub"></div>

    <div class="progress-row" id="progressRow" hidden>
      <div class="bar"><div id="barFill"></div></div>
      <span class="progress-label" id="progressLabel"></span>
    </div>

    <div class="done" id="done" hidden>
      <svg class="done-ring" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="22"/>
        <path d="M14 25 L21 32 L34 17"/>
      </svg>
      <h2>All conflicts resolved</h2>
      <span class="note">Review below — hold Undo to revert a file, or close when you're ready. Committing the merge closes this dialog too.</span>
    </div>

    <div class="list" id="list"></div>

    <footer>
      <button class="danger" id="abort"></button>
      <span class="spacer"></span>
      <span class="counter" id="counter"></span>
      <button class="primary" id="close" hidden>Close</button>
    </footer>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const HOLD_MS = ${UNDO_HOLD_MS};
    const el = (id) => document.getElementById(id);
    const list = el("list");

    el("abort").addEventListener("click", () => vscode.postMessage({ type: "abort" }));
    el("close").addEventListener("click", () => vscode.postMessage({ type: "close" }));

    window.addEventListener("message", (event) => {
      const state = event.data;
      if (state && state.type === "state") render(state);
    });

    function cap(word) { return word.charAt(0).toUpperCase() + word.slice(1); }

    function render(state) {
      const files = state.files;
      const pending = files.filter((f) => f.status !== "resolved").length;
      const allDone = files.length > 0 && pending === 0;

      el("chip").textContent = state.operation + " in progress";
      el("chip").hidden = allDone; // resolved: the green banner says it all
      el("sub").textContent =
        "Resolve each file below, or cancel the " + state.operation +
        " to restore the repository to the state before it started.";
      el("sub").hidden = allDone;

      const hasBranches = state.yoursName || state.theirsName;
      el("branches").hidden = !hasBranches;
      if (hasBranches) {
        el("yours").textContent = state.yoursName || "HEAD";
        el("theirs").textContent = state.theirsName || "incoming";
      }

      el("progressRow").hidden = state.total === 0;
      if (state.total > 0) {
        el("barFill").style.width =
          Math.round((state.resolved / state.total) * 100) + "%";
        el("progressLabel").textContent =
          state.resolved + " of " + state.total + " resolved";
      }

      el("done").hidden = !allDone;
      el("close").hidden = !allDone;

      const abortBtn = el("abort");
      abortBtn.textContent = "Cancel " + cap(state.operation);
      abortBtn.disabled = state.busy;

      el("counter").textContent =
        pending === 0
          ? ""
          : pending === 1
            ? "1 conflicting file"
            : pending + " conflicting files";

      list.replaceChildren(...files.map((file) => row(file, state)));
    }

    function row(file, state) {
      const item = document.createElement("div");
      item.className = "row" + (file.status === "resolved" ? " row-resolved" : "");

      if (file.status === "busy") {
        const spinner = document.createElement("span");
        spinner.className = "spinner";
        item.appendChild(spinner);
      } else if (file.status === "resolved") {
        item.appendChild(checkRing());
      } else {
        const dot = document.createElement("span");
        dot.className = "dot";
        item.appendChild(dot);
      }

      const name = document.createElement("span");
      name.className = "file";
      const slash = file.rel.lastIndexOf("/");
      const dir = document.createElement("span");
      dir.className = "dir";
      dir.textContent = slash >= 0 ? file.rel.slice(0, slash + 1) : "";
      const base = document.createElement("span");
      base.className = "name";
      base.textContent = slash >= 0 ? file.rel.slice(slash + 1) : file.rel;
      name.append(dir, base);
      item.appendChild(name);

      if (file.status === "pending" && file.badge) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = file.badge;
        item.appendChild(badge);
      }

      if (file.status === "resolved") {
        const choice = document.createElement("span");
        choice.className = "choice";
        choice.textContent =
          file.choice === "yours" ? "✓ kept yours"
          : file.choice === "theirs" ? "✓ kept theirs"
          : "✓ merged";
        choice.title =
          file.choice === "yours" ? "Resolved with your version" + yoursSuffix(state)
          : file.choice === "theirs" ? "Resolved with the incoming version" + theirsSuffix(state)
          : "Resolved in the merge editor (or externally)";
        item.appendChild(choice);
        item.appendChild(holdUndoButton(file, item));
      } else if (file.status === "pending") {
        const busy = state.busy;
        item.append(
          action(item, "Accept Yours", "Keep your version" + yoursSuffix(state), busy,
            { type: "accept", side: "ours", uri: file.uri }),
          action(item, "Accept Theirs", "Take the incoming version" + theirsSuffix(state), busy,
            { type: "accept", side: "theirs", uri: file.uri }),
          action(item, "Merge…", "Resolve side by side in the merge editor", busy,
            { type: "merge", uri: file.uri }, "primary"),
        );
      }
      return item;
    }

    function yoursSuffix(state) { return state.yoursName ? " (" + state.yoursName + ")" : ""; }
    function theirsSuffix(state) { return state.theirsName ? " (" + state.theirsName + ")" : ""; }

    function checkRing() {
      const ring = document.createElement("span");
      ring.className = "check-ring";
      ring.innerHTML =
        '<svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<path d="M3 8.5 L6.5 12 L13 4.5" stroke="currentColor" stroke-width="2.5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
      return ring;
    }

    function action(rowEl, label, title, busy, message, variant) {
      const btn = document.createElement("button");
      if (variant) btn.classList.add(variant);
      btn.textContent = label;
      btn.title = title;
      btn.disabled = busy;
      btn.addEventListener("click", () => {
        if (message.type === "accept") markRowBusy(rowEl); // instant feedback
        vscode.postMessage(message);
      });
      return btn;
    }

    function markRowBusy(rowEl) {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      rowEl.querySelectorAll("button, .badge").forEach((n) => n.remove());
      rowEl.firstChild.replaceWith(spinner);
    }

    /** The unlock: hold for HOLD_MS while a fill sweeps the button. */
    function holdUndoButton(file, rowEl) {
      const btn = document.createElement("button");
      btn.className = "undo-hold";
      btn.title = "Hold to restore this conflict";
      const fill = document.createElement("span");
      fill.className = "undo-fill";
      const label = document.createElement("span");
      label.className = "undo-label";
      label.textContent = "Hold to undo";
      btn.append(fill, label);

      let timer = 0;
      const start = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        btn.classList.add("arming");
        fill.style.transitionDuration = HOLD_MS + "ms";
        // Force a layout so the transition starts from 0 even mid-cancel.
        void fill.offsetWidth;
        fill.style.width = "100%";
        timer = window.setTimeout(() => {
          timer = 0;
          markRowBusy(rowEl);
          vscode.postMessage({ type: "undo", uri: file.uri });
        }, HOLD_MS);
      };
      const cancel = () => {
        if (!timer) return;
        window.clearTimeout(timer);
        timer = 0;
        btn.classList.remove("arming");
        fill.style.transitionDuration = "180ms";
        fill.style.width = "0%";
      };
      btn.addEventListener("pointerdown", start);
      btn.addEventListener("pointerup", cancel);
      btn.addEventListener("pointerleave", cancel);
      btn.addEventListener("pointercancel", cancel);
      return btn;
    }
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
