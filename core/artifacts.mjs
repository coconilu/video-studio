/**
 * 制品读写与校验。所有路径限制在任务目录内（防穿越）。
 * @module core/artifacts
 */
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { PIPELINE_SCRIPTS } from "../config.mjs";
import { taskDir } from "./tasks.mjs";

/**
 * 把 API 传入的相对路径解析为任务目录内的绝对路径，拒绝目录穿越。
 * @param {string} id 任务 id
 * @param {string} rel 相对路径
 * @returns {string} 绝对路径
 */
export function safePath(id, rel) {
  const base = taskDir(id);
  const abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error(`path escapes task dir: ${rel}`);
  return abs;
}

/** @param {string} id @param {string} rel @returns {string} 文本内容。 */
export function readArtifact(id, rel) {
  const p = safePath(id, rel);
  if (!existsSync(p)) throw new Error(`artifact not found: ${rel}`);
  return readFileSync(p, "utf8");
}

/** @param {string} id @param {string} rel @param {string} content 写入文本制品。 */
export function writeArtifact(id, rel, content) {
  const p = safePath(id, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** @param {string} id @param {string} rel @returns {boolean} 制品是否存在（支持尾部 * 通配）。 */
export function artifactExists(id, rel) {
  if (rel.endsWith("*")) {
    const dir = safePath(id, rel.replace(/\*+$/, ""));
    try {
      return readdirSync(dir).some((f) => !f.startsWith("."));
    } catch {
      return false;
    }
  }
  return existsSync(safePath(id, rel));
}

/**
 * 校验阶段产物：存在性 + 格式可解析（STORYBOARD.md 走 faceless parser，JSON 走 JSON.parse）。
 * @param {string} id 任务 id
 * @param {string[]} outputs 阶段声明的输出
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function validateOutputs(id, outputs) {
  for (const rel of outputs || []) {
    if (!artifactExists(id, rel)) return { ok: false, error: `missing output: ${rel}` };
    if (rel.endsWith("STORYBOARD.md")) {
      try {
        const { parseStoryboard } = await import(
          pathToFileURL(join(PIPELINE_SCRIPTS, "lib", "storyboard.mjs")).href
        );
        const { frames, warnings } = parseStoryboard(readArtifact(id, rel));
        if (frames.length === 0) return { ok: false, error: `${rel}: parsed 0 frames` };
        for (const f of frames) {
          // 与 assemble-index 语义一致：outline 帧允许 src 未落盘（frames 阶段才构建），
          // built/animated 帧必须有 src 且文件在磁盘上。
          if (f.status === "built" || f.status === "animated") {
            if (!f.src) return { ok: false, error: `${rel}: frame ${f.index} (${f.status}) missing src` };
            if (!existsSync(safePath(id, f.src))) {
              return { ok: false, error: `${rel}: frame ${f.index} src not on disk: ${f.src}` };
            }
          }
        }
        if (warnings.length > 0) {
          return { ok: false, error: `${rel}: ${warnings[0].message || warnings[0]}` };
        }
      } catch (err) {
        return { ok: false, error: `${rel} parse failed: ${err.message}` };
      }
    }
    if (rel.endsWith(".json")) {
      try { JSON.parse(readArtifact(id, rel)); } catch (err) {
        return { ok: false, error: `${rel} invalid JSON: ${err.message}` };
      }
    }
  }
  return { ok: true };
}
