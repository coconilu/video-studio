/**
 * 平台 HTTP 服务：/api/* JSON 接口 + web/ 静态托管 + 任务制品文件服务。
 * 零依赖（node:http），本地回环监听。
 * @module server
 */
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { createReadStream } from "node:fs";
import { PLATFORM_DIR, MOCK } from "../config.mjs";
import { listSpecs, loadSpec } from "../core/spec.mjs";
import { createTask, forkTask, listTasks, readTask } from "../core/tasks.mjs";
import { readArtifact, safePath, writeArtifact } from "../core/artifacts.mjs";
import { advance, approve, onArtifactEdited, reject, setGateOverride } from "../core/engine.mjs";
import { installSkill, skillStatus, uninstallSkill } from "../core/skill.mjs";

const PORT = Number(process.env.STUDIO_PORT || 4173);
const WEB_DIR = join(PLATFORM_DIR, "web");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

/** @param {import("node:http").ServerResponse} res @param {number} code @param {any} body */
function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(data);
}

/** @param {import("node:http").IncomingMessage} req @returns {Promise<string>} 原始请求体。 */
function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) { rejectBody(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

/** 任务摘要：当前阶段 + 整体进度。 */
function summarize(task) {
  let spec;
  try { spec = loadSpec(task.pipeline); } catch { spec = { stages: [] }; }
  const stages = spec.stages.map((s) => ({ id: s.id, status: task.stages[s.id]?.status || "pending" }));
  const current = stages.find((s) => s.status !== "approved");
  const done = stages.filter((s) => s.status === "approved").length;
  return { current: current?.id || null, done, total: stages.length, finished: !current };
}

/** 任务详情：task.json + spec 阶段定义合并视图。 */
function detail(task) {
  const spec = loadSpec(task.pipeline);
  return {
    ...task,
    stageList: spec.stages.map((s) => {
      const candN = s.candidates > 1 ? s.candidates : 0;
      let candidateDirs = [];
      if (candN) {
        const base = safePath(task.id, join("candidates", s.id));
        if (existsSync(base)) {
          candidateDirs = readdirSync(base)
            .filter((d) => /^\d+$/.test(d) && statSync(join(base, d)).isDirectory())
            .map(Number).sort((a, b) => a - b);
        }
      }
      return {
        ...s,
        candidates: candN,
        candidateDirs,
        status: task.stages[s.id]?.status || "pending",
        attempt: task.stages[s.id]?.attempt || 0,
        chosen: task.stages[s.id]?.chosen ?? null,
        error: task.stages[s.id]?.error,
        feedback: task.stages[s.id]?.feedback,
        gate: task.gates?.[s.id] || s.gate || "auto",
      };
    }),
  };
}

/** 递归列出目录下所有文件（相对路径，正斜杠）。 */
function listFilesRecursive(absBase, relBase) {
  const out = [];
  for (const entry of readdirSync(absBase, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(absBase, entry.name);
    const rel = `${relBase}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFilesRecursive(abs, rel));
    else out.push(rel);
  }
  return out;
}

/** API 路由表：[method, pattern(正则, 捕获组进 params), handler]。 */
const routes = [
  ["GET", /^\/api\/health$/, async (_req, res) => json(res, 200, { ok: true, mock: MOCK })],
  ["GET", /^\/api\/skill$/, async (_req, res) => json(res, 200, skillStatus())],
  ["POST", /^\/api\/skill\/install$/, async (_req, res) => json(res, 200, installSkill())],
  ["POST", /^\/api\/skill\/uninstall$/, async (_req, res) => json(res, 200, uninstallSkill())],
  ["GET", /^\/api\/pipelines$/, async (_req, res) => json(res, 200, listSpecs())],
  ["GET", /^\/api\/tasks$/, async (_req, res) => {
    json(res, 200, listTasks().map((t) => ({ ...t, summary: summarize(t) })));
  }],
  ["POST", /^\/api\/tasks$/, async (req, res) => {
    const body = JSON.parse(await readBody(req));
    if (!body.title || !body.pipeline) return json(res, 400, { error: "title and pipeline required" });
    const task = createTask(body);
    void advance(task.id);
    return json(res, 201, task);
  }],
  ["GET", /^\/api\/tasks\/(?<id>[^/]+)$/, async (_req, res, p) => json(res, 200, detail(readTask(p.id)))],
  ["POST", /^\/api\/tasks\/(?<id>[^/]+)\/advance$/, async (_req, res, p) => json(res, 200, await advance(p.id))],
  ["PUT", /^\/api\/tasks\/(?<id>[^/]+)\/gates$/, async (req, res, p) => {
    const body = JSON.parse(await readBody(req));
    if (!body.stage || !body.gate) return json(res, 400, { error: "stage and gate required" });
    await setGateOverride(p.id, body.stage, body.gate);
    return json(res, 200, detail(readTask(p.id)));
  }],
  ["POST", /^\/api\/tasks\/(?<id>[^/]+)\/fork$/, async (req, res, p) => {
    const body = JSON.parse(await readBody(req));
    if (!body.stage) return json(res, 400, { error: "stage required" });
    const task = forkTask(p.id, body.stage);
    void advance(task.id);
    return json(res, 201, task);
  }],
  ["POST", /^\/api\/tasks\/(?<id>[^/]+)\/stages\/(?<stage>[^/]+)\/approve$/, async (req, res, p) => {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    return json(res, 200, await approve(p.id, p.stage, body.choice));
  }],
  ["POST", /^\/api\/tasks\/(?<id>[^/]+)\/stages\/(?<stage>[^/]+)\/reject$/, async (req, res, p) => {
    const body = JSON.parse(await readBody(req));
    return json(res, 200, await reject(p.id, p.stage, body.feedback || ""));
  }],
  ["GET", /^\/api\/tasks\/(?<id>[^/]+)\/file$/, async (_req, res, p, url) => {
    const rel = url.searchParams.get("path");
    if (!rel) return json(res, 400, { error: "path required" });
    const abs = safePath(p.id, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) return json(res, 404, { error: `not found: ${rel}` });
    res.writeHead(200, { "content-type": MIME[extname(abs)] || "application/octet-stream" });
    createReadStream(abs).pipe(res);
    return undefined;
  }],
  ["PUT", /^\/api\/tasks\/(?<id>[^/]+)\/file$/, async (req, res, p, url) => {
    const rel = url.searchParams.get("path");
    if (!rel) return json(res, 400, { error: "path required" });
    writeArtifact(p.id, rel, await readBody(req));
    const task = await onArtifactEdited(p.id, rel);
    return json(res, 200, task);
  }],
  ["GET", /^\/api\/tasks\/(?<id>[^/]+)\/artifact$/, async (_req, res, p, url) => {
    const rel = url.searchParams.get("path");
    if (!rel) return json(res, 400, { error: "path required" });
    return json(res, 200, { path: rel, content: readArtifact(p.id, rel) });
  }],
  ["GET", /^\/api\/tasks\/(?<id>[^/]+)\/history$/, async (_req, res, p, url) => {
    const stage = url.searchParams.get("stage");
    if (!stage) return json(res, 400, { error: "stage required" });
    const base = safePath(p.id, join(".history", stage));
    if (!existsSync(base)) return json(res, 200, { attempts: [] });
    const attempts = readdirSync(base)
      .filter((d) => /^\d+$/.test(d) && statSync(join(base, d)).isDirectory())
      .sort((a, b) => Number(b) - Number(a))
      .map((d) => ({ attempt: Number(d), files: listFilesRecursive(join(base, d), join(".history", stage, d).replaceAll("\\", "/")) }));
    return json(res, 200, { attempts });
  }],
  ["GET", /^\/api\/tasks\/(?<id>[^/]+)\/logs$/, async (_req, res, p, url) => {
    const stage = url.searchParams.get("stage");
    if (!stage) return json(res, 400, { error: "stage required" });
    const file = safePath(p.id, join(".logs", `${stage}.log`));
    const tail = Number(url.searchParams.get("tail") || 200);
    if (!existsSync(file)) return json(res, 200, { lines: [] });
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    return json(res, 200, { lines: lines.slice(-tail) });
  }],
];

/** 静态文件（web/），SPA 回落到 index.html。 */
function serveStatic(res, pathname) {
  let rel = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^([/\\])+/, "");
  let abs = join(WEB_DIR, rel);
  if (!abs.startsWith(WEB_DIR)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(abs) || !statSync(abs).isFile()) abs = join(WEB_DIR, "index.html");
  if (!existsSync(abs)) { res.writeHead(404); res.end("web/ not built yet"); return; }
  res.writeHead(200, { "content-type": MIME[extname(abs)] || "application/octet-stream" });
  createReadStream(abs).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      for (const [method, pattern, handler] of routes) {
        if (method !== req.method) continue;
        const m = pattern.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(
          Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]),
        );
        await handler(req, res, params, url);
        return;
      }
      json(res, 404, { error: `no route: ${req.method} ${url.pathname}` });
      return;
    }
    serveStatic(res, url.pathname);
  } catch (err) {
    json(res, err.clientError ? 400 : 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`video-studio listening: http://127.0.0.1:${PORT}${MOCK ? " (MOCK)" : ""}`);
});
