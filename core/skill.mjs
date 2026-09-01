/**
 * Agent skill 的分发管理：仓库自带 skill/（agent 驱动本平台的说明书），
 * 设置页可把它注册到全局 skill 目录（<SKILLS_DIR>/video-studio/），
 * 供 kimi / codex 等 agent 自动发现；支持更新（内容比对）与卸载。
 * @module core/skill
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLATFORM_DIR, SKILLS_DIR } from "../config.mjs";

/** skill 名（即安装后的目录名）。 */
export const SKILL_NAME = "video-studio";
/** 仓库内的 skill 源目录。 */
export const SKILL_SRC_DIR = join(PLATFORM_DIR, "skill");
/** 全局安装目标目录。 */
export const SKILL_DEST_DIR = join(SKILLS_DIR, SKILL_NAME);

/** 从 SKILL.md frontmatter 里抠 version 字段（没有则 null）。 */
function versionOf(dir) {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return null;
  const m = /^\s*version:\s*(\S+)\s*$/m.exec(readFileSync(file, "utf8"));
  return m ? m[1] : null;
}

/**
 * skill 安装状态。
 * @returns {{name:string, srcDir:string, destDir:string, skillsDir:string,
 *   installed:boolean, version:string|null, installedVersion:string|null,
 *   updateAvailable:boolean}}
 */
export function skillStatus() {
  const installed = existsSync(join(SKILL_DEST_DIR, "SKILL.md"));
  const version = versionOf(SKILL_SRC_DIR);
  const installedVersion = installed ? versionOf(SKILL_DEST_DIR) : null;
  // 内容不一致即视为可更新（覆盖版本号没变但内容修了的情况）
  const updateAvailable = installed
    && readFileSync(join(SKILL_SRC_DIR, "SKILL.md"), "utf8")
      !== readFileSync(join(SKILL_DEST_DIR, "SKILL.md"), "utf8");
  return {
    name: SKILL_NAME,
    srcDir: SKILL_SRC_DIR,
    destDir: SKILL_DEST_DIR,
    skillsDir: SKILLS_DIR,
    installed,
    version,
    installedVersion,
    updateAvailable,
  };
}

/**
 * 安装/更新：先把目标目录清掉再整体复制（保证被删的旧文件不残留）。
 * @returns {object} skillStatus() + {action: "installed"|"updated"}
 */
export function installSkill() {
  const was = skillStatus();
  rmSync(SKILL_DEST_DIR, { recursive: true, force: true });
  mkdirSync(SKILLS_DIR, { recursive: true });
  cpSync(SKILL_SRC_DIR, SKILL_DEST_DIR, { recursive: true });
  return { ...skillStatus(), action: was.installed ? "updated" : "installed" };
}

/**
 * 卸载：只删 <SKILLS_DIR>/video-studio/ 这一层，安全校验防误删。
 * @returns {object} skillStatus() + {action: "uninstalled"|"noop"}
 */
export function uninstallSkill() {
  const dest = resolve(SKILL_DEST_DIR);
  const base = resolve(SKILLS_DIR);
  // 只允许删 <SKILLS_DIR>/ 的下一级目录本身
  if (dest === base || !dest.startsWith(base)) {
    throw new Error(`refuse to remove unsafe path: ${dest}`);
  }
  const was = skillStatus();
  rmSync(dest, { recursive: true, force: true });
  return { ...skillStatus(), action: was.installed ? "uninstalled" : "noop" };
}
