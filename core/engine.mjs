/**
 * 管线引擎：按 spec 阶段序推进任务。model 阶段走 Runner，tool 阶段跑确定性脚本，
 * review 阶段直接落入人工闸门。闸门 required 的阶段完成后停为 draft 等批准；
 * auto 阶段完成即 approved 并继续推进。打回（reject）归档制品并带反馈重跑。
 * @module core/engine
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    if (["running", "draft", "failed"].includes(st.status)) return task;
    // pending / stale → 启动该阶段（异步作业，完成后再 advance）
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
 * 批准闸门：draft → approved，并继续推进下游。
 * @param {string} taskId @param {string} stageId
 * @returns {Promise<object>}
 */
export async function approve(taskId, stageId) {
  const task = readTask(taskId);
  if (task.stages[stageId]?.status !== "draft") {
    throw new Error(`stage ${stageId} not awaiting approval (status=${task.stages[stageId]?.status})`);
  }
  setStage(taskId, stageId, "approved");
  return advance(taskId);
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
  setStage(taskId, stageId, "pending", { feedback: feedback || "" });
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
  setStage(taskId, stage.id, "running", { attempt });
  const gate = task.gates[stage.id] || stage.gate || "auto";
  try {
    await enqueue(taskDir(taskId), stage.id, async (log) => {
      if (stage.type === "review") return; // 无作业，直接落闸门
      const result = MOCK
        ? await mock.run({ workdir: taskDir(taskId), outputs: stage.outputs, stageId: stage.id }, log)
        : await runReal(taskId, stage, log);
      if (!result.ok) throw new Error(result.error || "stage failed");
      const validation = await validateOutputs(taskId, stage.outputs || []);
      if (!validation.ok && !MOCK) throw new Error(validation.error);
    });
    setStage(taskId, stage.id, gate === "required" ? "draft" : "approved", { feedback: "" });
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
  let extra = "";
  for (let n = 1; n <= maxAttempts; n += 1) {
    const prompt = renderPrompt(stage.prompt, {
      title: task.title,
      inputs: (stage.inputs || []).join("\n"),
      outputs: (stage.outputs || []).join("\n"),
      feedback: [feedback, extra].filter(Boolean).join("\n\n"),
      ref: REF_VIDEOS_DIR.replaceAll("\\", "/"),
    });
    log(`== runner attempt ${n}/${maxAttempts}`);
    const res = await kimiCli.run(
      { workdir: taskDir(taskId), prompt, timeoutMs: stage.timeoutMs },
      log,
    );
    if (!res.ok) return res;
    const validation = await validateOutputs(taskId, stage.outputs || []);
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
