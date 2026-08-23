/**
 * 任务存储：任务 = videos/ 下一个含 task.json 的目录。负责创建、读取、状态更新、
 * fork（血缘 + 下游失效）、打回重做（制品归档 .history/）。
 * @module core/tasks
 */
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { VIDEOS_DIR, TEMPLATE_DIR } from "../config.mjs";
import { loadSpec } from "./spec.mjs";

/** 阶段状态取值。 */
export const STAGE_STATUS = ["pending", "running", "draft", "approved", "stale", "failed"];

// 用户级产物目录可能在首次运行时尚不存在（尤其 macOS/Linux 的多级路径）。
mkdirSync(VIDEOS_DIR, { recursive: true });

/**
 * 读取任务元数据。
 * @param {string} id 任务 id（目录名）
 * @returns {object} task.json 内容
 */
export function readTask(id) {
  const path = join(VIDEOS_DIR, id, "task.json");
  if (!existsSync(path)) throw new Error(`task not found: ${id}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** @param {string} id @param {object} task 写回 task.json。 */
export function writeTask(id, task) {
  writeFileSync(join(VIDEOS_DIR, id, "task.json"), JSON.stringify(task, null, 2) + "\n");
}

/** @returns {string} 任务目录绝对路径。 */
export function taskDir(id) {
  return join(VIDEOS_DIR, id);
}

/** @returns {Array<object>} 全部任务（按创建时间倒序）。 */
export function listTasks() {
  const out = [];
  for (const name of readdirSync(VIDEOS_DIR)) {
    const p = join(VIDEOS_DIR, name, "task.json");
    if (existsSync(p)) {
      try { out.push(JSON.parse(readFileSync(p, "utf8"))); } catch { /* 损坏的任务跳过 */ }
    }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * 创建任务：复制 _template 骨架，初始化 task.json，写入用户输入材料。
 * @param {{title:string, pipeline:string, input?:{text?:string, urls?:string[]}}} req
 * @returns {object} 新任务的 task.json
 */
export function createTask(req) {
  const spec = loadSpec(req.pipeline);
  const slug = slugify(req.title) || "task";
  let id = slug;
  for (let n = 2; existsSync(join(VIDEOS_DIR, id)); n += 1) id = `${slug}-${n}`;
  const dir = join(VIDEOS_DIR, id);
  cpSync(TEMPLATE_DIR, dir, { recursive: true });
  // package.json / meta.json 里的占位名换成任务 id
  for (const f of ["package.json", "meta.json"]) {
    const p = join(dir, f);
    if (existsSync(p)) writeFileSync(p, readFileSync(p, "utf8").replaceAll("your-video-slug", id));
  }
  if (req.input?.text || (req.input?.urls || []).length) {
    mkdirSync(join(dir, "materials"), { recursive: true });
    const urls = (req.input.urls || []).map((u) => `- ${u}`).join("\n");
    writeFileSync(
      join(dir, "materials", "input.md"),
      `# 用户输入\n\n${req.input.text || ""}\n\n${urls ? `## 参考链接\n\n${urls}\n` : ""}`,
    );
  }
  const task = {
    id,
    title: req.title,
    pipeline: spec.id,
    createdAt: new Date().toISOString(),
    parent: null,
    gates: {},
    stages: Object.fromEntries(spec.stages.map((s) => [s.id, { status: "pending", attempt: 0 }])),
  };
  writeTask(id, task);
  return task;
}

/**
 * 更新单个阶段状态。
 * @param {string} id @param {string} stageId
 * @param {string} status 见 STAGE_STATUS
 * @param {object} [extra] 合并进阶段记录的字段（如 error、feedback）
 */
export function setStage(id, stageId, status, extra = {}) {
  if (!STAGE_STATUS.includes(status)) throw new Error(`bad status: ${status}`);
  const task = readTask(id);
  task.stages[stageId] = { ...task.stages[stageId], ...extra, status };
  writeTask(id, task);
}

/**
 * 把某阶段当前制品归档到 .history/<stage>/<attempt>/，供打回重做前调用。
 * @param {string} id @param {object} stage spec 中的阶段定义
 */
export function archiveAttempt(id, stage) {
  const task = readTask(id);
  const attempt = task.stages[stage.id]?.attempt || 0;
  if (attempt === 0) return;
  const dir = taskDir(id);
  const dest = join(dir, ".history", stage.id, String(attempt));
  mkdirSync(dest, { recursive: true });
  for (const out of stage.outputs || []) {
    const src = join(dir, out);
    if (existsSync(src)) cpSync(src, join(dest, out), { recursive: true });
  }
}

/**
 * 下游失效级联：stageId 之后的所有非 pending 阶段置 stale。
 * @param {string} id @param {string} stageId
 */
export function invalidateDownstream(id, stageId) {
  const task = readTask(id);
  const spec = loadSpec(task.pipeline);
  const idx = spec.stages.findIndex((s) => s.id === stageId);
  for (const s of spec.stages.slice(idx + 1)) {
    const st = task.stages[s.id];
    if (st && st.status !== "pending") task.stages[s.id] = { ...st, status: "stale" };
  }
  writeTask(id, task);
}

/**
 * fork：从指定阶段分叉为新任务。复制该阶段及之前的制品，下游阶段重置 pending，
 * 其制品从磁盘移除（避免陈旧制品误导后续阶段）。
 * @param {string} id 源任务 id
 * @param {string} stageId 分叉点阶段
 * @returns {object} 新任务的 task.json
 */
export function forkTask(id, stageId) {
  const src = readTask(id);
  const spec = loadSpec(src.pipeline);
  const forkIdx = spec.stages.findIndex((s) => s.id === stageId);
  if (forkIdx < 0) throw new Error(`bad fork stage: ${stageId}`);
  const base = `${id}-fork`;
  let newId = base;
  for (let n = 2; existsSync(join(VIDEOS_DIR, newId)); n += 1) newId = `${base}-${n}`;
  const srcDir = taskDir(id);
  const destDir = join(VIDEOS_DIR, newId);
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if ([".history", ".logs", "node_modules", "renders"].includes(entry)) continue;
    cpSync(join(srcDir, entry), join(destDir, entry), { recursive: true });
  }
  const task = JSON.parse(readFileSync(join(destDir, "task.json"), "utf8"));
  task.id = newId;
  task.createdAt = new Date().toISOString();
  task.parent = { task: id, stage: stageId };
  for (const s of spec.stages.slice(forkIdx + 1)) {
    task.stages[s.id] = { status: "pending", attempt: 0 };
    for (const out of s.outputs || []) {
      const p = join(destDir, out.replace(/\*$/, ""));
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
  }
  writeFileSync(join(destDir, "task.json"), JSON.stringify(task, null, 2) + "\n");
  return task;
}

/** @param {string} title @returns {string} 目录安全 slug（保留 CJK）。 */
function slugify(title) {
  return String(title)
    .trim().toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{Script=Han}a-z0-9-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
