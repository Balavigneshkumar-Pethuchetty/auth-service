import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    watch: { usePolling: true },
    allowedHosts: ["gm-global-techies-town.club", "www.gm-global-techies-town.club"],
  },
});
