import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
const port = Number(process.env.PORT || 3000);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, { "content-type": mime[".json"] });
  res.end(JSON.stringify(payload));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) reject(new Error("Payload too large"));
  });
  req.on("end", () => {
    try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("Invalid JSON")); }
  });
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, { status: "ok", service: "medpark-one-preview" });
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const { email, password } = await readBody(req);
      const allowed = email === "admin@medpark.co.kr" && password === "Preview123!";
      return sendJson(res, allowed ? 200 : 401, allowed
        ? { user: { name: "김관리", department: "경영지원본부", role: "admin" }, preview: true }
        : { message: "미리보기 계정 정보를 확인해 주세요." });
    }

    if (url.pathname === "/api/webhooks/plaud" && req.method === "POST") {
      await readBody(req);
      return sendJson(res, 202, { accepted: true, preview: true });
    }

    let relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    relative = normalize(relative).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, relative);
    if (!filePath.startsWith(root)) return sendJson(res, 403, { message: "Forbidden" });

    try {
      const file = await readFile(filePath);
      res.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream" });
      res.end(file);
    } catch {
      const index = await readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": mime[".html"] });
      res.end(index);
    }
  } catch (error) {
    sendJson(res, 400, { message: error.message || "Bad request" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`MedPark One preview: http://localhost:${port}`);
});
