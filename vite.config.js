/* global process */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin API in development, matching the Nginx setup in production,
    // so session cookies stay SameSite=Strict and no CORS is needed.
    proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001" },
  },
});
