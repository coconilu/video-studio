/**
 * 下载 Node 独立运行时到 src-tauri/resources/node/（安装包内嵌，用户无需装 Node）。
 * 仅下载当前平台的运行时；已存在则跳过（幂等）。
 */
import { createWriteStream, existsSync, mkdirSync, chmodSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const NODE_VERSION = "22.17.0";
const DEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "resources", "node");

async function download(url, dest) {
  // 下到临时文件再改名：中断不会留下半截文件骗过 existsSync 幂等判断
  const tmp = `${dest}.part`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`下载失败 ${url}: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(tmp));
  renameSync(tmp, dest);
}

const isWin = process.platform === "win32";
const target = join(DEST_DIR, isWin ? "node.exe" : "node");

if (existsSync(target)) {
  console.log("node runtime 已存在，跳过：", target);
} else {
  mkdirSync(DEST_DIR, { recursive: true });
  if (isWin) {
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;
    console.log("下载", url);
    await download(url, target);
  } else if (process.platform === "darwin") {
    // darwin-arm64（Apple Silicon）；tar.gz 解开取 bin/node
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`;
    const tgz = join(DEST_DIR, "node.tgz");
    console.log("下载", url);
    await download(url, tgz);
    execFileSync("tar", ["-xzf", tgz, "-C", DEST_DIR,
      `node-v${NODE_VERSION}-darwin-arm64/bin/node`, "--strip-components=2"]);
    rmSync(tgz); // 别把 45MB 的 tar 包打进 DMG
    chmodSync(target, 0o755);
  } else {
    throw new Error(`暂不支持的平台：${process.platform}`);
  }
  console.log("node runtime ->", target);
}
