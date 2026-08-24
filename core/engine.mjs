/**
 * 管线引擎：按 spec 阶段序推进任务。model 阶段走 Runner，tool 阶段跑确定性脚本，
 * review 阶段直接落入人工闸门。闸门 required 的阶段完成后停为 draft 等批准；
 * confirm 阶段启动前停为 confirm 等确认；auto 阶段完成即 approved 并继续推进。
 * model 阶段可声明 candidates: N——一次作业产出 N 份变体，批准时按 choice 复制为正式制品。
 * 打回（reject）归档制品并带反馈重跑。
 * @module core/engine
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { MOCK, PLATFORM_DIR, REF_VIDEOS_DIR } from "../config.mjs";
import { loadSpec } from "./spec.mjs";
import { enqueue } from "./queue.mjs";
import {
  archiveAttempt, invalidateDownstream, readTask, setStage, taskDir, writeTask,
} from "./tasks.mjs";
import { validateOutputs } from "./artifacts.mjs";
import { runTts } from "../tools/tts.mjs";
import { runAssemble, runCheck, runRender } from "../tools/steps.mjs";
import * as kimiCli from "../runners/kimi-cli.mjs";
import * as mock from "../runners/mock.mjs";

/** tool impl 名 → 实现。 */
const TOOLS = {
  "tools/tts": runTts,
  "tools/assemble": runAssemble,
  "tools/render": runRender,
};

/** 内存中正在执行的任务集合（防重入）。 */
const active = new Set();

/** 客户端输入错误（server 映射为 400；其余错误为 500）。 */
function clientErr(msg) {
  const e = new Error(msg);
  e.clientError = true;
  return e;
}

/**
 * 阶段的生效闸门：任务级覆盖 > spec 声明 > auto。
 * 取值：auto（完成即过）/ required（完成后人工批准）/ confirm（启动前人工确认，完成后自动过）。
 * @param {object} task @param {object} stage spec 阶段定义
 * @returns {string}
 */
function effectiveGate(task, stage) {
  return task.gates?.[stage.id] || stage.gate || "auto";
}

/**
 * 推进任务到下一个需要人工的闸门（或终点）。幂等：正在推进中则直接返回。
 * @param {string} taskId
 * @returns {Promise<object>} 最新 task.json
 */
export async function advance(taskId) {
  if (active.has(taskId)) return readTask(taskId);
  const task = readTask(taskId);
  const spec = loadSpec(task.pipeline);
  for (const stage of spec.stages) {
    const st = task.stages[stage.id] || { status: "pending" };
    if (st.status === "approved") continue;
    if (["running", "draft", "failed", "confirm"].includes(st.status)) return task;
    // pending / stale → 启动该阶段（异步作业，完成后再 advance）
    // confirm 闸门：启动前先停下等人确认（st.confirmed 由 approve 写入）
    if (effectiveGate(task, stage) === "confirm" && !st.confirmed) {
      setStage(taskId, stage.id, "confirm");
      return readTask(taskId);
    }
    active.add(taskId);
    void executeStage(taskId, stage)
      .catch(() => { /* 失败已写入阶段状态 */ })
      .finally(() => {
        active.delete(taskId);
        void advance(taskId);
      });
    return task;
  }
  return task; // 全部 approved
}

/**
 * 批准闸门：draft → approved（继续推进下游）；confirm → 确认启动该阶段。
 * 候选阶段（candidates>1）批准时须带 choice，服务端把选中变体复制为正式制品。
 * @param {string} taskId @param {string} stageId @param {number} [choice] 选中的方案号（1..N）
 * @returns {Promise<object>}
 */
export async function approve(taskId, stageId, choice) {
  const task = readTask(taskId);
  const status = task.stages[stageId]?.status;
  if (status === "confirm") {
    setStage(taskId, stageId, "pending", { confirmed: true });
    return advance(taskId);
  }
  if (status !== "draft") {
    throw clientErr(`stage ${stageId} not awaiting approval (status=${status})`);
  }
  const spec = loadSpec(task.pipeline);
  const stage = spec.stages.find((s) => s.id === stageId);
  const candN = stage?.candidates > 1 ? stage.candidates : 0;
  let chosen;
  if (candN) {
    if (choice != null) {
      const n = Number(choice);
      if (!Number.isInteger(n) || n < 1 || n > candN) throw clientErr(`bad choice: ${choice}`);
      copyChoice(taskId, stage, n);
      chosen = n;
    } else if (!task.stages[stageId]?.chosen) {
      // 本 attempt 尚未选过方案时必须带 choice（模板骨架可能已占位 outputs 路径，
      // 不能以制品存在为由放行）。人工编辑后重新批准走 stage.chosen 已记录的旧选择。
      throw clientErr(`stage ${stageId} has ${candN} candidates; choice required`);
    }
  }
  setStage(taskId, stageId, "approved", chosen ? { chosen } : {});
  return advance(taskId);
}

/** 把候选变体 n 复制为正式制品。 */
function copyChoice(taskId, stage, n) {
  const dir = taskDir(taskId);
  for (const out of stage.outputs || []) {
    const rel = out.replace(/\*$/, "");
    const src = join(dir, "candidates", stage.id, String(n), rel);
    const dest = join(dir, rel);
    if (!existsSync(src)) throw new Error(`candidate ${n} missing output: ${out}`);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
}

/**
 * 任务级闸门覆盖。若该阶段正停在 confirm 且新闸门不是 confirm，直接放行推进。
 * @param {string} taskId @param {string} stageId
 * @param {string} gate "auto" | "required" | "confirm"
 * @returns {Promise<object>}
 */
export async function setGateOverride(taskId, stageId, gate) {
  if (!["auto", "required", "confirm"].includes(gate)) throw clientErr(`bad gate: ${gate}`);
  const task = readTask(taskId);
  const spec = loadSpec(task.pipeline);
  if (!spec.stages.some((s) => s.id === stageId)) throw clientErr(`unknown stage: ${stageId}`);
  task.gates = { ...task.gates, [stageId]: gate };
  writeTask(taskId, task);
  if (task.stages[stageId]?.status === "confirm" && gate !== "confirm") {
    setStage(taskId, stageId, "pending", { confirmed: true });
    return advance(taskId);
  }
  return readTask(taskId);
}

/**
 * 打回：归档当前制品，记录反馈，置回 pending 并重新推进（重跑该阶段）。
 * @param {string} taskId @param {string} stageId @param {string} feedback 用户意见
 * @returns {Promise<object>}
 */
export async function reject(taskId, stageId, feedback) {
  const task = readTask(taskId);
  const spec = loadSpec(task.pipeline);
  const stage = spec.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`unknown stage: ${stageId}`);
  if (!["draft", "failed", "approved"].includes(task.stages[stageId]?.status)) {
    throw new Error(`stage ${stageId} cannot be rejected (status=${task.stages[stageId]?.status})`);
  }
  archiveAttempt(taskId, stage);
  invalidateDownstream(taskId, stageId);
  // 候选阶段重跑即新一轮方案，清空上一轮的已选记录
  const extra = { feedback: feedback || "", confirmed: false };
  if (stage.candidates > 1) extra.chosen = null;
  setStage(taskId, stageId, "pending", extra);
  return advance(taskId);
}

/** 用户直接编辑了某制品后调用：所属阶段回 draft，下游失效。 */
export async function onArtifactEdited(taskId, rel) {
  const task = readTask(taskId);
  const spec = loadSpec(task.pipeline);
  const owner = spec.stages.find((s) => (s.outputs || []).includes(rel));
  if (!owner) return task;
  invalidateDownstream(taskId, owner.id);
  const cur = task.stages[owner.id]?.status;
  if (cur === "approved" || cur === "stale") setStage(taskId, owner.id, "draft");
  return readTask(taskId);
}

/**
 * 执行单个阶段（入队串行）。
 * @param {string} taskId @param {object} stage spec 阶段定义
 */
async function executeStage(taskId, stage) {
  const task = readTask(taskId);
  const attempt = (task.stages[stage.id]?.attempt || 0) + 1;
  setStage(taskId, stage.id, "running", {
    attempt,
    ...(stage.candidates > 1 ? { chosen: null } : {}),
  });
  // 候选阶段重跑前清掉上一轮的变体目录（archiveAttempt 是复制不是移动），
  // 否则残留文件会让 validateStage / UI 误读上一轮的方案。
  if (stage.candidates > 1) {
    rmSync(join(taskDir(taskId), "candidates", stage.id), { recursive: true, force: true });
  }
  const gate = effectiveGate(task, stage);
  try {
    await enqueue(taskDir(taskId), stage.id, async (log) => {
      if (stage.type === "review") return; // 无作业，直接落闸门
      const result = MOCK
        ? await mock.run({
          workdir: taskDir(taskId), outputs: stage.outputs, stageId: stage.id,
          candidates: stage.candidates || 0,
        }, log)
        : await runReal(taskId, stage, log);
      if (!result.ok) throw new Error(result.error || "stage failed");
      const validation = await validateStage(taskId, stage);
      if (!validation.ok && !MOCK) throw new Error(validation.error);
    });
    // required 落人工闸门；auto / confirm（启动前已确认过）完成即过。
    // confirmed 一次性消费：完成（或打回）后重跑需再次确认。
    setStage(taskId, stage.id, gate === "required" ? "draft" : "approved", { feedback: "", confirmed: false });
  } catch (err) {
    setStage(taskId, stage.id, "failed", { error: err.message });
  }
}

/**
 * 真实执行一个阶段（model 走 Runner 含自愈循环；tool 走 TOOLS 表）。
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function runReal(taskId, stage, log) {
  if (stage.type === "tool") {
    const impl = TOOLS[stage.impl];
    if (!impl) return { ok: false, error: `unknown tool impl: ${stage.impl}` };
    return impl(taskId, log);
  }
  // model 阶段：渲染 prompt → 调 Runner → 可选自愈循环
  const task = readTask(taskId);
  const feedback = task.stages[stage.id]?.feedback || "";
  const maxAttempts = stage.heal?.maxAttempts ? stage.heal.maxAttempts + 1 : 1;
  const candN = stage.candidates > 1 ? stage.candidates : 0;
  let extra = "";
  for (let n = 1; n <= maxAttempts; n += 1) {
    const prompt = renderPrompt(stage.prompt, {
      title: task.title,
      inputs: (stage.inputs || []).join("\n"),
      outputs: (stage.outputs || []).join("\n"),
      feedback: [feedback, extra].filter(Boolean).join("\n\n"),
      ref: REF_VIDEOS_DIR.replaceAll("\\", "/"),
      candidates: candN ? candidatesInstruction(stage, candN) : "",
    });
    log(`== runner attempt ${n}/${maxAttempts}`);
    const res = await kimiCli.run(
      { workdir: taskDir(taskId), prompt, timeoutMs: stage.timeoutMs },
      log,
    );
    if (!res.ok) return res;
    const validation = await validateStage(taskId, stage);
    if (!validation.ok) {
      extra = `上次执行的产物未通过校验：${validation.error}\n请修复后重新生成。`;
      log(`validation failed: ${validation.error}`);
      continue;
    }
    if (!stage.heal) return { ok: true };
    log("== heal check");
    const check = await runCheck(taskId, log);
    if (check.ok) return { ok: true };
    extra = `上次执行后 hyperframes check 失败，输出如下：\n${(check.output || "").slice(-6000)}\n请修复所有 error 后重新生成。`;
  }
  return { ok: false, error: `stage still failing after ${maxAttempts} attempt(s)` };
}

/**
 * 阶段产物校验：无候选直接校验 outputs；有候选则每个变体（路径加 candidates/<stage>/<i>/ 前缀）
 * 独立过同一套校验，任一变体失败即整体失败并指明方案号。
 * @param {string} taskId @param {object} stage
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function validateStage(taskId, stage) {
  const candN = stage.candidates > 1 ? stage.candidates : 0;
  if (!candN) return validateOutputs(taskId, stage.outputs || []);
  for (let i = 1; i <= candN; i += 1) {
    const v = await validateOutputs(
      taskId,
      stage.outputs || [],
      `candidates/${stage.id}/${i}/`,
    );
    if (!v.ok) return { ok: false, error: `方案 ${i}/${candN}: ${v.error}` };
  }
  return { ok: true };
}

/** 多方案阶段的 prompt 指令块（{{candidates}} 变量）。 */
function candidatesInstruction(stage, n) {
  const examples = (stage.outputs || [])
    .map((o) => `candidates/${stage.id}/1/${o}`)
    .join("、");
  return [
    "## 多方案要求（重要）",
    "",
    `本阶段需要产出 ${n} 个**有显著差异**的方案（切入角度 / 结构 / 取舍各不相同），供人工挑选：`,
    `- 第 i 个方案的全部产出写入 \`candidates/${stage.id}/<i>/\` 目录（i 从 1 到 ${n}），目录内路径结构与正常输出完全一致（例如 ${examples}）。`,
    `- **不要**直接写正式制品路径（${(stage.outputs || []).join("、")}），人工选定方案后由平台复制。`,
    "- 每个方案都必须完整、独立可用、能通过同样的格式校验。",
    "",
  ].join("\n");
}

/**
 * 渲染阶段 prompt 模板（prompts/<name>.md，{{var}} 替换）。
 * @param {string} name 模板名
 * @param {Record<string,string>} vars
 * @returns {string}
 */
function renderPrompt(name, vars) {
  const path = join(PLATFORM_DIR, "prompts", `${name}.md`);
  let tpl = readFileSync(path, "utf8");
  for (const [k, v] of Object.entries(vars)) tpl = tpl.replaceAll(`{{${k}}}`, v);
  return tpl;
}
