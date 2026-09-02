// 手动触发 release 工作流时：升级版本号 + 更新 CHANGELOG.md
// 用法: node .github/scripts/bump-version.mjs <patch|minor|major>
// 版本号双文件同步：desktop/package.json 与 desktop/src-tauri/tauri.conf.json
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const bump = process.argv[2];
const pkgPath = "desktop/package.json";
const tauriPath = "desktop/src-tauri/tauri.conf.json";
const changelogPath = "CHANGELOG.md";

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
const next =
  bump === "major"
    ? [major + 1, 0, 0]
    : bump === "minor"
      ? [major, minor + 1, 0]
      : bump === "patch"
        ? [major, minor, patch + 1]
        : null;
if (!next) throw new Error(`未知 bump 类型: ${bump}（支持 patch/minor/major）`);
const version = next.join(".");

// 缩进约定：两个文件都用 2 空格（本仓库无 Biome，与手写风格一致）
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
tauri.version = version;
writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

// 收集自上一个 tag 以来的提交，生成 changelog 条目
let range = null;
try {
  const lastTag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
  range = `${lastTag}..HEAD`;
} catch {
  // 尚无任何 tag，收集全部提交
}
const logArgs = range
  ? ["log", range, "--pretty=format:- %s"]
  : ["log", "--pretty=format:- %s"];
const commits =
  execFileSync("git", logArgs, { encoding: "utf8" }).trim() || "- 无提交记录";

const date = new Date().toISOString().slice(0, 10);
const section = `## v${version}（${date}）\n\n${commits}\n\n`;
const old = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
const updated = old.startsWith("# ")
  ? old.replace(/^# .*\n+/, (m) => m + section)
  : `# Changelog\n\n${section}${old}`;
writeFileSync(changelogPath, updated);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=v${version}\n`);
}
console.log(`bumped to v${version}`);
