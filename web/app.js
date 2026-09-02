"use strict";

/* 教学视频生产平台 · 纯静态前端（无框架、无构建步骤，同源调 /api/*）。
 * 结构：API 封装 → 状态 → 任务树 → 任务详情（阶段时间线 + 面板）→ 动作 → 轮询。
 * 跨重绘保留的界面状态集中在 ui 对象；轮询在页面失焦时暂停。
 */

/* ---------- 小工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const enc = encodeURIComponent;

/** HTML 转义（所有插值必须过这里）。 */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** ISO 时间 → YYYY-MM-DD HH:mm（本地时区）。 */
function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "");
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 按扩展名归类制品 → 预览方式。 */
function kindOf(path) {
  const ext = String(path).split(".").pop().toLowerCase();
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["wav", "mp3", "m4a", "aac", "flac"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "svg", "gif", "webp"].includes(ext)) return "image";
  if (["md", "json", "html", "htm", "yml", "yaml", "txt", "css", "js", "mjs", "log"].includes(ext)) return "text";
  return "other";
}

const fileUrl = (id, rel) => `/api/tasks/${enc(id)}/file?path=${enc(rel)}`;
const artifactUrl = (id, rel) => `/api/tasks/${enc(id)}/artifact?path=${enc(rel)}`;

/* ---------- Toast（右下角；相同消息 8s 内去重，防轮询报错刷屏） ---------- */
let lastToast = { msg: "", at: 0 };
function toast(msg, kind = "error") {
  const now = Date.now();
  if (msg === lastToast.msg && now - lastToast.at < 8000) return;
  lastToast = { msg, at: now };
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

/* ---------- API 封装：非 2xx 一律抛错，由调用方 toast ---------- */
async function api(path, opts = {}) {
  const { method = "GET", json, text } = opts;
  const init = { method, headers: {} };
  if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  if (text !== undefined) {
    init.headers["content-type"] = "text/plain; charset=utf-8";
    init.body = text;
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new Error(`网络错误：${err.message}`);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch { /* 错误体不是 JSON，用状态码 */ }
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

/* ---------- 常量 ---------- */
const STAGE_LABELS = {
  ingest: "材料整理", brief: "选题简报", script: "口播脚本", tts: "配音合成",
  storyboard: "分镜脚本", frames: "画面帧", assemble: "组装", render: "渲染", final: "终审",
};
const TYPE_LABELS = { model: "模型", tool: "工具", review: "人工" };
const STATUS_META = {
  pending: { label: "等待", cls: "pending" },
  running: { label: "运行中", cls: "running" },
  draft: { label: "待审", cls: "draft" },
  approved: { label: "已批准", cls: "approved" },
  stale: { label: "已失效", cls: "stale" },
  failed: { label: "失败", cls: "failed" },
  confirm: { label: "待确认启动", cls: "draft" },
};
const GATE_LABELS = { auto: "自动通过", required: "完成后人工批准", confirm: "启动前人工确认" };

/* ---------- 状态 ---------- */
const state = {
  health: null,
  pipelines: [],
  tasks: [],
  selectedId: null,
  detail: null,        // 当前任务详情（含 stageList）
  detailSig: "",       // 详情签名：没变就不重绘（保住视频播放位置等）
  artifactCache: new Map(), // `${taskId}:${path}` -> 文本内容
};

/* 跨重绘保留的界面状态（切任务时重置）。 */
const ui = {
  openStage: null,   // 展开的阶段 id
  logOpen: {},       // stageId -> bool
  logLines: {},      // stageId -> 日志文本缓存
  preview: {},       // stageId -> {path, kind}
  editing: {},       // `${taskId}:${path}` -> {active, value}
  rejectFor: null,   // 打回表单展开的阶段 id
  feedback: {},      // stageId -> 打回意见草稿
  histSel: {},       // stageId -> 查看中的历史 attempt 号
  candSel: {},       // stageId -> 选中的候选方案号
};

function resetUi() {
  ui.openStage = null;
  ui.logOpen = {};
  ui.logLines = {};
  ui.preview = {};
  ui.editing = {};
  ui.rejectFor = null;
  ui.feedback = {};
  ui.histSel = {};
  ui.candSel = {};
}

/* ---------- 任务列表 / 血缘树 ---------- */
function buildTree(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map();
  const roots = [];
  for (const t of tasks) {
    const pid = t.parent && t.parent.task;
    if (pid && byId.has(pid)) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(t);
    } else {
      roots.push(t); // 接口已按创建时间倒序；父任务缺失的孤儿也按根处理
    }
  }
  for (const list of children.values()) {
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  return { roots, children };
}

function statusDotOf(t) {
  if (t.summary && t.summary.finished) return "approved";
  const cur = t.summary && t.summary.current;
  return (cur && t.stages && t.stages[cur] && t.stages[cur].status) || "pending";
}

function nodeHtml(t, children) {
  const st = statusDotOf(t);
  const s = t.summary || {};
  const meta = s.finished
    ? `${esc(t.pipeline)} · 已完成`
    : `${esc(t.pipeline)} · ${s.done ?? 0}/${s.total ?? "?"}${s.current ? ` · ${esc(s.current)}` : ""}`;
  const fork = t.parent
    ? `<span class="fork-tag mono" title="从 ${esc(t.parent.task)} 的 ${esc(t.parent.stage)} 分叉">⑂ ${esc(t.parent.stage)}</span>`
    : "";
  const kids = children.get(t.id) || [];
  return `<div class="tnode-wrap">
    <div class="tnode${t.id === state.selectedId ? " selected" : ""}" data-action="select-task" data-id="${esc(t.id)}" title="${esc(t.id)}">
      <div class="trow1"><span class="tdot tdot-${st}"></span><span class="ttitle">${esc(t.title)}</span>${fork}</div>
      <div class="trow2">${meta}</div>
    </div>
    ${kids.length ? `<div class="tkids">${kids.map((k) => nodeHtml(k, children)).join("")}</div>` : ""}
  </div>`;
}

function renderTaskTree() {
  const host = $("#task-tree");
  if (!state.tasks.length) {
    host.innerHTML = `<div class="muted-note" style="padding:6px 4px">还没有任务。</div>`;
    return;
  }
  const { roots, children } = buildTree(state.tasks);
  host.innerHTML = roots.map((t) => nodeHtml(t, children)).join("");
}

async function loadTasks() {
  try {
    state.tasks = await api("/api/tasks");
    renderTaskTree();
    if (!state.selectedId && state.tasks.length) await selectTask(state.tasks[0].id);
  } catch (e) {
    toast(`加载任务列表失败：${e.message}`);
  }
}

/* ---------- 任务详情 ---------- */
function detailSignature(d) {
  return [
    d.title, d.pipeline,
    d.parent ? `${d.parent.task}@${d.parent.stage}` : "",
    d.stageList.map((s) => `${s.id}:${s.status}:${s.attempt}:${s.error || ""}:${s.feedback || ""}:${s.gate}:${s.chosen ?? ""}`).join("|"),
  ].join("#");
}

async function loadDetail(id) {
  try {
    const d = await api(`/api/tasks/${enc(id)}`);
    // 首次进入自动展开最需要人看的阶段：待审/待确认/运行中/失败 > 未完成 > 最后一阶段
    if (!ui.openStage) {
      const pick = d.stageList.find((s) => ["draft", "confirm", "running", "failed"].includes(s.status))
        || d.stageList.find((s) => s.status !== "approved")
        || d.stageList[d.stageList.length - 1];
      if (pick) {
        ui.openStage = pick.id;
        if (pick.status === "running") ui.logOpen[pick.id] = true;
      }
    }
    const sig = detailSignature(d);
    const changed = sig !== state.detailSig || !state.detail || state.detail.id !== d.id;
    state.detail = d;
    updateTitle(d);
    if (changed) {
      state.detailSig = sig;
      renderDetail();
    }
  } catch (e) {
    toast(`加载任务详情失败：${e.message}`);
  }
}

/* ---------- 标题栏角标：有待人工处理的阶段时在标题前加 ● ---------- */
const BASE_TITLE = document.title;
function updateTitle(d) {
  const needs = d && d.stageList.some((s) => ["draft", "confirm", "failed"].includes(s.status));
  document.title = needs ? `● 待人工 · ${BASE_TITLE}` : BASE_TITLE;
}

async function selectTask(id) {
  if (state.selectedId === id && state.detail) { renderTaskTree(); return; }
  state.selectedId = id;
  state.detail = null;
  state.detailSig = "";
  resetUi();
  renderTaskTree();
  renderDetail(); // 占位「加载中」
  await loadDetail(id);
}

function detailHeaderHtml(d) {
  const done = d.stageList.filter((s) => s.status === "approved").length;
  const total = d.stageList.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const parent = d.parent
    ? `<button class="parent-chip" data-action="select-task" data-id="${esc(d.parent.task)}">⑂ 父任务 ${esc(d.parent.task)} @ ${esc(d.parent.stage)}</button>`
    : "";
  return `<div class="detail-head">
    <div class="detail-title-row">
      <h1>${esc(d.title)}</h1>
      <button class="btn btn-ghost btn-sm" data-action="advance-task" title="让引擎继续推进 pending/stale 阶段">推进</button>
    </div>
    <div class="detail-meta mono">
      <span>${esc(d.id)}</span><span>${esc(d.pipeline)}</span><span>${fmtTime(d.createdAt)}</span>${parent}
    </div>
    <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="progress-label mono">${done}/${total} 阶段已批准</div>
  </div>`;
}

/* ---------- 阶段行 + 面板 ---------- */
function stageRowHtml(s, i) {
  const meta = STATUS_META[s.status] || STATUS_META.pending;
  const open = ui.openStage === s.id;
  const label = STAGE_LABELS[s.id] || s.id;
  const gate = s.gate === "required" ? `<span class="tag tag-gate">人工闸门</span>`
    : s.gate === "confirm" ? `<span class="tag tag-gate">启动确认</span>` : "";
  const attempt = s.attempt > 0 ? `<span class="attempt mono">attempt ${s.attempt}</span>` : "";
  const icon = s.status === "running" ? `<span class="spin"></span>` : `<span class="bdot"></span>`;
  return `<div class="stage${open ? " open" : ""}">
    <button class="stage-head" data-action="toggle-stage" data-stage="${esc(s.id)}">
      <span class="stage-idx mono">${String(i + 1).padStart(2, "0")}</span>
      <span class="stage-name">${esc(label)}<span class="stage-id mono">${esc(s.id)}</span></span>
      <span class="stage-tags"><span class="tag">${TYPE_LABELS[s.type] || esc(s.type)}</span>${gate}</span>
      ${attempt}
      <span class="badge badge-${meta.cls}">${icon}${meta.label}</span>
      <span class="chev">${open ? "▾" : "▸"}</span>
    </button>
    ${open ? `<div class="stage-panel" data-panel="${esc(s.id)}">${stagePanelHtml(s)}</div>` : ""}
  </div>`;
}

function stagePanelHtml(s) {
  const parts = [];
  const sub = [
    s.type === "tool" && s.impl ? `impl ${s.impl}` : "",
    s.type === "model" && s.prompt ? `prompt prompts/${s.prompt}.md` : "",
    s.heal ? `自愈 ≤${s.heal.maxAttempts} 次` : "",
  ].filter(Boolean).join(" · ");
  if (sub) parts.push(`<div class="panel-sub mono">${esc(sub)}</div>`);

  // 闸门任务级覆盖（写入 task.gates）
  parts.push(`<div class="gate-row"><span class="sec-label mono" style="margin:0">闸门</span>
    <select class="hist-select" data-gate-select="${esc(s.id)}">
      ${["auto", "required", "confirm"].map((g) => `<option value="${g}"${s.gate === g ? " selected" : ""}>${GATE_LABELS[g]}</option>`).join("")}
    </select>
  </div>`);

  // review（final）阶段无制品作业，直接把输入视频嵌进面板 + 闸门按钮
  if (s.type === "review") {
    for (const v of (s.inputs || []).filter((p) => kindOf(p) === "video")) {
      parts.push(`<video class="media-video final-video" controls preload="metadata" src="${fileUrl(state.selectedId, v)}"></video>`);
    }
  }
  if (s.status === "failed" && s.error) parts.push(`<div class="error-box mono">${esc(s.error)}</div>`);
  if (s.feedback) parts.push(`<div class="feedback-box"><span class="lbl mono">最近反馈</span>${esc(s.feedback)}</div>`);

  const secLabel = s.type === "review" ? "审阅对象 inputs" : "制品 outputs";
  parts.push(`<div class="panel-sec"><div class="sec-label mono">${secLabel}</div>${candidatesBarHtml(s)}<div class="arts" data-arts="${esc(s.id)}">${outputsHtml(s)}</div></div>`);
  parts.push(`<div data-history-slot="${esc(s.id)}"></div>`);
  parts.push(`<div class="preview-host" data-preview-host="${esc(s.id)}">${previewHtml(s)}</div>`);
  parts.push(stageActionsHtml(s));
  if (ui.rejectFor === s.id) parts.push(rejectFormHtml(s));
  parts.push(logsHtml(s));
  return parts.join("");
}

/** 多方案阶段当前选中方案的 candidates 路径前缀；非候选场景返回 null。
 *  仅「本 attempt 尚未选过方案」的首次 draft 指向候选路径；编辑正式制品后回到 draft
 *  （chosen 已记录）则展示正式制品，重新批准不再带 choice——否则 copyChoice 会冲掉人工编辑。 */
function activeCandidatePrefix(s) {
  if (!(s.candidates > 1) || !(s.candidateDirs || []).length || s.status !== "draft") return null;
  if (s.chosen != null) return null;
  const sel = ui.candSel[s.id] ?? s.candidateDirs[0];
  return `candidates/${s.id}/${sel}/`;
}

/** 方案切换标签条（仅多方案 draft 阶段）。 */
function candidatesBarHtml(s) {
  if (!activeCandidatePrefix(s)) return "";
  const sel = ui.candSel[s.id] ?? s.candidateDirs[0];
  return `<div class="cand-tabs">${s.candidateDirs.map((n) =>
    `<button class="cand-tab${n === sel ? " active" : ""}" data-action="cand-select" data-stage="${esc(s.id)}" data-n="${n}">方案 ${n}</button>`,
  ).join("")}<span class="muted-note" style="padding:0">选中后预览即对应该方案，批准时采用它。</span></div>`;
}

function outputsHtml(s) {
  // review 阶段没有 outputs，输入即可审阅对象（视频已在上方嵌入）
  if (s.type === "review") {
    const list = (s.inputs || []).map((p) => artifactRowHtml(s.id, p)).join("");
    return list || `<div class="muted-note">无输入制品。</div>`;
  }
  const outs = s.outputs || [];
  if (!outs.length) return `<div class="muted-note">该阶段无声明制品。</div>`;
  // 多方案阶段（draft 且候选已落盘）：制品行指向选中方案的 candidates 路径
  const candPrefix = activeCandidatePrefix(s);
  if (candPrefix) {
    return outs.map((o) => {
      if (o.endsWith("*") || o.endsWith("/")) {
        return `<div class="muted-note">目录/通配输出 ${esc(o)} 不支持候选预览。</div>`;
      }
      return artifactRowHtml(s.id, `${candPrefix}${o}`);
    }).join("");
  }
  return outs.map((o) => {
    // 目录/通配输出无法直接列举（file 接口对目录 404），按平台约定硬编码展开规则
    if (o === "audio/") {
      return `<div class="expand-slot" data-expand-audio="${esc(s.id)}"><div class="muted-note">展开 audio/ 目录…</div></div>`;
    }
    if (o.endsWith("*")) {
      if (o.startsWith("compositions/frames/")) {
        return `<div class="expand-slot" data-expand-frames="${esc(s.id)}"><div class="muted-note">展开帧列表…</div></div>`;
      }
      return `<div class="muted-note">通配输出 ${esc(o)}（无法列举）</div>`;
    }
    if (o.endsWith("/")) return `<div class="muted-note">目录输出 ${esc(o)}（无法列举）</div>`;
    return artifactRowHtml(s.id, o);
  }).join("");
}

function artifactRowHtml(stageId, path) {
  const kind = kindOf(path);
  const active = ui.preview[stageId] && ui.preview[stageId].path === path;
  const ext = String(path).split(".").pop().toLowerCase();
  return `<button class="art-row${active ? " active" : ""}" data-action="preview-artifact" data-stage="${esc(stageId)}" data-path="${esc(path)}">
    <span class="kind mono">${esc(ext)}</span><span class="art-path">${esc(path)}</span>
  </button>`;
}

function previewHtml(s) {
  const p = ui.preview[s.id];
  if (!p) return "";
  const id = state.selectedId;
  const label = `<div class="sec-label mono">${esc(p.path)}</div>`;
  if (p.kind === "video") {
    return `<div class="preview">${label}<video class="media-video" controls preload="metadata" src="${fileUrl(id, p.path)}"></video></div>`;
  }
  if (p.kind === "audio") {
    return `<div class="preview">${label}<audio controls preload="metadata" src="${fileUrl(id, p.path)}"></audio></div>`;
  }
  if (p.kind === "image") {
    return `<div class="preview">${label}<img class="media-img" src="${fileUrl(id, p.path)}" alt="${esc(p.path)}"></div>`;
  }
  if (p.kind === "text") {
    const key = `${id}:${p.path}`;
    const content = state.artifactCache.has(key) ? state.artifactCache.get(key) : "（加载中…）";
    const ed = ui.editing[key];
    if (ed && ed.active) {
      return `<div class="preview">${label}
        <textarea class="editor" data-edit-key="${esc(key)}" spellcheck="false">${esc(ed.value)}</textarea>
        <div class="row-actions">
          <button class="btn btn-primary btn-sm" data-action="save-artifact" data-path="${esc(p.path)}">保存</button>
          <button class="btn btn-ghost btn-sm" data-action="cancel-edit" data-path="${esc(p.path)}">取消</button>
        </div>
        <div class="muted-note">保存会使所属阶段回到「待审」，下游阶段失效。</div>
      </div>`;
    }
    // 历史版本只读，不提供编辑入口
    const editBtn = p.path.startsWith(".history/") ? ""
      : `<div class="row-actions"><button class="btn btn-ghost btn-sm" data-action="edit-artifact" data-path="${esc(p.path)}">编辑</button></div>`;
    return `<div class="preview">${label}
      <pre class="artifact-pre mono">${esc(content)}</pre>
      ${editBtn}
    </div>`;
  }
  return `<div class="preview">${label}<div class="muted-note">该类型暂不支持预览。</div></div>`;
}

function stageActionsHtml(s) {
  const btns = [];
  if (s.status === "confirm") {
    btns.push(`<button class="btn btn-primary btn-sm" data-action="approve" data-stage="${esc(s.id)}">确认开始</button>`);
    btns.push(`<span class="muted-note">该阶段启动前需人工确认（耗时/耗配额）。</span>`);
  }
  if (s.status === "draft") {
    const candSel = activeCandidatePrefix(s) ? (ui.candSel[s.id] ?? s.candidateDirs[0]) : null;
    const approveLabel = candSel ? `批准方案 ${candSel}` : "批准";
    btns.push(`<button class="btn btn-primary btn-sm" data-action="approve" data-stage="${esc(s.id)}">${approveLabel}</button>`);
    btns.push(`<button class="btn btn-danger btn-sm" data-action="reject-open" data-stage="${esc(s.id)}">打回</button>`);
  }
  if (s.status === "failed") {
    btns.push(`<button class="btn btn-primary btn-sm" data-action="retry" data-stage="${esc(s.id)}">重试</button>`);
  }
  if (s.status === "stale") {
    btns.push(`<span class="muted-note">上游已变更，批准上游后自动重跑。</span>`);
  }
  btns.push(`<button class="btn btn-ghost btn-sm" data-action="fork" data-stage="${esc(s.id)}" title="从该阶段分叉出新任务">⑂ 从此 fork</button>`);
  return `<div class="row-actions stage-actions">${btns.join("")}</div>`;
}

function rejectFormHtml(s) {
  const val = ui.feedback[s.id] || "";
  return `<div class="reject-form">
    <textarea class="editor" data-feedback-for="${esc(s.id)}" placeholder="打回意见（会追加进重跑的 prompt）">${esc(val)}</textarea>
    <div class="row-actions">
      <button class="btn btn-danger btn-sm" data-action="reject-submit" data-stage="${esc(s.id)}">确认打回</button>
      <button class="btn btn-ghost btn-sm" data-action="reject-cancel">取消</button>
    </div>
  </div>`;
}

function logsHtml(s) {
  const open = !!ui.logOpen[s.id];
  const text = ui.logLines[s.id] || "";
  return `<div class="logs">
    <button class="logs-toggle mono" data-action="toggle-logs" data-stage="${esc(s.id)}">${open ? "▾" : "▸"} 日志${s.status === "running" ? " · 实时" : ""}</button>
    ${open ? `<pre class="log-pre" data-log-pre="${esc(s.id)}">${esc(text) || "（暂无日志）"}</pre>` : ""}
  </div>`;
}

function renderDetail() {
  const host = $("#detail");
  const d = state.detail;
  if (!d) {
    host.innerHTML = state.selectedId
      ? `<div class="detail-inner"><div class="empty"><p>加载中…</p></div></div>`
      : `<div class="detail-inner"><div class="empty">
          <div class="empty-mark">✱</div>
          <p>${state.tasks.length ? "选择左侧任务查看详情。" : "还没有任务。从一个想法开始，跑通整条生产线。"}</p>
          ${state.tasks.length ? "" : `<button class="btn btn-primary" data-action="open-new">新建任务</button>`}
        </div></div>`;
    return;
  }
  host.innerHTML = `<div class="detail-inner">${detailHeaderHtml(d)}
    <div class="stages">${d.stageList.map((s, i) => stageRowHtml(s, i)).join("")}</div>
  </div>`;
  void expandOutputs();
}

/* ---------- 目录型输出的硬编码展开（audio/ ← audio_meta.json；frames/* ← STORYBOARD.md） + 历史版本 ---------- */
async function expandOutputs() {
  const d = state.detail;
  if (!d) return;
  for (const el of document.querySelectorAll("[data-expand-audio]")) {
    const stageId = el.getAttribute("data-expand-audio");
    try {
      const j = await api(artifactUrl(d.id, "audio_meta.json"));
      const meta = JSON.parse(j.content);
      const paths = (meta.voices || []).map((v) => v.path).filter(Boolean);
      el.innerHTML = paths.length
        ? paths.map((p) => artifactRowHtml(stageId, p)).join("")
        : `<div class="muted-note">audio/ 目录为空。</div>`;
    } catch {
      el.innerHTML = `<div class="muted-note">audio_meta.json 尚未生成，暂时无法列出音频。</div>`;
    }
  }
  for (const el of document.querySelectorAll("[data-expand-frames]")) {
    const stageId = el.getAttribute("data-expand-frames");
    try {
      const j = await api(artifactUrl(d.id, "STORYBOARD.md"));
      const found = [...j.content.matchAll(/^\s*-\s*src:\s*(compositions\/frames\/\S+)\s*$/gm)].map((m) => m[1]);
      const paths = [...new Set(found)];
      el.innerHTML = paths.length
        ? paths.map((p) => artifactRowHtml(stageId, p)).join("")
        : `<div class="muted-note">STORYBOARD.md 中没有帧条目。</div>`;
    } catch {
      el.innerHTML = `<div class="muted-note">STORYBOARD.md 尚未生成，暂时无法列出帧。</div>`;
    }
  }
  // 历史版本（打回归档在 .history/<stage>/<attempt>/）：有记录才渲染该区块
  for (const el of document.querySelectorAll("[data-history-slot]")) {
    const stageId = el.getAttribute("data-history-slot");
    try {
      const j = await api(`/api/tasks/${enc(d.id)}/history?stage=${enc(stageId)}`);
      const attempts = j.attempts || [];
      if (!attempts.length) { el.innerHTML = ""; continue; }
      const sel = ui.histSel[stageId] ?? attempts[0].attempt;
      const cur = attempts.find((a) => a.attempt === sel) || attempts[0];
      el.innerHTML = `<div class="panel-sec"><div class="sec-label mono">历史版本（打回归档，只读）</div>
        <div class="row-actions" style="margin-bottom:8px">
          <select class="hist-select" data-history-select="${esc(stageId)}">
            ${attempts.map((a) => `<option value="${a.attempt}"${a.attempt === cur.attempt ? " selected" : ""}>attempt ${a.attempt}</option>`).join("")}
          </select>
        </div>
        <div class="arts">${cur.files.map((p) => artifactRowHtml(stageId, p)).join("")}</div>
      </div>`;
    } catch {
      el.innerHTML = "";
    }
  }
}

/* ---------- 日志轮询 ---------- */
function logPreEl(stageId) {
  for (const el of document.querySelectorAll("[data-log-pre]")) {
    if (el.getAttribute("data-log-pre") === stageId) return el;
  }
  return null;
}

/** 按阶段 id 找展开面板的 DOM（id 可能含特殊字符，不走选择器转义）。 */
function panelEl(stageId) {
  for (const el of document.querySelectorAll("[data-panel]")) {
    if (el.getAttribute("data-panel") === stageId) return el;
  }
  return null;
}

async function pollLogs(taskId, stageId) {
  try {
    const j = await api(`/api/tasks/${enc(taskId)}/logs?stage=${enc(stageId)}&tail=200`);
    const text = (j.lines || []).join("\n");
    if (text !== ui.logLines[stageId]) {
      ui.logLines[stageId] = text;
      const pre = logPreEl(stageId);
      if (pre) {
        pre.textContent = text || "（暂无日志）";
        pre.scrollTop = pre.scrollHeight;
      }
    }
  } catch (e) {
    toast(`读取日志失败：${e.message}`);
  }
}

/* ---------- 动作 ---------- */
async function refresh() {
  await loadTasks();
  if (state.selectedId) await loadDetail(state.selectedId);
}

async function doApprove(stage) {
  const s = state.detail?.stageList.find((x) => x.id === stage);
  const body = {};
  if (s && activeCandidatePrefix(s)) body.choice = ui.candSel[stage] ?? s.candidateDirs[0];
  await api(`/api/tasks/${enc(state.selectedId)}/stages/${enc(stage)}/approve`, { method: "POST", json: body });
  toast(`已批准 ${stage}${body.choice ? `（方案 ${body.choice}）` : ""}`, "info");
  await refresh();
}

async function doReject(stage) {
  const feedback = ui.feedback[stage] || "";
  await api(`/api/tasks/${enc(state.selectedId)}/stages/${enc(stage)}/reject`, { method: "POST", json: { feedback } });
  ui.rejectFor = null;
  delete ui.feedback[stage];
  delete ui.candSel[stage];   // 重跑即新一轮方案/历史，清掉残留选择
  delete ui.histSel[stage];
  toast(`已打回 ${stage}，重新排队`, "info");
  await refresh();
}

async function doRetry(stage) {
  await api(`/api/tasks/${enc(state.selectedId)}/stages/${enc(stage)}/reject`, { method: "POST", json: { feedback: "" } });
  delete ui.candSel[stage];
  delete ui.histSel[stage];
  toast(`已重新排队 ${stage}`, "info");
  await refresh();
}

async function doFork(stage) {
  const t = await api(`/api/tasks/${enc(state.selectedId)}/fork`, { method: "POST", json: { stage } });
  toast(`已 fork 出新任务：${t.id}`, "info");
  await loadTasks();
  await selectTask(t.id);
}

async function doAdvance() {
  await api(`/api/tasks/${enc(state.selectedId)}/advance`, { method: "POST", json: {} });
  await refresh();
}

async function doSaveArtifact(path) {
  const key = `${state.selectedId}:${path}`;
  const ed = ui.editing[key];
  if (!ed) return;
  await api(`/api/tasks/${enc(state.selectedId)}/file?path=${enc(path)}`, { method: "PUT", text: ed.value });
  state.artifactCache.set(key, ed.value);
  delete ui.editing[key];
  toast(`已保存 ${path}`, "info");
  await refresh();
  renderDetail();
}

async function previewArtifact(stageId, path) {
  const cur = ui.preview[stageId];
  if (cur && cur.path === path) { // 再点一次收起
    delete ui.preview[stageId];
    renderDetail();
    return;
  }
  const kind = kindOf(path);
  ui.preview[stageId] = { path, kind };
  if (kind === "text") {
    const key = `${state.selectedId}:${path}`;
    if (!state.artifactCache.has(key)) {
      try {
        const j = await api(artifactUrl(state.selectedId, path));
        state.artifactCache.set(key, j.content);
      } catch (e) {
        delete ui.preview[stageId];
        renderDetail();
        toast(`读取制品失败：${e.message}`);
        return;
      }
    }
  }
  renderDetail();
}

/* ---------- 事件委托 ---------- */
function bindEvents() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    const stage = el.getAttribute("data-stage");
    const path = el.getAttribute("data-path");
    const id = el.getAttribute("data-id");
    const run = (fn) => { el.disabled = true; fn().catch((err) => toast(err.message)).finally(() => { el.disabled = false; }); };

    switch (action) {
      case "select-task": void selectTask(id); break;
      case "toggle-stage": {
        ui.openStage = ui.openStage === stage ? null : stage;
        ui.rejectFor = null;
        const d = state.detail;
        const st = d && d.stageList.find((s) => s.id === ui.openStage);
        if (st && st.status === "running") ui.logOpen[st.id] = true;
        renderDetail();
        if (st) void pollLogs(d.id, st.id);
        break;
      }
      case "toggle-logs": {
        ui.logOpen[stage] = !ui.logOpen[stage];
        // 局部替换日志块，避免整面板重绘重置正在播放的音视频
        const d = state.detail;
        const st = d && d.stageList.find((s) => s.id === stage);
        const panel = panelEl(stage);
        const logsEl = panel && panel.querySelector(".logs");
        if (st && logsEl) logsEl.outerHTML = logsHtml(st);
        else renderDetail();
        if (ui.logOpen[stage] && d) void pollLogs(d.id, stage);
        break;
      }
      case "preview-artifact": void previewArtifact(stage, path); break;
      case "cand-select": {
        ui.candSel[stage] = Number(el.getAttribute("data-n"));
        delete ui.preview[stage]; // 预览指向旧方案路径，切方案后清空
        renderDetail();
        break;
      }
      case "edit-artifact": {
        const key = `${state.selectedId}:${path}`;
        ui.editing[key] = { active: true, value: state.artifactCache.get(key) || "" };
        renderDetail();
        break;
      }
      case "cancel-edit": {
        delete ui.editing[`${state.selectedId}:${path}`];
        renderDetail();
        break;
      }
      case "save-artifact": run(() => doSaveArtifact(path)); break;
      case "approve": run(() => doApprove(stage)); break;
      case "reject-open": ui.rejectFor = stage; renderDetail(); break;
      case "reject-cancel": ui.rejectFor = null; renderDetail(); break;
      case "reject-submit": run(() => doReject(stage)); break;
      case "retry": run(() => doRetry(stage)); break;
      case "fork": run(() => doFork(stage)); break;
      case "advance-task": run(() => doAdvance()); break;
      case "open-new": openNewModal(); break;
      case "close-new": $("#new-modal").hidden = true; break;
      case "open-settings": run(() => openSettings()); break;
      case "close-settings": $("#settings-modal").hidden = true; break;
      case "skill-install": run(() => doSkillInstall()); break;
      case "skill-uninstall": run(() => doSkillUninstall()); break;
      case "doctor-recheck": run(() => runDoctorCheck()); break;
      case "doctor-open": run(() => runDoctorCheck()); break;
      case "doctor-dismiss": $("#doctor-modal").hidden = true; break;
      default: break;
    }
  });

  // 编辑中的文本 / 打回意见实时进 ui，轮询重绘后不丢字
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const editKey = t.getAttribute("data-edit-key");
    if (editKey && ui.editing[editKey]) ui.editing[editKey].value = t.value;
    const fbFor = t.getAttribute("data-feedback-for");
    if (fbFor) ui.feedback[fbFor] = t.value;
  });

  // 历史版本下拉 / 闸门覆盖下拉切换
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const histFor = t.getAttribute("data-history-select");
    if (histFor) {
      ui.histSel[histFor] = Number(t.value);
      void expandOutputs();
      return;
    }
    const gateFor = t.getAttribute("data-gate-select");
    if (gateFor) {
      t.disabled = true;
      api(`/api/tasks/${enc(state.selectedId)}/gates`, { method: "PUT", json: { stage: gateFor, gate: t.value } })
        .then(() => toast(`已更新 ${gateFor} 闸门：${GATE_LABELS[t.value] || t.value}`, "info"))
        .catch((err) => { toast(err.message); void refresh(); }) // 失败回弹到生效值
        .finally(() => { t.disabled = false; void refresh(); });
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $("#new-modal").hidden = true; $("#settings-modal").hidden = true; $("#doctor-modal").hidden = true; }
  });

  $("#new-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  $("#settings-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  $("#doctor-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  $("#new-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void submitNewTask(e.target);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void tick();
  });
}

/* ---------- 新建任务 ---------- */
function openNewModal() {
  const sel = $("#new-form select[name=pipeline]");
  sel.innerHTML = state.pipelines.length
    ? state.pipelines.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}（${esc(p.id)}）</option>`).join("")
    : `<option value="" disabled>（无可用 pipeline）</option>`;
  $("#new-modal").hidden = false;
  $("#new-form input[name=title]").focus();
}

async function submitNewTask(form) {
  const fd = new FormData(form);
  const title = String(fd.get("title") || "").trim();
  const pipeline = String(fd.get("pipeline") || "");
  const text = String(fd.get("text") || "").trim();
  const urls = String(fd.get("urls") || "").split(/\s+/).map((u) => u.trim()).filter(Boolean);
  if (!title || !pipeline) { toast("标题与 pipeline 必填"); return; }
  try {
    const t = await api("/api/tasks", { method: "POST", json: { title, pipeline, input: { text, urls } } });
    $("#new-modal").hidden = true;
    form.reset();
    toast(`任务已创建：${t.id}`, "info");
    await loadTasks();
    await selectTask(t.id);
  } catch (e) {
    toast(`创建失败：${e.message}`);
  }
}

/* ---------- 设置：agent skill 注册 / 更新 / 卸载 ---------- */
async function openSettings() {
  $("#settings-modal").hidden = false;
  $("#settings-body").innerHTML = `<p class="muted-note">加载中…</p>`;
  const skill = await api("/api/skill");
  renderSettings(skill);
}

function renderSettings(skill) {
  const statusText = !skill.installed
    ? "未注册"
    : skill.updateAvailable
      ? `已注册 v${esc(skill.installedVersion || "?")} → 可更新到 v${esc(skill.version || "?")}`
      : `已注册 v${esc(skill.installedVersion || "?")} · 已是最新`;
  const actionBtn = !skill.installed
    ? `<button class="btn btn-primary" data-action="skill-install">注册到全局 skill</button>`
    : skill.updateAvailable
      ? `<button class="btn btn-primary" data-action="skill-install">更新</button>
         <button class="btn btn-ghost" data-action="skill-uninstall">卸载</button>`
      : `<button class="btn btn-ghost" data-action="skill-uninstall">卸载</button>`;
  $("#settings-body").innerHTML = `
    <p class="modal-sub">把 <span class="mono">video-studio</span> skill 注册到全局 skill 目录后，
    kimi / codex 等 agent 即可自动发现并驱动本平台生成视频。</p>
    <div class="skill-card">
      <div class="skill-row"><span class="skill-key mono">skill</span><span>${esc(skill.name)}（仓库自带 v${esc(skill.version || "?")}）</span></div>
      <div class="skill-row"><span class="skill-key mono">状态</span><span>${statusText}</span></div>
      <div class="skill-row"><span class="skill-key mono">安装位置</span><span class="mono skill-path" title="${esc(skill.destDir)}">${esc(skill.destDir)}</span></div>
      <div class="row-actions skill-actions">${actionBtn}</div>
    </div>
    <p class="modal-sub" style="margin-top:16px">环境自检：流水线依赖的外部组件（Node / kimi cli / ffprobe / chrome-headless-shell / media-hub）。</p>
    <div class="row-actions skill-actions">
      <button class="btn btn-ghost" data-action="doctor-open">运行环境自检</button>
    </div>`;
}

async function doSkillInstall() {
  const r = await api("/api/skill/install", { method: "POST", json: {} });
  renderSettings(r);
  toast(r.action === "updated" ? "skill 已更新" : "skill 已注册，agent 现在可以发现它了", "info");
}

async function doSkillUninstall() {
  const r = await api("/api/skill/uninstall", { method: "POST", json: {} });
  renderSettings(r);
  toast("skill 已卸载", "info");
}

/* ---------- 环境自检（启动闸门 + 设置页入口） ---------- */
function doctorBodyHtml(result) {
  return result.checks.map((c) => `<div class="skill-row doctor-row">
    <span class="doctor-dot ${c.ok ? "doctor-ok" : "doctor-bad"}">${c.ok ? "✓" : "✗"}</span>
    <span class="doctor-label">${esc(c.label)}</span>
    <span class="mono skill-path" title="${esc(c.detail)}">${esc(c.detail)}</span>
    ${c.ok ? "" : `<div class="doctor-hint">${esc(c.hint)}</div>`}
  </div>`).join("");
}

async function runDoctorCheck({ gate = false } = {}) {
  let result;
  try {
    result = await api("/api/doctor");
  } catch (e) {
    // 刻意的 fail-open：自检接口本身挂掉只 toast，不挡用户进主界面
    toast(`环境自检失败：${e.message}`);
    return null;
  }
  $("#doctor-body").innerHTML = doctorBodyHtml(result);
  // gate 模式（启动时）：全绿不打扰；有红灯才弹面板
  $("#doctor-modal").hidden = gate && result.ok;
  return result;
}

/* ---------- 轮询：2s 一拍；失焦暂停；仅在需要时发请求 ---------- */
let ticking = false; // 防重入：慢请求不许叠拍
async function tick() {
  if (ticking || document.hidden) return;
  const d = state.detail;
  if (!d) return;
  ticking = true;
  try {
    // 日志：仅拉取展开面板所属的阶段（即「面板展开」条件；running 阶段面板默认自动展开）
    if (ui.openStage && d.stageList.some((s) => s.id === ui.openStage)) {
      await pollLogs(d.id, ui.openStage);
    }
    // 详情：有 running 阶段才轮询（连带刷新列表进度）
    if (d.stageList.some((s) => s.status === "running")) {
      await loadDetail(d.id);
      await loadTasks();
    }
  } finally {
    ticking = false;
  }
}

/* ---------- 启动 ---------- */
async function boot() {
  bindEvents();
  renderDetail();
  try {
    state.health = await api("/api/health");
    if (state.health && state.health.mock) $("#mock-badge").hidden = false;
  } catch (e) {
    toast(`后端不可达：${e.message}`);
  }
  // 启动闸门：环境自检有红灯时先弹面板（MOCK 模式不挡，冒烟/演示无需真实依赖）
  if (!(state.health && state.health.mock)) await runDoctorCheck({ gate: true });
  try {
    state.pipelines = await api("/api/pipelines");
  } catch (e) {
    toast(`加载 pipeline 失败：${e.message}`);
  }
  await loadTasks();
  setInterval(tick, 2000);
}

void boot();
