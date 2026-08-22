/**
 * 平台冒烟（STUDIO_MOCK=1）：不起真实模型/TTS/渲染，走通
 * 创建 → 闸门批准/打回 → 制品编辑失效级联 → fork → 终态 全链路。
 * 运行：node .probe/smoke.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures += 1; console.log(`  ✗ ${name} ${extra}`); }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function waitStage(id, stage, status, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await api("GET", `/api/tasks/${id}`);
    const st = data.stageList?.find((s) => s.id === stage);
    if (st?.status === status) return data;
    if (st?.status === "failed") throw new Error(`stage ${stage} failed: ${st.error}`);
    await sleep(300);
  }
  throw new Error(`timeout waiting ${id}/${stage} -> ${status}`);
}

const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  env: { ...process.env, STUDIO_MOCK: "1", STUDIO_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
server.stderr.on("data", (d) => process.stdout.write(`[server!] ${d}`));

try {
  await sleep(800);
  console.log("smoke: basics");
  const health = await api("GET", "/api/health");
  check("health", health.data.ok === true && health.data.mock === true);
  const pipes = await api("GET", "/api/pipelines");
  check("pipelines", pipes.data.some((p) => p.id === "concept-explainer"));

  console.log("smoke: create + auto-advance to brief gate");
  const created = await api("POST", "/api/tasks", {
    title: "冒烟测试", pipeline: "concept-explainer", input: { text: "验证平台状态机。" },
  });
  check("created 201", created.status === 201, JSON.stringify(created.data));
  const id = created.data.id;
  let detail = await waitStage(id, "brief", "draft");
  check("ingest auto-approved", detail.stageList.find((s) => s.id === "ingest").status === "approved");
  check("brief draft at gate", true);

  console.log("smoke: approve brief -> script gate");
  await api("POST", `/api/tasks/${id}/stages/brief/approve`);
  detail = await waitStage(id, "script", "draft");

  console.log("smoke: reject script with feedback -> rerun -> draft again");
  await api("POST", `/api/tasks/${id}/stages/script/reject`, { feedback: "再来一版更紧凑的。" });
  detail = await waitStage(id, "script", "draft");
  check("script attempt=2 after reject", detail.stageList.find((s) => s.id === "script").attempt === 2);

  console.log("smoke: approve script -> tts(mock) auto -> storyboard gate");
  await api("POST", `/api/tasks/${id}/stages/script/approve`);
  detail = await waitStage(id, "storyboard", "draft");
  check("tts auto-approved", detail.stageList.find((s) => s.id === "tts").status === "approved");

  console.log("smoke: approve storyboard -> frames/assemble/render(mock) -> final gate");
  await api("POST", `/api/tasks/${id}/stages/storyboard/approve`);
  detail = await waitStage(id, "final", "draft");
  check("render auto-approved", detail.stageList.find((s) => s.id === "render").status === "approved");
  const video = await api("GET", `/api/tasks/${id}/file?path=${encodeURIComponent("renders/video.mp4")}`);
  check("video.mp4 served", video.status === 200);

  console.log("smoke: fork at storyboard（从全绿状态分叉）");
  const forked = await api("POST", `/api/tasks/${id}/fork`, { stage: "storyboard" });
  check("fork 201", forked.status === 201, JSON.stringify(forked.data));
  const fid = forked.data.id;
  check("fork parent recorded", forked.data.parent?.task === id && forked.data.parent?.stage === "storyboard");
  const fdetail = await waitStage(fid, "final", "draft");
  check("fork storyboard stays approved", fdetail.stageList.find((s) => s.id === "storyboard").status === "approved");
  check("fork frames reran", fdetail.stageList.find((s) => s.id === "frames").status === "approved");

  console.log("smoke: edit approved artifact -> owner back to draft, downstream stale");
  await api("PUT", `/api/tasks/${id}/file?path=${encodeURIComponent("BRIEF.md")}`, "# edited brief\n");
  detail = (await api("GET", `/api/tasks/${id}`)).data;
  check("brief draft after edit", detail.stageList.find((s) => s.id === "brief").status === "draft");
  check("script stale after edit", detail.stageList.find((s) => s.id === "script").status === "stale");

  console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  console.error("SMOKE ERROR:", err.message);
  process.exitCode = 1;
} finally {
  server.kill();
}
