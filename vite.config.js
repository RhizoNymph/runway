import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_FILE = fileURLToPath(new URL("./data/model.json", import.meta.url));

/* GET/PUT /api/model — persists the budget model to data/model.json so it
   can be edited outside the browser (by hand or by an agent). Every
   response carries X-Model-Store so the client can tell this endpoint from
   a static host's catch-all. */
function modelStore() {
  const handler = (req, res) => {
    res.setHeader("X-Model-Store", "1");
    if (req.method === "GET") {
      try {
        const body = fs.readFileSync(MODEL_FILE, "utf8");
        res.setHeader("Content-Type", "application/json");
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.end("");
      }
    } else if (req.method === "PUT") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          JSON.parse(body);
          fs.mkdirSync(path.dirname(MODEL_FILE), { recursive: true });
          fs.writeFileSync(MODEL_FILE, body.endsWith("\n") ? body : body + "\n");
          res.end("ok");
        } catch {
          res.statusCode = 400;
          res.end("invalid json");
        }
      });
    } else {
      res.statusCode = 405;
      res.end("");
    }
  };
  return {
    name: "model-store",
    configureServer(server) { server.middlewares.use("/api/model", handler); },
    configurePreviewServer(server) { server.middlewares.use("/api/model", handler); },
  };
}

export default defineConfig({
  plugins: [react(), modelStore()],
  base: "./",
  server: { port: 5180, open: true },
});
