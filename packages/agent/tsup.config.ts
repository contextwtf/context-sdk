import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/team/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@context-markets/sdk"],
});
