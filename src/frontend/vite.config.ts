import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  publicDir: ".generated-public",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
