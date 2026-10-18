import react from "@vitejs/plugin-react";
import type { ViteDevServer } from "vite";
import { defineConfig } from "vite-plus";
import { createService } from "./server/service.js";
import { version } from "./package.json";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "test"
      ? []
      : [
          {
            name: "share-stream-development-api",
            apply: "serve" as const,
            async configureServer(vite: ViteDevServer) {
              const service = createService({
                origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
              });
              await new Promise<void>((resolve, reject) => {
                service.server.once("error", reject);
                service.server.listen(48101, "127.0.0.1", resolve);
              });
              vite.httpServer?.once("close", () => {
                void service.close();
              });
            },
          },
        ]),
  ],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:48101",
      "/signal": { target: "ws://127.0.0.1:48101", ws: true },
    },
  },
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: false },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/**", "test-results/**", "playwright-report/**"],
  },
  fmt: {
    ignorePatterns: ["dist/**", "test-results/**", "playwright-report/**", "package-lock.json"],
  },
}));
