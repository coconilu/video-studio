/**
 * 平台冒烟（STUDIO_MOCK=1）：不起真实模型/TTS/渲染，走通
 * 创建 → 闸门批准/打回 → 制品编辑失效级联 → fork → 终态 全链路。
 * 运行：node .probe/smoke.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
/** 冒烟产物写到临时目录，不碰真实用户数据目录（config.mjs 的默认 VIDEOS_DIR）。 */
const TMP_VIDEOS = mkdtempSync(join(tmpdir(), "video-studio-smoke-"));
/** skill 注册也指向临时目录，不碰真实 ~/.agents/skills。 */
const TMP_SKILLS = mkdtempSync(join(tmpdir(), "video-studio-skills-"));
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
  env: { ...process.env, STUDIO_MOCK: "1", STUDIO_PORT: String(PORT), STUDIO_VIDEOS_DIR: TMP_VIDEOS, STUDIO_SKILLS_DIR: TMP_SKILLS },
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
  const doctor = await api("GET", "/api/doctor");
  check("doctor returns checks", doctor.status === 200
    && Array.isArray(doctor.data.checks) && doctor.data.checks.length >= 5
    && doctor.data.checks.every((c) => "ok" in c && "label" in c && "hint" in c)
    && doctor.data.checks.find((c) => c.id === "node")?.ok === true,
    JSON.stringify(doctor.data).slice(0, 200));

  console.log("smoke: skill 注册 / 更新 / 卸载（设置页 API）");
  let skill = await api("GET", "/api/skill");
  check("skill initially not installed", skill.status === 200 && skill.data.installed === false);
  skill = await api("POST", "/api/skill/install", {});
  check("skill install", skill.data.action === "installed" && skill.data.installed === true
    && existsSync(join(TMP_SKILLS, "video-studio", "SKILL.md")), JSON.stringify(skill.data).slice(0, 200));
  skill = await api("GET", "/api/skill");
  check("skill up-to-date after install", skill.data.updateAvailable === false
    && skill.data.installedVersion === skill.data.version);
  writeFileSync(join(TMP_SKILLS, "video-studio", "SKILL.md"), "# tampered\n");
  skill = await api("GET", "/api/skill");
  check("tampered skill detected as update-available", skill.data.updateAvailable === true);
  skill = await api("POST", "/api/skill/install", {});
  check("skill re-install acts as update", skill.data.action === "updated" && skill.data.updateAvailable === false);
  skill = await api("POST", "/api/skill/uninstall", {});
  check("skill uninstall", skill.data.action === "uninstalled" && skill.data.installed === false
    && !existsSync(join(TMP_SKILLS, "video-studio")));

  console.log("smoke: 非法 gates 参数被拒绝");
  const badGates = await api("POST", "/api/tasks", {
    title: "坏闸门", pipeline: "concept-explainer", gates: { nope: "auto" },
  });
  check("unknown stage in gates -> 400", badGates.status === 400, `got ${badGates.status}`);
  const badGateVal = await api("POST", "/api/tasks", {
    title: "坏闸门2", pipeline: "concept-explainer", gates: { brief: "yolo" },
  });
  check("bad gate value -> 400", badGateVal.status === 400, `got ${badGateVal.status}`);

  console.log("smoke: create + auto-advance to brief gate");
  const created = await api("POST", "/api/tasks", {
    title: "冒烟测试", pipeline: "concept-explainer", input: { text: "验证平台状态机。" },
  });
  check("created 201", created.status === 201, JSON.stringify(created.data));
  const id = created.data.id;
  let detail = await waitStage(id, "brief", "draft");
  check("ingest auto-approved", detail.stageList.find((s) => s.id === "ingest").status === "approved");
  check("brief draft at gate", true);

  console.log("smoke: brief 多方案（candidates=3）→ 选方案 2 批准");
  const briefStage = detail.stageList.find((s) => s.id === "brief");
  check("brief has 3 candidate dirs", JSON.stringify(briefStage.candidateDirs) === "[1,2,3]",
    JSON.stringify(briefStage.candidateDirs));
  const noChoice = await api("POST", `/api/tasks/${id}/stages/brief/approve`);
  check("approve without choice rejected (400)", noChoice.status === 400, `got ${noChoice.status}`);
  await api("POST", `/api/tasks/${id}/stages/brief/approve`, { choice: 2 });
  const chosenBrief = await api("GET", `/api/tasks/${id}/artifact?path=${encodeURIComponent("BRIEF.md")}`);
  check("choice 2 copied to BRIEF.md", chosenBrief.status === 200 && chosenBrief.data.content.includes("方案 2"));
  detail = await waitStage(id, "script", "draft");

  console.log("smoke: reject script with feedback -> rerun -> draft again");
  await api("POST", `/api/tasks/${id}/stages/script/reject`, { feedback: "再来一版更紧凑的。" });
  detail = await waitStage(id, "script", "draft");
  check("script attempt=2 after reject", detail.stageList.find((s) => s.id === "script").attempt === 2);

  console.log("smoke: history archive（打回后 attempt 1 制品可查）");
  const hist = await api("GET", `/api/tasks/${id}/history?stage=script`);
  check("history lists attempt 1", hist.status === 200
    && hist.data.attempts?.some((a) => a.attempt === 1 && a.files.some((f) => f.endsWith("SCRIPT.md"))),
    JSON.stringify(hist.data).slice(0, 200));

  console.log("smoke: approve script -> tts 启动确认 -> storyboard gate");
  await api("POST", `/api/tasks/${id}/stages/script/approve`);
  detail = await waitStage(id, "tts", "confirm");
  check("tts waits for start confirm", true);
  await api("POST", `/api/tasks/${id}/stages/tts/approve`);
  detail = await waitStage(id, "storyboard", "draft");
  check("tts auto-approved after confirm", detail.stageList.find((s) => s.id === "tts").status === "approved");

  console.log("smoke: approve storyboard -> frames/render 启动确认 -> final gate");
  await api("POST", `/api/tasks/${id}/stages/storyboard/approve`);
  detail = await waitStage(id, "frames", "confirm");
  check("frames waits for start confirm", true);
  await api("POST", `/api/tasks/${id}/stages/frames/approve`);
  detail = await waitStage(id, "render", "confirm");
  check("render waits for start confirm", true);
  check("assemble auto-approved", detail.stageList.find((s) => s.id === "assemble").status === "approved");
  await api("POST", `/api/tasks/${id}/stages/render/approve`);
  detail = await waitStage(id, "final", "draft");
  check("render auto-approved after confirm", detail.stageList.find((s) => s.id === "render").status === "approved");
  const video = await api("GET", `/api/tasks/${id}/file?path=${encodeURIComponent("renders/video.mp4")}`);
  check("video.mp4 served", video.status === 200);

  console.log("smoke: gate override（render 改为 required 应生效于 detail）");
  const gateRes = await api("PUT", `/api/tasks/${id}/gates`, { stage: "render", gate: "required" });
  check("gate override 200", gateRes.status === 200
    && gateRes.data.stageList.find((s) => s.id === "render").gate === "required", JSON.stringify(gateRes.data).slice(0, 200));
  await api("PUT", `/api/tasks/${id}/gates`, { stage: "render", gate: "confirm" });

  console.log("smoke: fork at storyboard（从全绿状态分叉）");
  const forked = await api("POST", `/api/tasks/${id}/fork`, { stage: "storyboard" });
  check("fork 201", forked.status === 201, JSON.stringify(forked.data));
  const fid = forked.data.id;
  check("fork parent recorded", forked.data.parent?.task === id && forked.data.parent?.stage === "storyboard");
  await waitStage(fid, "frames", "confirm");
  // confirm 阶段改闸门为 auto 应直接放行（无需点确认）
  const release = await api("PUT", `/api/tasks/${fid}/gates`, { stage: "frames", gate: "auto" });
  check("gate override releases confirm stage", release.status === 200, JSON.stringify(release.data).slice(0, 200));
  await waitStage(fid, "render", "confirm");
  await api("POST", `/api/tasks/${fid}/stages/render/approve`);
  const fdetail = await waitStage(fid, "final", "draft");
  check("fork storyboard stays approved", fdetail.stageList.find((s) => s.id === "storyboard").status === "approved");
  check("fork frames reran", fdetail.stageList.find((s) => s.id === "frames").status === "approved");

  console.log("smoke: edit approved artifact -> owner back to draft, downstream stale");
  await api("PUT", `/api/tasks/${id}/file?path=${encodeURIComponent("BRIEF.md")}`, "# edited brief\n");
  detail = (await api("GET", `/api/tasks/${id}`)).data;
  check("brief draft after edit", detail.stageList.find((s) => s.id === "brief").status === "draft");
  check("script stale after edit", detail.stageList.find((s) => s.id === "script").status === "stale");

  console.log("smoke: 编辑后重新批准（不带 choice，沿用 chosen，编辑内容不被 copyChoice 覆盖）");
  await api("POST", `/api/tasks/${id}/stages/brief/approve`);
  const editedBrief = await api("GET", `/api/tasks/${id}/artifact?path=${encodeURIComponent("BRIEF.md")}`);
  check("edit preserved after re-approve", editedBrief.status === 200 && editedBrief.data.content.includes("# edited brief"));
  detail = await waitStage(id, "script", "draft");
  check("brief approved after edit re-approve", detail.stageList.find((s) => s.id === "brief").status === "approved");

  console.log("smoke: reject 候选阶段清空 chosen，新一轮须重新选方案");
  await api("POST", `/api/tasks/${id}/stages/brief/reject`, { feedback: "" });
  detail = await waitStage(id, "brief", "draft");
  check("chosen cleared after reject", detail.stageList.find((s) => s.id === "brief").chosen == null);
  const noChoice2 = await api("POST", `/api/tasks/${id}/stages/brief/approve`);
  check("re-run requires choice again (400)", noChoice2.status === 400, `got ${noChoice2.status}`);

  console.log("smoke: 全自动模式（gates:\"auto\" 一键跑到 final approved，brief 自动选方案 1）");
  const autoTask = await api("POST", "/api/tasks", {
    title: "全自动冒烟", pipeline: "concept-explainer", gates: "auto", input: { text: "无人值守。" },
  });
  check("auto task 201", autoTask.status === 201, JSON.stringify(autoTask.data));
  const aid = autoTask.data.id;
  check("gates expanded to all stages", autoTask.data.gates?.render === "auto" && autoTask.data.gates?.final === "auto");
  const autoDetail = await waitStage(aid, "final", "approved", 60000);
  const autoBrief = autoDetail.stageList.find((s) => s.id === "brief");
  check("brief auto-approved with chosen=1", autoBrief.status === "approved" && autoBrief.chosen === 1,
    JSON.stringify(autoBrief));
  check("all stages approved", autoDetail.stageList.every((s) => s.status === "approved"));
  const autoVideo = await api("GET", `/api/tasks/${aid}/file?path=${encodeURIComponent("renders/video.mp4")}`);
  check("auto pipeline produced video.mp4", autoVideo.status === 200);

  console.log("smoke: gates 对象形式 + confirm 闸门下候选阶段也自动选 1");
  const objTask = await api("POST", "/api/tasks", {
    title: "对象闸门", pipeline: "concept-explainer", gates: { brief: "confirm", tts: "auto" },
  });
  check("object gates accepted", objTask.status === 201
    && objTask.data.gates?.brief === "confirm" && objTask.data.gates?.tts === "auto",
    JSON.stringify(objTask.data).slice(0, 200));
  const oid = objTask.data.id;
  await waitStage(oid, "brief", "confirm"); // confirm 闸门：启动前停下
  await api("POST", `/api/tasks/${oid}/stages/brief/approve`); // 确认启动
  const odetail = await waitStage(oid, "brief", "approved"); // confirm 完成即过
  check("confirm gate auto-picks choice 1",
    odetail.stageList.find((s) => s.id === "brief").chosen === 1);

  console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  console.error("SMOKE ERROR:", err.message);
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(TMP_VIDEOS, { recursive: true, force: true });
  rmSync(TMP_SKILLS, { recursive: true, force: true });
}
