/**
 * 把平台代码复制进 src-tauri/resources/platform/（构建安装包前的准备）。
 * 幂等：先清空目标再整体复制。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(DESKTOP, "..");
const DEST = join(DESKTOP, "src-tauri", "resources", "platform");

const ITEMS = [
  "server", "core", "tools", "pipelines", "prompts", "runners", "bridges",
  "web", "skill", "config.mjs", "package.json",
];

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const item of ITEMS) {
  cpSync(join(ROOT, item), join(DEST, item), { recursive: true });
}
// 只读参考目录：新任务骨架 + 示例 pilot（prompt 通过 {{ref}} 引用其绝对路径）
for (const v of ["_template", "model-as-plugin"]) {
  const src = join(ROOT, "videos", v);
  if (existsSync(src)) cpSync(src, join(DEST, "videos", v), { recursive: true });
}
console.log("platform bundled ->", DEST);
