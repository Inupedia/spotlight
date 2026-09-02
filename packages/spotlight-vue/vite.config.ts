import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const bundledDeps = new Set([
  "@inupedia/spotlight-client",
  "@inupedia/spotlight-protocol",
]);

function isExternal(id: string): boolean {
  if (id === "uqr" || id.startsWith("uqr/")) return false;
  if (id.startsWith(".") || id.startsWith("/") || id.startsWith("\0")) {
    return false;
  }
  if (bundledDeps.has(id)) return true;
  if (id.startsWith("@inupedia/")) return true;
  return !id.includes("packages/spotlight-vue/src");
}

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: {
        index: resolve(rootDir, "src/index.ts"),
        plugin: resolve(rootDir, "src/plugin.ts"),
        "remote/index": resolve(rootDir, "src/remote/index.ts"),
        "markdown/index": resolve(rootDir, "src/markdown/index.ts"),
        "store/index": resolve(rootDir, "src/store/index.ts"),
        "testing/index": resolve(rootDir, "src/testing/index.ts"),
        "components/index": resolve(rootDir, "src/components/index.ts"),
        "components/InspiraCardSpotlight": resolve(
          rootDir,
          "src/components/InspiraCardSpotlight.vue",
        ),
        "components/OfficialBorderBeam": resolve(
          rootDir,
          "src/components/OfficialBorderBeam.vue",
        ),
      },
      formats: ["es"],
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      external: isExternal,
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
