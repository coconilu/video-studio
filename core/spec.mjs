/**
 * pipeline spec（JSON）加载。spec 定义阶段序、类型、输入输出、闸门与自愈配置。
 * @module core/spec
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PLATFORM_DIR } from "../config.mjs";

const SPECS_DIR = join(PLATFORM_DIR, "pipelines");

/**
 * 加载单个 pipeline spec。
 * @param {string} id spec 标识（文件名去 .json）
 * @returns {{id:string, stages:Array<object>}}
 */
export function loadSpec(id) {
  const path = join(SPECS_DIR, `${id}.json`);
  const spec = JSON.parse(readFileSync(path, "utf8"));
  if (!spec.id || !Array.isArray(spec.stages) || spec.stages.length === 0) {
    throw new Error(`invalid pipeline spec: ${id}`);
  }
  for (const s of spec.stages) {
    if (!s.id || !["model", "tool", "review"].includes(s.type)) {
      throw new Error(`invalid stage in ${id}: ${JSON.stringify(s)}`);
    }
    // candidates 仅适用于单文件输出；目录/通配输出没有可枚举的变体结构
    if (s.candidates > 1 && (s.outputs || []).some((o) => o.endsWith("*") || o.endsWith("/"))) {
      throw new Error(`stage ${s.id} in ${id}: candidates not supported for dir/glob outputs`);
    }
  }
  return spec;
}

/** @returns {Array<{id:string, name?:string}>} 可用 spec 列表。 */
export function listSpecs() {
  return readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const spec = loadSpec(f.replace(/\.json$/, ""));
      return { id: spec.id, name: spec.name || spec.id };
    });
}
