import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rsbuild/core";

const configuredDistDir = process.env.SKYAGENT_WEB_DIST_DIR;
if (configuredDistDir?.match(/^(?:[a-zA-Z]:[\\/]|[\\/])/)) {
  throw new Error("SKYAGENT_WEB_DIST_DIR must be relative to packages/web");
}
if (configuredDistDir?.split(/[\\/]+/).includes("..")) {
  throw new Error("SKYAGENT_WEB_DIST_DIR must stay inside packages/web");
}

export default defineConfig({
  plugins: [pluginReact()],
  output: {
    distPath: {
      root: configuredDistDir ?? "dist",
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
