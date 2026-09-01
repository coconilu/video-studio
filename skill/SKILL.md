---
name: video-studio
description: 操作本地 Video Studio 教学视频生产平台生成教学视频——通过它的 HTTP API 建任务、推进流水线（ingest → brief → script → tts → storyboard → frames → assemble → render → final）、处理人工闸门（批准/打回/选方案）、或用全自动模式一键跑完。当用户说"用 video-studio 做一条视频""生成教学/科普视频""驱动视频生产线"时使用。前提是平台服务已在本地启动（video-studio 仓库下 npm start，默认 http://127.0.0.1:4173）。
metadata:
  version: 0.2.0
---

# Video Studio · Agent 驱动指南

Video Studio 是本地单用户的教学视频生产平台。全部能力通过 HTTP API 暴露（仅 loopback、无鉴权），agent 用 `curl` 即可驱动完整生产流程。

## 前置检查

```bash
curl -s http://127.0.0.1:4173/api/health
# {"ok":true,"mock":false} —— ok:true 即服务在线；mock:true 表示冒烟模式（不耗模型/TTS 配额）
```

服务没起来时，先在 video-studio 仓库目录后台启动：`npm start`（Windows 上用后台方式，不要弹新窗口）。端口可用 `STUDIO_PORT` 覆盖；下文以默认 4173 为例。

## 核心概念（驱动前必读）

- **任务** = 一条视频的生产实例，9 个阶段按序推进：`ingest → brief → script → tts → storyboard → frames → assemble → render → final`。
- **闸门（gate）三态**：
  - `auto`：阶段完成即过，继续推进；
  - `required`：完成后停在 `draft`，等人工/agent 批准（默认：brief、script、storyboard、final）；
  - `confirm`：启动前停在 `confirm` 等确认（默认：tts、frames、render——长耗时/耗配额）。
- **多方案候选**：`brief` 一次产出 3 个方案，批准时必须带 `choice` 选一个。
- **阶段状态**：`pending / running / draft / confirm / approved / stale / failed`。`stale` = 上游变更导致失效，重新 `advance` 会按依赖序重跑。

## 标准驱动流程

### 1. 创建任务

```bash
curl -s -X POST http://127.0.0.1:4173/api/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"我的视频主题","pipeline":"concept-explainer","input":{"text":"想法、要点、素材笔记…","urls":["https://参考链接"]}}'
```

返回 201 + 任务对象，`id` 字段后续都要用（可能含中文，**拼 URL 时必须 URL 编码**，如 `encodeURIComponent`）。创建后流水线自动推进到第一个闸门。

可用流水线列表：`GET /api/pipelines`。

### 2. 轮询状态

```bash
curl -s http://127.0.0.1:4173/api/tasks/<id>
```

返回的 `stageList` 里每个阶段带 `status / attempt / gate / error / chosen / candidateDirs`。找第一个 `status` 不是 `approved` 的阶段，按下表处理：

| 阶段状态 | 含义 | 动作 |
|---|---|---|
| `running` / `pending` / `stale` | 正在跑或排队 | 等 2-5 秒后再轮询 |
| `draft` | 停在批准闸门 | 审阅制品后 approve 或 reject（见下） |
| `confirm` | 停在启动确认 | `POST …/stages/<stage>/approve`（空 body 即可）确认启动 |
| `failed` | 阶段失败 | 读日志定位（见「错误处理」），然后 reject 重跑 |
| 全部 `approved` | — | **完成**，成品在 `renders/video.mp4` |

### 3. 闸门操作

批准（draft / confirm 都用这个）：

```bash
curl -s -X POST http://127.0.0.1:4173/api/tasks/<id>/stages/<stage>/approve \
  -H 'content-type: application/json' -d '{}'
```

**brief 等多方案阶段必须带 choice**（1..N，N 见 `stageList[].candidates`；各方案内容用 `GET …/artifact?path=candidates/brief/<i>/BRIEF.md` 读取对比）：

```bash
curl -s -X POST http://127.0.0.1:4173/api/tasks/<id>/stages/brief/approve \
  -H 'content-type: application/json' -d '{"choice":1}'
```

打回重做（可带意见，意见会注入重跑的 prompt）：

```bash
curl -s -X POST http://127.0.0.1:4173/api/tasks/<id>/stages/<stage>/reject \
  -H 'content-type: application/json' -d '{"feedback":"节奏太拖，压到 90 秒以内"}'
```

批准/打回后流水线自动继续推进，回到第 2 步轮询。

### 4. 审阅制品

```bash
# 读文本制品（BRIEF.md / SCRIPT.md / STORYBOARD.md / audio_meta.json …）
curl -s "http://127.0.0.1:4173/api/tasks/<id>/artifact?path=BRIEF.md"

# 下载二进制/大文件（音频、视频、帧 HTML），返回文件流
curl -s "http://127.0.0.1:4173/api/tasks/<id>/file?path=renders/video.mp4" -o video.mp4

# 直接改制品（改完所属阶段回 draft、下游自动失效，需重新批准）
curl -s -X PUT "http://127.0.0.1:4173/api/tasks/<id>/file?path=BRIEF.md" \
  -H 'content-type: text/plain; charset=utf-8' --data-binary @BRIEF.md

# 阶段运行日志（失败排查首选）
curl -s "http://127.0.0.1:4173/api/tasks/<id>/logs?stage=frames&tail=200"

# 打回前的历史版本
curl -s "http://127.0.0.1:4173/api/tasks/<id>/history?stage=script"
```

## 全自动模式（推荐 agent 默认使用）

建任务时加 `"gates":"auto"`，把**所有阶段**的闸门一次性改为 auto——整条流水线无人值守跑到 final approved：

```bash
curl -s -X POST http://127.0.0.1:4173/api/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"主题","pipeline":"concept-explainer","gates":"auto","input":{"text":"…"}}'
```

两个注意点：

- brief 多方案阶段在 auto 闸门下**自动采用方案 1**（`chosen:1`）。想人工选方向就别用全自动，或建任务后单独把 brief 闸门改回来：`PUT /api/tasks/<id>/gates` body `{"stage":"brief","gate":"required"}`。
- auto 不等于免审阅：建议跑完后仍读一遍 SCRIPT.md / STORYBOARD.md 和最终视频，不满意就对具体阶段 reject 带 feedback 重跑（下游会自动失效级联）。

也可以只覆盖个别阶段：`"gates":{"tts":"auto","frames":"auto"}`。

## 错误处理

- 阶段 `failed`：`GET …/logs?stage=<stage>` 看日志尾部 → 修复诱因（材料问题就改制品，偶发失败直接重跑）→ `POST …/stages/<stage>/reject`（feedback 可空）触发重跑。
- TTS 偶发失败（media-hub 配额/抖动）：直接 reject 重跑即可。
- API 返回 400 = 请求参数问题（错误体有 `error` 说明）；500 = 平台内部错误，把 `error` 信息报告给用户。
- 轮询超时（如 frames 阶段真实跑要 20-60 分钟）：耐心等，不要重复 approve/reject。

## 其他能力

- **fork**：`POST /api/tasks/<id>/fork` body `{"stage":"<stage>"}` —— 复制该阶段及之前的制品生成新任务，用于"同一材料出另一版"。
- **任务列表**：`GET /api/tasks`（含每个任务的进度摘要）。

## 冒烟验证（不耗配额）

想先验证自己会用这套 API，可以让用户在 video-studio 仓库跑 `npm run smoke`（STUDIO_MOCK=1，走通全链路断言），或以 `STUDIO_MOCK=1 npm start` 启动后亲自驱动一遍——mock 模式下所有阶段秒级完成。
