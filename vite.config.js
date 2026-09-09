import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { localApi } from "./server/local.js";

// Tailwind 4.3.3 uses its first-party Vite plugin; no PostCSS setup is needed.
export default defineConfig({
  plugins: [vue(), tailwindcss(), localApi()],
  server: { host: "0.0.0.0" },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
});
