// Thin singleton wrapper around the webview's VS Code API. acquireVsCodeApi()
// may only be called once per webview, so it is centralized here.

import type { WebviewMessage } from "../src/shared/protocol";

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscodeApi: VsCodeApi = acquireVsCodeApi();
