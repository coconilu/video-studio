/**
 * 串行任务队列：同一时刻只跑一个作业（Runner 配额 D7）。作业日志写入任务目录 .logs/。
 * @module core/queue
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const queue = [];
let running = false;

/**
 * 追加一行作业日志（同时落盘到任务目录）。
 * @param {string} taskDir 任务目录
 * @param {string} stage 阶段 id
 * @param {string} line 日志行
 */
export function logLine(taskDir, stage, line) {
  const dir = join(taskDir, ".logs");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${stage}.log`), line + "\n");
}

/**
 * 入队一个作业，串行执行。
 * @param {string} taskDir 任务目录（日志落盘用）
 * @param {string} stage 阶段 id
 * @param {(log:(line:string)=>void)=>Promise<void>} job 作业体
 * @returns {Promise<void>}
 */
export function enqueue(taskDir, stage, job) {
  return new Promise((resolve, reject) => {
    queue.push({ taskDir, stage, job, resolve, reject });
    void pump();
  });
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const { taskDir, stage, job, resolve, reject } = queue.shift();
    const log = (line) => logLine(taskDir, stage, line);
    log(`--- job start ${new Date().toISOString()}`);
    try {
      await job(log);
      log(`--- job ok ${new Date().toISOString()}`);
      resolve();
    } catch (err) {
      log(`--- job failed: ${err?.message || err}`);
      reject(err);
    }
  }
  running = false;
}
