/**
 * media-hub MCP stdio 客户端：与 ~/.kimi-code/mcp.json 注册的服务端同一入口。
 * 已探针验证：initialize → tools/list → tools/call（NDJSON over stdio）。
 * @module tools/media-hub
 */
import { spawn } from "node:child_process";
import { MEDIA_HUB_EXE, TTS } from "../config.mjs";

/**
 * 带一次 MCP 会话执行若干调用，自动完成 initialize 握手。
 * @param {(call:(name:string,args:object)=>Promise<any>)=>Promise<any>} fn
 * @returns {Promise<any>} fn 的返回值
 */
export async function withMcp(fn) {
  const child = spawn(MEDIA_HUB_EXE, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let buf = "";
  const pending = new Map();
  let seq = 0;
  child.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      } catch { /* 服务端日志行，忽略 */ }
    }
  });
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++seq;
    pending.set(mid, (msg) => (msg.error ? rej(new Error(msg.error.message)) : res(msg.result)));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mid, method, params }) + "\n");
  });
  try {
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "dsh-video-studio", version: "0.1" },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const call = async (name, args) => {
      const result = await send("tools/call", { name, arguments: args });
      const text = (result?.content || []).map((c) => c.text || "").join("\n");
      try { return JSON.parse(text); } catch { return text; }
    };
    return await fn(call);
  } finally {
    child.kill();
  }
}

/**
 * 合成一条语音并返回本地 WAV 路径。
 * @param {string} text 口播文本
 * @param {object} [opts] 覆盖 voice/model/language
 * @returns {Promise<string>} 本地 output.wav 绝对路径
 */
export async function synthesizeSpeech(text, opts = {}) {
  return withMcp(async (call) => {
    const job = await call("synthesize_speech", {
      text,
      voice: opts.voice || TTS.voice,
      model: opts.model || TTS.model,
      language: opts.language || TTS.language,
    });
    if (job.status !== "succeeded") throw new Error(`tts job failed: ${JSON.stringify(job)}`);
    const list = await call("list_artifacts", { limit: 100 });
    const hit = (list.artifacts || []).find((a) => a.jobId === job.id);
    if (!hit?.localPath) throw new Error(`artifact not found for job ${job.id}`);
    return hit.localPath;
  });
}
