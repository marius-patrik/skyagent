import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  plugins: [pluginReact()],
  output: {
    distPath: {
      root: "dist",
    },
  },
  html: {
    template: "./index.html",
  },
  source: {
    entry: {
      index: "./src/main.tsx",
    },
  },
});
