import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: Vite serves the SPA on :5173 and proxies /api (incl. the SSE stream) to the Node
// server on :8787. Prod: `vite build` writes apps/web/dist, which the Node server serves.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
