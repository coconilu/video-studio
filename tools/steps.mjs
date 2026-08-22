/**
 * 确定性管线步骤封装：captions → assemble → transitions → check → render。
 * 全部 spawn 子进程（windowsHide），日志进队列流。
 * @module tools/steps
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_HEADLESS_SHELL, PIPELINE_SCRIPTS } from "../config.mjs";
import { taskDir } from "../core/tasks.mjs";

// 孙进程（puppeteer → chrome-headless-shell）不带 windowsHide 会弹可见终端窗口，
// 用 NODE_OPTIONS 钩子强制整棵 node 进程树隐藏子进程窗口（路径无空格，免引号）。
const HIDE_SPAWN_HOOK = fileURLToPath(new URL("./hide-spawn.cjs", import.meta.url));
const HIDDEN_ENV = {
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${HIDE_SPAWN_HOOK}`].filter(Boolean).join(" "),
};

/**
 * 跑一个子进程并把输出逐行送入日志。
 * @param {string[]} argv 命令行
 * @param {string} cwd 工作目录
 * @param {(line:string)=>void} log
 * @param {object} [envExtra]
 * @returns {Promise<{code:number}>}
 */
function runCmd(argv, cwd, log, envExtra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, ...HIDDEN_ENV, ...envExtra },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Windows 下 .cmd（npm.cmd）必须经 shell 启动，否则 Node ≥18.20 抛 EINVAL
      shell: argv[0].endsWith(".cmd"),
    });
    for (const stream of [child.stdout, child.stderr]) {
      let buf = "";
      stream.on("data", (d) => {
        buf += d.toString("utf8");
        let i;
        while ((i = buf.indexOf("\n")) >= 0) { log(buf.slice(0, i)); buf = buf.slice(i + 1); }
      });
      stream.on("end", () => { if (buf.trim()) log(buf); });
    }
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1 }));
  });
}

const script = (name) => join(PIPELINE_SCRIPTS, name);
/** Windows 下 spawn 不能直接执行 .cmd（npm 是 .cmd）。 */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * 组装阶段：captions build → assemble-index → transitions inject → verify。
 * @param {string} taskId @param {(line:string)=>void} log
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function runAssemble(taskId, log) {
  const cwd = taskDir(taskId);
  const steps = [
    ["captions build", ["node", script("captions.mjs"), "build", "--hyperframes", "."]],
    ["assemble-index", ["node", script("assemble-index.mjs"), "--hyperframes", "."]],
    ["transitions inject", ["node", script("transitions.mjs"), "inject", "--hyperframes", "."]],
    ["transitions verify", ["node", script("transitions.mjs"), "verify", "--hyperframes", "."]],
  ];
  for (const [name, argv] of steps) {
    log(`== ${name}`);
    const { code } = await runCmd(argv, cwd, log);
    if (code !== 0) return { ok: false, error: `${name} exited ${code}` };
  }
  return { ok: true };
}

/**
 * hyperframes check（lint + runtime + layout + motion + contrast）。
 * check 需要 index.html，先跑幂等的 assemble-index 从 STORYBOARD.md 重建挂载再校验。
 * @param {string} taskId @param {(line:string)=>void} log
 * @returns {Promise<{ok:boolean, error?:string, output?:string}>}
 */
export async function runCheck(taskId, log) {
  const cwd = taskDir(taskId);
  log("== assemble-index (pre-check)");
  const pre = await runCmd(["node", script("assemble-index.mjs"), "--hyperframes", "."], cwd, log);
  if (pre.code !== 0) return { ok: false, error: `assemble-index exited ${pre.code}` };
  const lines = [];
  const tee = (l) => { lines.push(l); log(l); };
  const { code } = await runCmd([NPM, "run", "check"], cwd, tee, {
    HYPERFRAMES_BROWSER_PATH: CHROME_HEADLESS_SHELL,
  });
  return code === 0
    ? { ok: true, output: lines.join("\n") }
    : { ok: false, error: `check exited ${code}`, output: lines.join("\n") };
}

/**
 * 渲染 MP4（HYPERFRAMES_BROWSER_PATH 强制指向可用的 150 headless-shell）。
 * hyperframes 输出带时间戳的文件名，渲染成功后把最新的 mp4 归位为 renders/video.mp4。
 * @param {string} taskId @param {(line:string)=>void} log
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function runRender(taskId, log) {
  const cwd = taskDir(taskId);
  const { code } = await runCmd([NPM, "run", "render"], cwd, log, {
    HYPERFRAMES_BROWSER_PATH: CHROME_HEADLESS_SHELL,
  });
  if (code !== 0) return { ok: false, error: `render exited ${code}` };
  const dir = join(cwd, "renders");
  const mp4s = readdirSync(dir).filter((f) => f.endsWith(".mp4") && f !== "video.mp4");
  if (!existsSync(join(dir, "video.mp4")) && mp4s.length > 0) {
    const newest = mp4s
      .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0].f;
    copyFileSync(join(dir, newest), join(dir, "video.mp4"));
    log(`normalized renders/${newest} → renders/video.mp4`);
  }
  return { ok: true };
}
