import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      // Only the explicit local-real profile opens the existing remote bindings.
      remoteBindings: process.env.CLOUDFLARE_ENV === "local",
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [".", "../.."],
    },
  },
});
