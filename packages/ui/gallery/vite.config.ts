import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  plugins: [react()],
  resolve: {
    alias: {
      "@room/ui": path.resolve(dir, "../src"),
    },
  },
  server: { port: 5179 },
  build: {
    outDir: path.resolve(dir, "dist"),
    emptyOutDir: true,
  },
});
