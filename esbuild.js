const esbuild = require("esbuild");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * monaco-editor vendors its own copy of DOMPurify (0.55.1 ships 3.2.7), which
 * is subject to a series of sanitizer-bypass advisories. Redirect monaco's
 * internal `./dompurify/dompurify.js` import to the patched standalone
 * dompurify (>= 3.4.11, pinned via the npm "overrides" in package.json) so the
 * bundled webview carries the fixed copy rather than monaco's stale one. Both
 * expose the same default export and the APIs monaco uses (sanitize / addHook /
 * removeAllHooks), so the swap is drop-in.
 * @type {import('esbuild').Plugin}
 */
const dompurifyRedirectPlugin = {
  name: "dompurify-redirect",
  setup(build) {
    const patched = path.resolve(
      __dirname,
      "node_modules/dompurify/dist/purify.es.mjs",
    );
    build.onResolve({ filter: /dompurify[\\/]dompurify\.js$/ }, () => ({
      path: patched,
    }));
  },
};

/**
 * Emits the start/finish markers + error format that the custom problem matcher
 * in .vscode/tasks.json keys off, so the F5 build task knows when watch is ready.
 * @type {import('esbuild').Plugin}
 */
const problemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => console.log("[watch] build started"));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log("[watch] build finished");
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const base = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: "silent",
  plugins: [problemMatcherPlugin, dompurifyRedirectPlugin],
};

async function main() {
  // Extension host (Node / CommonJS). `vscode` is provided by the runtime.
  const extensionCtx = await esbuild.context({
    ...base,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  });

  // Webview front-end (browser / IIFE). Monaco pulls in .css and .ttf assets;
  // inline the font as a data URL so it needs no dynamic webview path.
  const webviewCtx = await esbuild.context({
    ...base,
    entryPoints: ["webview/main.ts"],
    outfile: "dist/webview/main.js",
    platform: "browser",
    format: "iife",
    loader: {
      ".ttf": "dataurl",
    },
  });

  // Monaco's editor worker, bundled standalone; loaded via a blob shim at runtime.
  const workerCtx = await esbuild.context({
    ...base,
    entryPoints: [
      "node_modules/monaco-editor/esm/vs/editor/editor.worker.js",
    ],
    outfile: "dist/webview/editor.worker.js",
    platform: "browser",
    format: "iife",
  });

  const contexts = [extensionCtx, webviewCtx, workerCtx];

  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
