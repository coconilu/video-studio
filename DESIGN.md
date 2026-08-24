# 教学视频生产平台 · 技术设计

> 状态：**MVP 已首航验证（2026-08-21）**。本文档是决策记录 + 技术设计的唯一权威来源；后续范围或路线变更先改这里再动手。

## 0. 决策记录（2026-08-20 与用户对齐）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 平台形态 | **本地单用户 web app**（Node 后端 + 浏览器 UI）。2026-08-22 起独立为 `video-studio` 仓库（首航验证完成后从 deepseek-harness 抽出）。 |
| D2 | 二期桌面化 | **二期做成 Tauri 平台**。实务点：管线脚本与 CLI 调用都是 Node 生态，Tauri 的 Rust 壳需内嵌 Node sidecar（或依赖系统 node）——成熟做法，多一层部署复杂度；web app 的功能与其完全等价，届时只需补壳。 |
| D3 | MVP 范围 | 想法/材料 → brief → script → storyboard → 模型建帧（带自愈循环）→ 组装 → 渲染 → 人工验收。录屏、BGM、B站发布、9:16 竖屏进二期。 |
| D4 | 模型接入层 | 抽象 `ModelRunner` 接口；**先实现 kimi code cli**，codex cli 预留（media-hub 对两者的集成机制都已存在，见 §6）。 |
| D5 | 闸门默认 | `brief` / `storyboard` / `final` 必须人工批准，其余阶段 auto；任务级可覆盖。 |
| D6 | fork 语义 | 制品不可变 + 下游失效级联 + 血缘记录（见 §7）。 |
| D7 | 配额并发 | Runner 串行队列，并发 1 起步，可配。 |
| D8 | 制品 schema | 沿用 `videos/_template/` 的文件格式（BRIEF/SCRIPT/STORYBOARD/audio_meta），校验复用 faceless-explainer 的 parser；管线脚本已 vendor 进 `tools/pipeline/`。 |
| D9 | 闸门三态（2026-08-23） | gate 取值扩展为 `auto` / `required` / **`confirm`（启动前人工确认，完成后自动过）**。长耗时/耗配额的阶段先问再跑：`tts` / `frames` / `render` 默认 confirm。确认一次性消费——完成或打回后重跑需再次确认。任务级覆盖走 UI（`PUT /api/tasks/<id>/gates`），覆盖值同上三态。 |
| D10 | 多方案候选（2026-08-23） | model 阶段可声明 `candidates: N`：**一次作业产出 N 份变体**到 `candidates/<stage>/<i>/`（路径结构与 outputs 相同），不直接写正式制品。人工在 UI 并排预览后批准其一，服务端把选中变体复制为正式制品；未选中的留档在 `candidates/` 供复盘。选「一次产出 N 份」而非「跑 N 次」：配额只花一份，差异由 prompt 保证。首期 `brief` 启用（`candidates: 3`）。 |

## 1. 定位与形态

把 `videos/_template/` + pilot（`videos/model-as-plugin/`）验证过的生产线平台化：**阶段编排 + 制品库 + 人工闸门 + fork 血缘**，用户全程可参与、可打回、可分叉。

- 后端：Node（ESM），本地端口，前端静态托管。不引入数据库——任务索引用 `platform/data/tasks.json`。
- 前端：任务树（fork 血缘）+ 阶段时间线 + 各阶段 review 组件（markdown 编辑/预览、storyboard 表格 + 帧快照、视频播放器）。
- **自包含纪律**：平台目录自带 `package.json`，**不进 pnpm workspace**，不依赖仓库内部包——避免触发仓库 gates（knip / publint / 覆盖率门），日后整目录搬走即独立。
- 所有子进程（CLI、渲染、ffmpeg）spawn 时 `windowsHide: true`——本机纪律：绝不弹 PowerShell/conhost 窗口。

## 2. 核心概念

- **Task**：一条视频的生产实例 = `<VIDEOS_DIR>/<task-id>/` 目录 + `task.json`（元数据、阶段状态、尝试历史、闸门覆盖、血缘）。`VIDEOS_DIR` 默认是用户级目录（Windows `%LOCALAPPDATA%\video-studio\videos`、macOS `~/Library/Application Support/video-studio/videos`、Linux `$XDG_DATA_HOME/video-studio/videos`，`STUDIO_VIDEOS_DIR` 可覆盖）——产物与代码分离，重装/更新项目不丢历史（2026-08-23 变更）；仓库内 `videos/` 只放只读参考（`_template` + `model-as-plugin` 示例），prompt 里通过 `{{ref}}` 注入其绝对路径。
- **Artifact**：制品即文件，格式沿用 `_template/`。制品不可变——打回重做产生新 attempt，旧版存 `.history/<stage>/<attempt>/`，可经 API/UI 回看（`GET /api/tasks/<id>/history?stage=…`）。
- **Stage**：pipeline spec 定义的有向步骤，三类：`model`（走 Runner）、`tool`（确定性脚本）、`review`（纯人工确认）。
- **Gate**：阶段的批准点，三态：`required`（完成后人工批准）/ `auto`（完成即过）/ `confirm`（启动前人工确认，D9）。
- **Candidates**：model 阶段的多方案变体（D10、§11）。
- **Fork**：见 §7。

## 3. 模块划分

```
platform/
├── DESIGN.md            ← 本文档
├── package.json         ← 自包含，不进 workspace
├── server/              ← HTTP API + 静态托管 + 子进程管理（后台静默）
├── core/
│   ├── pipeline.ts      ← spec 加载、阶段状态机、失效级联
│   ├── tasks.ts         ← 任务 CRUD、fork、血缘
│   ├── artifacts.ts     ← 制品读写、版本、校验（复用 parser）
│   └── gates.ts         ← 闸门判定与任务级覆盖
├── runners/
│   ├── runner.ts        ← ModelRunner 接口（§5）
│   ├── kimi-cli.ts      ← 一期实现
│   └── codex-cli.ts     ← 二期占位
├── tools/               ← 确定性阶段封装：tts / captions / assemble / transitions / check / render / probe（ffprobe）
├── bridges/             ← web-bridge、computer-use、media-hub gateway 的调用封装（§6）
├── pipelines/           ← pipeline spec（JSON，§9 变更记录），首期内置 concept-explainer
├── prompts/             ← 各 model 阶段的 prompt 模板
└── web/                 ← 前端（任务树 / 阶段时间线 / review 组件）
```

## 4. 制品与 task.json

制品格式 = `videos/_template/` 的全部文件约定（见该目录 README，含 WAV 头尺寸字段造假、多音字解耦等硬事实）。

`task.json` 骨架：

```json
{
  "id": "lesson-03-video",
  "title": "第三课 · 接入任意模型",
  "pipeline": "concept-explainer",
  "createdAt": "…",
  "parent": null,
  "gates": {},
  "stages": {
    "brief": { "status": "approved", "attempt": 2 }
  }
}
```

`status` 取值：`pending` / `running` / `draft`（待人工批准）/ `confirm`（待确认启动，D9）/ `approved` / `stale`（上游变更失效）/ `failed`。`parent`：`{ "task": "<id>", "stage": "<stage-id>" }`。

## 5. Pipeline Spec 与 Runner 接口

**spec 示例**（`pipelines/concept-explainer.yaml`，阶段序与 pilot 实操一致）：

```yaml
id: concept-explainer
stages:
  - id: ingest        # 口述想法 / URL / markdown → 材料笔记
    type: model
    outputs: [materials/NOTES.md]
    gate: auto
  - id: brief
    type: model
    inputs: [materials/NOTES.md]
    outputs: [BRIEF.md]
    gate: required
    candidates: 3         # 一次产出 3 个方案，人工选其一（§11）
  - id: script
    type: model
    inputs: [BRIEF.md]
    outputs: [SCRIPT.md]
    gate: required
  - id: tts
    type: tool
    impl: tools/tts   # media-hub gateway 直连，见 §6
    inputs: [SCRIPT.md]
    outputs: [audio/, audio_meta.json]
    gate: confirm         # 耗配额，启动前确认（D9）
  - id: storyboard    # 此时已有真实配音时长，直接出精修版
    type: model
    inputs: [BRIEF.md, SCRIPT.md, audio_meta.json, frame.md]
    outputs: [STORYBOARD.md]
    gate: required
  - id: frames
    type: model
    inputs: [STORYBOARD.md, frame.md, audio_meta.json]
    outputs: [compositions/frames/*.html]
    gate: confirm         # 长耗时（实测 >20min），启动前确认
    heal: { check: "npm run check", maxAttempts: 3 }   # 自愈循环，§8
  - id: assemble
    type: tool
    impl: tools/assemble   # captions → assemble-index → transitions inject/verify
    outputs: [index.html, compositions/captions.html, caption_groups.json]
    gate: auto
  - id: render
    type: tool
    impl: tools/render     # 注入 HYPERFRAMES_BROWSER_PATH
    outputs: [renders/video.mp4]
    gate: confirm         # 长耗时，启动前确认
  - id: final
    type: review
    inputs: [renders/video.mp4]
    gate: required
```

**Runner 接口**（`runners/runner.ts`）：

```ts
interface ModelRunner {
  id: string;
  run(job: {
    workdir: string;      // 任务目录，CLI 在其中读写制品
    prompt: string;       // 渲染后的阶段 prompt（含输入制品路径与输出格式要求）
    outputs: string[];    // 期望制品相对路径——完成后校验存在且可解析
    timeoutMs: number;
    onLog?(line: string): void;
  }): Promise<{ ok: boolean; wrote: string[]; error?: string }>;
}
```

关键约定：**Runner 不让 CLI 返回结构化 JSON，而是让它直接写制品文件**——这是 CLI agent 最自然的工作方式；校验由 `core/artifacts.ts` 调现成 parser（storyboard parser 等）完成。

## 6. 外部能力接线（2026-08-20 已探明的事实）

- **media-hub（TTS）走 MCP stdio 直连**（已探针验证 2026-08-20）：服务端即 mcp.json 注册的 `C:/Users/admin/AppData/Local/Token Plan Media Hub/token-plan-media-mcp.exe`，NDJSON over stdio；`initialize` → `tools/call synthesize_speech` → 返回 `artifactIds` → `list_artifacts` 取 `localPath`（完整 WAV 路径）。产物 WAV 头尺寸字段是假的，**时长必须 ffprobe 实测**（默认取 PATH 上的 `ffprobe`，`STUDIO_FFPROBE` 可覆盖）。`agent-gateway.json` 的 loopback HTTP 是 dashboard 服务，**不是**工具镜像，不要用。
- **media-hub 自带 kimi / codex 双集成**：`%LOCALAPPDATA%\com.bayeswang.token-plan-media-hub\agent-integrations\{kimi,codex}\`（含它改写两个 CLI 配置时的备份）——D4 的「codex 预留」有现成落点。
- **kimi cli 的 MCP 配置在 `~/.kimi-code/mcp.json`**（含 `token-plan-media-hub`）；computer-use（kimi-cu）与 web-bridge 是 managed plugins（`~/.kimi-code/plugins/managed/`）。平台 spawn 的 kimi cli **继承用户级配置**，MCP 能力随之可用——`model` 阶段里可以直接让 CLI 调 media-hub / computer-use / web-bridge。
- **kimi cli headless 调用方式（已探针验证）**：`kimi -p "<prompt>"`，cwd=任务目录；**裸用 `-p`**——与 `--auto` / `-y` 均互斥（`Cannot combine`），非交互模式下工具调用自动执行。退出码 0 = 成功，stdout 为回复文本。kimi 是真实 PE 可执行文件（`~/.kimi-code/bin/kimi.exe`），Node `spawn` 可直接调。
- **web-bridge 为 HTTP 守护进程**（`http://127.0.0.1:10086/command`，POST `{action, args, session}`，动作表见插件 SKILL.md：navigate/snapshot/click/fill/evaluate/screenshot 等）。平台 Node 侧直接发 HTTP 即可，不经 shell 也就没有 Windows 非 ASCII 参数损坏问题。
- **渲染必须注入** `HYPERFRAMES_BROWSER_PATH` 指向 Puppeteer 缓存的 chrome-headless-shell 150（hyperframes 自带 152 损坏，exit 3221225595）：`$HOME/.cache/puppeteer/chrome-headless-shell/win64-150.0.7871.24/chrome-headless-shell-win64/chrome-headless-shell.exe`。
- **管线脚本**（captions/assemble-index/transitions + lib parser）已 vendor 进 `tools/pipeline/`（源自 faceless-explainer skill，`bgmDefaultVolume` 纯函数单独抽为 `lib/bgm-volume.mjs`）。

## 7. Fork 与失效级联

- **fork(stage)**：新任务目录，复制该阶段及之前的制品 + `task.json`，`parent` 记录 `{task, stage}`；下游阶段全部 `pending`。
- **编辑/打回上游**：该阶段新 attempt 批准后，所有下游阶段状态 → `stale`，需按依赖序重跑（tool 阶段自动，model 阶段排队）。
- 血缘只增不改，任务树在 UI 按 `parent` 渲染。

## 8. 自愈循环（frames 阶段）

`model` 阶段带 `heal` 配置时：Runner 完成 → 跑 `check` → 失败则把错误日志追加进 prompt 重试，至多 `maxAttempts` 次 → 仍失败则阶段置 `failed` 升级人工。pilot 中这个循环是手工做的（05 帧 CSS 层叠 bug 就是这么修掉的），平台必须自动化。

## 9. MVP 边界与待调研

**MVP 不做**（二期）：真实录屏 pipeline（computer-use + 操作演示 spec）、BGM、B站自动发布（web-bridge 登录态上传 + 标题/标签生成）、9:16 竖屏、codex Runner、Tauri 壳（D2）。

**调研结论（2026-08-20 已全部探针验证）**：

1. kimi cli headless：`kimi -p <prompt>` 裸用（与 `--auto`/`-y` 互斥），cwd=任务目录，工具调用自动执行，exit 0 + 制品落盘。✅
2. media-hub：MCP stdio 直连（非 HTTP 网关），`synthesize_speech` → `list_artifacts` → `localPath`。✅
3. web-bridge：HTTP 守护进程 `127.0.0.1:10086/command`，平台可直连。✅
4. codex cli（二期）：`codex exec` 非交互，配置 `~/.codex/config.toml`，`codex mcp` 管理 MCP。✅

**spec 格式变更**：pipeline spec 从 YAML 改为 **JSON**（`pipelines/*.json`）——零依赖，平台不引入 YAML 解析器。

## 10. 首航验证记录（2026-08-21，任务「第三课-接入任意模型」）

首航全流程驱动中修复的七个平台 bug：

1. **路由参数未 URL 解码**：CJK 任务 id（如 `第三课-接入任意模型`）经 `encodeURIComponent` 编码后请求 API，服务端未解码导致 404/500。修复：`server/index.mjs` 路由处统一 `decodeURIComponent`。
2. **TTS 字幕与口播耦合**：口播稿为避免多音字误读会用替代字（如「一行」写作「一 hang」），但字幕必须显示正字。修复：`tools/tts.mjs` 的 `parseScriptLines` 支持 `<!-- 字幕：...-->` 注释作为 `display` 文本，`words[]` 按显示文本切短语；TTS 仍读口播原文。
3. **storyboard 校验语义过严**：`validateOutputs` 原先对所有帧查 `src` 落盘，但 storyboard 阶段只产出大纲（`status: outline`），帧 HTML 由 frames 阶段生成。修复：`core/artifacts.mjs` 只对 `built`/`animated` 帧查 src 落盘（与 assemble-index 语义一致）；`prompts/storyboard.md` 填 `status: outline`；`prompts/frames.md` 要求写完帧后把 status 翻成 `animated`。
4. **heal check 缺少 index.html**：`hyperframes check` 要求组装后的 `index.html` 存在，但 frames 阶段先于 assemble，自愈循环里的 `npm run check` 永远报 "No composition found"。修复：`tools/steps.mjs` 的 `runCheck` 先跑幂等的 `assemble-index` 重建挂载再校验。
5. **frames 阶段 20 分钟超时不够**：写 8 个帧的 kimi 作业实际耗时超过默认 `RUNNER_TIMEOUT_MS`（20min），产物写完但在翻 STORYBOARD 状态前被杀。修复：`pipelines/concept-explainer.json` 的 frames 阶段显式 `timeoutMs: 3600000`（engine 本就支持 per-stage `timeoutMs` 透传）。
6. **`.cmd` 直接 spawn 抛 EINVAL**：`runRender`/`runCheck` 用 `spawn("npm.cmd", …, {shell:false})`，Node ≥18.20 起 Windows 上直接 exec `.cmd` 被拒绝。修复：`tools/steps.mjs` 的 `runCmd` 对 `.cmd` 结尾的命令自动 `shell: true`。
7. **render 输出文件名带时间戳**：hyperframes render 产出 `renders/<任务名>_<时间戳>.mp4`，与 spec 声明的 `renders/video.mp4` 不符导致校验误报 failed（实际渲染成功）。修复：`runRender` 成功后把最新 mp4 归位复制为 `renders/video.mp4`。

## 11. 多方案候选（candidates，D10）

用户的决策价值集中在「选方向」而不是「等重跑」：与其打回后全量重做，不如让 model 阶段**一次作业产出 N 份有显著差异的变体**，人工并排预览后点选其一。

- **spec**：阶段声明 `candidates: N`（N>1 才生效）。仅适合文档型输出（BRIEF/STORYBOARD 这类单文件）；目录/通配输出不做候选。
- **落盘约定**：第 `i` 个变体写入 `candidates/<stage>/<i>/`，内部路径结构与 `outputs` 相同（如 `candidates/brief/2/BRIEF.md`）。runner **不写**正式制品路径。prompt 由引擎注入 `{{candidates}}` 指令块说明这一约定。
- **校验**：每个变体独立过 `validateOutputs`（路径加前缀），任一变体失败即整体重试（复用 heal/反馈循环，错误信息指明是第几个变体）。
- **批准**：`POST …/stages/<stage>/approve` 带 `{choice: i}`，服务端把 `candidates/<stage>/<i>/` 复制为正式制品后置 `approved`，并在阶段记录里写 `chosen: i`。本 attempt 尚未选过方案时不带 choice → 报错（模板骨架可能已占位 outputs 路径，不能以制品存在为由放行）；人工编辑正式制品后重新批准可不带 choice（沿用 `chosen` 记录）。打回/重跑清空 `chosen`。
- **留档与清理**：未选中的变体保留在 `candidates/` 供复盘；打回时 `candidates/<stage>/` 随 outputs 一起归档进 `.history/`；fork 时下游阶段的 `candidates/<stage>/` 随其 outputs 一并清除。
- **mock**：`runners/mock.mjs` 按 `candidates` 数量写变体文件，冒烟覆盖「选方案批准」链路。
