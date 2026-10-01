import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import netlify from "@netlify/vite-plugin";
import handler from "./netlify/functions/events.ts";

function localApi(): Plugin {
  return {
    name: "ticketspot-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/events")) {
          next();
          return;
        }
        try {
          const response = await handler(new Request(`http://127.0.0.1${url}`));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          const message = error instanceof Error ? error.message : "Could not load events";
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    localApi(),
    // Edge emulation boots Deno with a flag this environment rejects, which takes the dev server down.
    netlify({ edgeFunctions: { enabled: false } }),
  ],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
});
