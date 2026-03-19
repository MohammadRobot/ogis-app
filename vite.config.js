import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const host = process.env.VITE_HOST || "0.0.0.0";
const port = parsePort(process.env.VITE_PORT, 5173);
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8787";
const apiProxySecure = parseBoolean(process.env.VITE_API_PROXY_SECURE, true);
const apiProxyChangeOrigin = parseBoolean(process.env.VITE_API_PROXY_CHANGE_ORIGIN, true);

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],

  server: {
    host,
    port,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: apiProxyChangeOrigin,
        secure: apiProxySecure,
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
