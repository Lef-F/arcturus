import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    watch: {
      // Don't restart dev server for non-application files
      ignored: ["**/*.md", "**/docs/**", "**/CLAUDE.md", "**/DOCTRINE.md", "**/AGENTS.md"],
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  // Faust (@grame/faustwasm) generates AudioWorkletProcessor code at runtime
  // by serialising class definitions via `.toString()` and `.name`. Those
  // stringified bodies reference *every* module-level identifier the class
  // depends on (sibling classes, helpers, captured constants). If the
  // minifier renames any of them, the worklet code throws ReferenceError
  // when the browser parses the blob — addModule rejects silently, then
  // `new AudioWorkletNode("synth-N")` throws "Unknown AudioWorklet name".
  //
  // Disable identifier mangling entirely. Terser still does dead-code
  // elimination, constant folding, and whitespace removal — bundle stays
  // reasonable, but every identifier survives so the runtime codegen
  // round-trips correctly.
  build: {
    minify: "terser",
    terserOptions: {
      mangle: false,
      compress: true,
      format: { comments: false },
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts"],

    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/test/**", "src/**/*.test.ts"],
    },
  },
});
