import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@fixtures": fileURLToPath(new URL("../../fixtures", import.meta.url)),
      // `server-only` exists to make a build fail if server code is pulled
      // into a client bundle. Under jsdom it resolves to that same guard and
      // refuses to load, so the server modules get a no-op here. The guard
      // still does its real job in `next build`, which is where it matters.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    // The five surfaces with no route yet have no other implementation to test
    // against, so the suite runs with the fixture fallback on. The seven live
    // routes stay live here and are exercised through MSW.
    env: { NEXT_PUBLIC_FIXTURE_FALLBACK: "1" },
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
})
