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
  // Faust (@grame/faustwasm) generates AudioWorklet processor code at runtime
  // by serialising class definitions via `.toString()` and `.name`. Default
  // minification strips inferred class names, so `Class.name` returns "" in
  // production. The worklet template becomes `var  = class { ... }` — a
  // syntax error. `audioWorklet.addModule` rejects silently, then
  // `new AudioWorkletNode("synth-N")` throws "Unknown AudioWorklet name".
  //
  // Use terser with `keep_classnames` + `keep_fnames` so `.name` and
  // `.toString()` round-trip correctly. (Vite 8 / Rolldown's default oxc
  // minifier doesn't expose a reliable keep-names knob; esbuild's
  // `keepNames` config is honoured during transform but not during the
  // production minify pass under Rolldown.)
  build: {
    minify: "terser",
    terserOptions: {
      keep_classnames: true,
      keep_fnames: true,
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
