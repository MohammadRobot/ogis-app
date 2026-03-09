import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const host = process.env.VITE_HOST || "0.0.0.0";
const port = parsePort(process.env.VITE_PORT, 5173);

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],

  server: {
    host,
    port,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },

  preview: {
    host,
    port,
    strictPort: true,
  },

  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
