import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev-only /api proxy to a locally running `wrangler dev`. Override the
// target with API_PROXY_TARGET when wrangler is not on 8787 (see README,
// "Local dev against real data").
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
