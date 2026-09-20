import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Accept the NEXT_PUBLIC_* names Supabase's dashboard snippets use, so the
  // same .env works without renaming. Only publishable values may use these.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (/jszip|pako|readable-stream/.test(id)) return "backup-vendor";
            if (
              /@tiptap|prosemirror|orderedmap|rope-sequence|w3c-keyname/.test(
                id,
              )
            )
              return "editor-vendor";
            if (/dexie/.test(id)) return "storage-vendor";
            if (/@supabase|supabase/.test(id)) return "supabase-vendor";
          }
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Top Note",
        short_name: "Top Note",
        description: "Cloud notes with focused AI summaries",
        lang: "th",
        theme_color: "#0d0b14",
        background_color: "#0d0b14",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 4000000,
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
      },
    }),
  ],
});
