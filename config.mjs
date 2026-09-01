/**
 * 平台全局配置：所有外部路径的唯一出处。环境变量可覆盖，便于二期抽离/换机。
 * @module config
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 平台根目录（仓库根，即本文件所在目录）。 */
export const PLATFORM_DIR = HERE;
/** 仓库内的只读参考目录：_template（新任务骨架）与 model-as-plugin（示例 pilot）。 */
export const REF_VIDEOS_DIR = join(PLATFORM_DIR, "videos");
/** 新任务从这里复制骨架。 */
export const TEMPLATE_DIR = join(REF_VIDEOS_DIR, "_template");

/**
 * 用户级任务产物目录（任务 = <VIDEOS_DIR>/<task-id>/）。与代码分离，
 * 重装/更新项目不丢历史；STUDIO_VIDEOS_DIR 可覆盖。
 * Windows: %LOCALAPPDATA%/video-studio/videos
 * macOS:   ~/Library/Application Support/video-studio/videos
 * 其他:    $XDG_DATA_HOME 或 ~/.local/share/video-studio/videos
 */
function defaultVideosDir() {
  const home = os.homedir();
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "video-studio", "videos");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "video-studio", "videos");
  }
  return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "video-studio", "videos");
}
export const VIDEOS_DIR = process.env.STUDIO_VIDEOS_DIR || defaultVideosDir();

/** 管线脚本（captions / assemble-index / transitions），已 vendor 进 tools/pipeline。 */
export const PIPELINE_SCRIPTS =
  process.env.STUDIO_PIPELINE_SCRIPTS ||
  join(PLATFORM_DIR, "tools", "pipeline");

export const FFPROBE =
  process.env.STUDIO_FFPROBE || "ffprobe";

/** hyperframes 自带 152 headless-shell 损坏，必须指向 Puppeteer 缓存的 150。 */
export const CHROME_HEADLESS_SHELL =
  process.env.HYPERFRAMES_BROWSER_PATH ||
  join(
    os.homedir(),
    ".cache/puppeteer/chrome-headless-shell/win64-150.0.7871.24/chrome-headless-shell-win64/chrome-headless-shell.exe",
  );

/** media-hub 的 MCP stdio 服务端（与 ~/.kimi-code/mcp.json 注册的一致）。 */
export const MEDIA_HUB_EXE =
  process.env.STUDIO_MEDIA_HUB_EXE ||
  join(os.homedir(), "AppData/Local/Token Plan Media Hub/token-plan-media-mcp.exe");

/** web-bridge 本地守护进程（POST {action, args, session}）。 */
export const WEBBRIDGE_URL = process.env.STUDIO_WEBBRIDGE_URL || "http://127.0.0.1:10086/command";

/** kimi cli 可执行文件。 */
export const KIMI_BIN = process.env.STUDIO_KIMI_BIN || "kimi";

/** STUDIO_MOCK=1 时 Runner 与外部工具全部写占位产物，用于无配额冒烟。 */
export const MOCK = process.env.STUDIO_MOCK === "1";

/** 全局 agent skill 目录（设置页把 skill/ 注册为 <SKILLS_DIR>/video-studio/）。 */
export const SKILLS_DIR =
  process.env.STUDIO_SKILLS_DIR || join(os.homedir(), ".agents", "skills");

/** 默认语音参数（与 pilot 一致）。 */
export const TTS = {
  voice: process.env.STUDIO_TTS_VOICE || "Elias",
  model: "qwen3-tts-flash",
  language: "Chinese",
};

/** 单个 Runner 任务的默认超时。 */
export const RUNNER_TIMEOUT_MS = Number(process.env.STUDIO_RUNNER_TIMEOUT_MS || 20 * 60 * 1000);
