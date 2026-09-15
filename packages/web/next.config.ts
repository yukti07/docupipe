import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // The floating "N" badge the dev server injects bottom-left. It is Next's own
  // overlay, not part of the product, and it sits on top of the page.
  devIndicators: false,

  turbopack: {
    // The API fixtures live at the repo root, not inside this package, because
    // the same JSON backs this app's MSW handlers and the backend's route
    // tests. Turbopack refuses to resolve above its root, so the root is the
    // repo rather than packages/web.
    root: path.join(here, "..", ".."),
  },
};

export default nextConfig;
