import { spawn } from "node:child_process";

const exe = "C:/Users/admin/AppData/Local/Token Plan Media Hub/token-plan-media-mcp.exe";
const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let buf = "";
const pending = new Map();
let id = 0;
const send = (method, params) => new Promise((res) => {
  const mid = ++id;
  pending.set(mid, res);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mid, method, params }) + "\n");
});
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
    } catch { /* non-JSON log line */ }
  }
});
child.on("error", (e) => { console.error("SPAWN ERROR:", e.message); process.exit(1); });
const timeout = setTimeout(() => { console.log("TIMEOUT"); child.kill(); process.exit(2); }, 90000);

const init = await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "0.1" } });
console.log("INIT:", init.result ? "ok" : JSON.stringify(init.error));
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tools = await send("tools/list", {});
console.log("TOOLS:", (tools.result?.tools || []).map((t) => t.name).join(", "));

if (process.argv.includes("--tts")) {
  const call = await send("tools/call", {
    name: "synthesize_speech",
    arguments: { text: "探针测试", voice: "Elias", model: "qwen3-tts-flash", language: "Chinese" },
  });
  const text = (call.result?.content || []).map((c) => c.text || "").join("\n");
  console.log("TTS RESULT:", text.slice(0, 800));
}
clearTimeout(timeout);
child.kill();
process.exit(0);
