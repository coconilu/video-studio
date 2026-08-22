/**
 * kimi code cli Runner：`kimi -p <prompt>` 非交互执行（裸 -p，与 --auto/-y 互斥——已探针验证）。
 * CLI 在任务目录内直接读写制品文件；完成后由 core/artifacts 校验输出。
 * @module runners/kimi-cli
 */
import { spawn } from "node:child_process";
import { KIMI_BIN, RUNNER_TIMEOUT_MS, CHROME_HEADLESS_SHELL } from "../config.mjs";

export const id = "kimi-cli";

/**
 * 执行一个模型阶段。
 * @param {{workdir:string, prompt:string, timeoutMs?:number}} job
 * @param {(line:string)=>void} log 日志回调
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export function run(job, log) {
  return new Promise((resolve) => {
    const child = spawn(KIMI_BIN, ["-p", job.prompt], {
      cwd: job.workdir,
      env: { ...process.env, HYPERFRAMES_BROWSER_PATH: CHROME_HEADLESS_SHELL },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: `runner timeout after ${job.timeoutMs || RUNNER_TIMEOUT_MS}ms` });
    }, job.timeoutMs || RUNNER_TIMEOUT_MS);
    for (const stream of [child.stdout, child.stderr]) {
      let buf = "";
      stream.on("data", (d) => {
        buf += d.toString("utf8");
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          log(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      stream.on("end", () => { if (buf.trim()) log(buf); });
    }
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: `spawn failed: ${err.message}` });
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code === 0
        ? { ok: true }
        : { ok: false, error: `kimi exited with code ${code}` });
    });
  });
}
