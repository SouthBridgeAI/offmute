import { defineConfig } from "tsup";

export default defineConfig([
  // Build for the package (importable)
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: "dist",
    outExtension({ format }) {
      return {
        js: format === "cjs" ? ".cjs" : ".js",
      };
    },
  },
  // Build for the CLI
  {
    entry: ["src/run.ts"],
    format: ["esm"],
    sourcemap: true,
    clean: false,
    outDir: "dist",
  },
]);
