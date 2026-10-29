import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  define: {
    // Baked at build time. __API_BASE__ is only read on native, where relative
    // URLs would resolve against capacitor://localhost; the web build ignores
    // it. __BUILD_NUMBER__ lets the server tell an old App Store build to
    // update, since those cannot be rolled forward.
    __API_BASE__: JSON.stringify(process.env.VITE_API_BASE ?? "https://trackjobs.up.railway.app"),
    __BUILD_NUMBER__: JSON.stringify(Number(process.env.VITE_BUILD_NUMBER ?? 1)),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
