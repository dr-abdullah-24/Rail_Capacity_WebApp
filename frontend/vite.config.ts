import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Local dev config. Vite proxies /api/* (both HTTP and WebSocket) to the
 * FastAPI backend on 127.0.0.1:8010. The custom `configure` handlers
 * swallow transient proxy noise (ECONNREFUSED during backend restarts,
 * ECONNABORTED when a browser tab tears down a WebSocket) so the dev
 * terminal only surfaces meaningful errors.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8010",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
        ws: true,
        configure(proxy) {
          const quiet = (code: string) =>
            code === "ECONNREFUSED" ||
            code === "ECONNABORTED" ||
            code === "ECONNRESET" ||
            code === "EPIPE";

          proxy.on("error", (err: NodeJS.ErrnoException) => {
            if (!quiet(err.code || "")) console.warn("[proxy]", err.message);
          });
          proxy.on("econnreset", (err: NodeJS.ErrnoException) => {
            if (!quiet(err.code || "")) console.warn("[proxy]", err.message);
          });
          // WebSocket-specific
          const httpProxy = proxy as unknown as {
            on: (evt: string, cb: (...a: any[]) => void) => void;
          };
          httpProxy.on("proxyReqWs", (_req, _sock) => {
            _sock.on("error", (err: NodeJS.ErrnoException) => {
              if (!quiet(err.code || "")) console.warn("[proxy-ws]", err.message);
            });
          });
        },
      },
    },
  },
});
