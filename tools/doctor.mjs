/**
 * 依赖自检：逐项探测 config.mjs 声明的外部依赖，返回结构化结果。
 * 供 GET /api/doctor 与桌面壳启动面板使用；纯探测，不改任何状态。
 * @module tools/doctor
 */
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import os from "node:os";
import {
  CHROME_HEADLESS_SHELL,
  FFPROBE,
  KIMI_BIN,
  MEDIA_HUB_EXE,
} from "../config.mjs";

/** 在 PATH 上找可执行文件（Windows 走 PATHEXT，其他平台直接判存在）。 */
function which(bin) {
  if (bin.includes("/") || bin.includes("\\")) {
    return existsSync(bin) ? bin : null;
  }
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, bin + (ext && !bin.toLowerCase().endsWith(ext.toLowerCase()) ? ext : ""));
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** 在 Puppeteer 缓存里找任意 chrome-headless-shell 150（config 指死了具体版本路径，换机可能不在）。 */
function findChromeShell150() {
  if (existsSync(CHROME_HEADLESS_SHELL)) return CHROME_HEADLESS_SHELL;
  const cache = join(os.homedir(), ".cache/puppeteer/chrome-headless-shell");
  if (!existsSync(cache)) return null;
  for (const ver of readdirSync(cache)) {
    if (!ver.includes("150")) continue;
    const exe = join(cache, ver, "chrome-headless-shell-win64/chrome-headless-shell.exe");
    if (existsSync(exe)) return exe;
    const mac = join(cache, ver, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
    if (existsSync(mac)) return mac;
  }
  return null;
}

/** 跑全部检查，返回 { ok, checks: [{ id, label, ok, detail, hint }] }。 */
export function runDoctor() {
  const checks = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    id: "node",
    label: "Node.js ≥ 22",
    ok: nodeMajor >= 22,
    detail: `当前 ${process.versions.node}`,
    hint: nodeMajor >= 22 ? "" : "安装 Node 22 或更高版本（https://nodejs.org）。",
  });

  const kimi = which(KIMI_BIN) || (existsSync(join(os.homedir(), ".kimi-code/bin/kimi.exe"))
    ? join(os.homedir(), ".kimi-code/bin/kimi.exe") : null);
  checks.push({
    id: "kimi",
    label: "kimi cli（模型 Runner）",
    ok: !!kimi,
    detail: kimi || "未找到",
    hint: kimi ? "" : "安装 kimi code cli 并确认在 PATH 上，或设 STUDIO_KIMI_BIN 指向 kimi 可执行文件。",
  });

  const ffprobe = which(FFPROBE);
  checks.push({
    id: "ffprobe",
    label: "ffprobe（音频时长探测）",
    ok: !!ffprobe,
    detail: ffprobe || "未找到",
    hint: ffprobe ? "" : "安装 ffmpeg 并加入 PATH，或设 STUDIO_FFPROBE 指向 ffprobe 完整路径。",
  });

  const chrome = findChromeShell150();
  checks.push({
    id: "chrome",
    label: "chrome-headless-shell 150（渲染）",
    ok: !!chrome,
    detail: chrome || "未找到",
    hint: chrome ? "" : "用 Puppeteer 安装 chrome-headless-shell 150（npx puppeteer browsers install chrome-headless-shell@150），或设 HYPERFRAMES_BROWSER_PATH 指向它。",
  });

  const hub = existsSync(MEDIA_HUB_EXE);
  checks.push({
    id: "media-hub",
    label: "media-hub MCP 服务端（TTS）",
    ok: hub,
    detail: hub ? MEDIA_HUB_EXE : "未找到",
    hint: hub ? "" : "安装 Token Plan Media Hub 桌面应用，或设 STUDIO_MEDIA_HUB_EXE 指向 token-plan-media-mcp.exe。",
  });

  return { ok: checks.every((c) => c.ok), checks };
}
