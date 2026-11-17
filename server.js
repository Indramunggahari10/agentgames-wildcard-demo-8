// Round Scorer — zero-framework HTTP server (Node built-ins only).
// No persistence, no external network calls, no logging of request
// bodies (only method, path, status, and coarse timing). Pasted round
// logs are processed in memory only.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  RULES,
  BONUS_MAX,
  BONUS_TEXT,
  SCORE_SOURCE,
  ValidationError,
  scoreRound,
} from "./src/scorer.js";
import { SAMPLES } from "./src/examples.js";

const MAX_BODY_BYTES = 64 * 1024;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(ROOT, "public", "index.html");
const APP_JS_PATH = path.join(ROOT, "public", "app.js");

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
  });
  res.end(body);
}

// Reads the body with a hard cap. Oversized bodies are drained without
// accumulating (bounded memory) and reported as { overflow: true }.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        overflow = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () =>
      resolve({ overflow, text: Buffer.concat(chunks).toString("utf8") }),
    );
    req.on("error", reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url, "http://localhost");
      if (
        req.method === "GET" &&
        (url.pathname === "/health" || url.pathname === "/api/health")
      ) {
        sendJson(res, 200, {
          ok: true,
          service: "round-scorer",
          version: "1.0.0",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        const html = await readFile(INDEX_PATH, "utf8");
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "content-type": "text/html; charset=utf-8",
        });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/app.js") {
        const js = await readFile(APP_JS_PATH, "utf8");
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "content-type": "text/javascript; charset=utf-8",
        });
        res.end(js);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/examples") {
        sendJson(res, 200, { examples: SAMPLES });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/rules") {
        sendJson(res, 200, {
          rules: RULES,
          bonus: { max: BONUS_MAX, text: BONUS_TEXT },
          source: SCORE_SOURCE,
          notes: [
            "Tie-breakers order equal totals only; they never change a score, so this tool never ranks.",
            "Offline tasks are scored as delivery timeouts: the rules page says an offline agent forfeits the task, and a forfeited task produces no accepted response. This mapping is this tool's stated interpretation.",
            "PROOF_REUSED tasks are excluded from the reliability-bonus share only; per-task scoring still applies.",
          ],
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/score") {
        const { overflow, text } = await readBody(req);
        if (overflow) {
          sendJson(res, 413, { error: "body too large (64 KB cap)" });
          return;
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          sendJson(res, 400, { error: "body must be valid JSON" });
          return;
        }
        try {
          sendJson(res, 200, scoreRound(body));
        } catch (err) {
          if (err instanceof ValidationError) {
            sendJson(res, 400, { error: err.message, details: err.details });
          } else {
            throw err;
          }
        }
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      console.error("request failed", err.message);
    } finally {
      // Coarse access log only: no bodies, no pasted content.
      console.log(
        `${req.method} ${new URL(req.url, "http://localhost").pathname} -> ${res.statusCode} (${Date.now() - started}ms)`,
      );
    }
  });
}

// Default export: Vercel's Node.js runtime requires the server entrypoint's
// default export to be a function or a server. Exporting the created server
// lets Vercel route requests through it; running `node server.js` directly
// still listens on $PORT as before.
const server = createServer();
export default server;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    console.log(`round-scorer listening on :${port}`);
  });
}
