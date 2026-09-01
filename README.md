# Video Studio · 教学视频生产平台

本地单用户 web app：把一条教学视频的生产拆成「**阶段流水线 + 人工闸门 + fork 血缘**」。
创作阶段（材料整理、Brief、口播稿、分镜、帧构建）由本地 [kimi code cli](https://github.com/MoonshotAI/kimi-code) 完成；
确定性阶段（TTS、字幕、组装、转场、渲染）由内置管线脚本完成。画面基于 [HyperFrames](https://hyperframes.heygen.com/) 组合式 HTML 帧。

**设计与决策记录见 [DESIGN.md](DESIGN.md)**（含首航验证中修掉的 7 个平台 bug）。

## 流水线

```
ingest → brief ⛩³ → script ⛩ → tts ✋ → storyboard ⛩ → frames(+自愈) ✋ → assemble → render ✋ → final ⛩
```

- `⛩` = 人工闸门：阶段产出 draft 后停下，在网页上**批准**或**打回**（打回可附意见，带意见重做）。
- `⛩³` = 多方案闸门：brief 阶段一次产出 3 个有显著差异的方案，网页上并排预览、批准其一；未选中的留档 `candidates/` 供复盘。
- `✋` = 启动确认：长耗时/耗配额的阶段（tts、frames、render）启动前停下等人确认。每个阶段的闸门（自动 / 完成后批准 / 启动前确认）都可在网页上按任务覆盖。
- 打回重做的旧版制品归档在 `.history/<stage>/<attempt>/`，阶段面板里可直接翻看历史版本。
- 任何阶段可「**⑂ 从此 fork**」：复制该阶段及之前的制品生成新任务，血缘只增不改，UI 按任务树渲染。
- frames 阶段自带自愈循环：kimi 写完帧后自动跑 `npm run check`（HyperFrames 校验），失败把错误回喂重试（≤3 次）。

## 快速开始

```bash
npm start          # http://127.0.0.1:4173
```

在网页里「＋ 新建任务」，输入想法或参考材料（文本 / URL），流水线自动推进到第一个闸门。

## 环境前置

- Node ≥ 22
- kimi cli（`kimi -p` headless，已验证 0.37.2）——模型 Runner
- media-hub MCP 服务端（TTS；路径见 `config.mjs` 的 `MEDIA_HUB_EXE`）
- `ffprobe`（在 PATH 上，或用 `STUDIO_FFPROBE` 指定）
- chrome-headless-shell 150（渲染必需，`config.mjs` 的 `CHROME_HEADLESS_SHELL`；hyperframes 自带 152 在 Windows 上有已知崩溃）

所有外部路径集中在 `config.mjs`，每个都可用环境变量覆盖（`STUDIO_*` / `HYPERFRAMES_BROWSER_PATH`）。

## 数据存放

任务产物（每个任务的制品、音频、渲染结果）默认放在**用户级目录**，与代码分离——重装或 `git pull` 更新项目不会丢历史：

| 平台 | 路径 |
|------|------|
| Windows | `%LOCALAPPDATA%\video-studio\videos` |
| macOS | `~/Library/Application Support/video-studio/videos` |
| Linux | `$XDG_DATA_HOME` 或 `~/.local/share/video-studio/videos` |

用 `STUDIO_VIDEOS_DIR` 环境变量可指向任意位置（如移动硬盘、同步盘）。仓库里的 `videos/` 只放只读参考：`_template/`（新任务骨架）和 `model-as-plugin/`（示例 pilot，供 prompt 引用成熟实例）。

## 冒烟（不消耗模型/TTS 配额）

```bash
npm run smoke      # STUDIO_MOCK=1，走通状态机全链路（42 项断言，含多方案选择 / 启动确认 / 历史归档 / 编辑后重批 / skill 注册 / 全自动模式）
```

## Agent 接入（kimi / codex 驱动平台）

平台的全部能力就是 REST API（`http://127.0.0.1:4173/api/*`，仅 loopback、无鉴权），agent 用 `curl` 即可驱动完整生产流程。仓库自带 `skill/`（agent 驱动说明书），两种注册方式：

- **网页设置页**：右上角「⚙ 设置」→ 一键注册到全局 skill 目录（默认 `~/.agents/skills/video-studio/`，`STUDIO_SKILLS_DIR` 可覆盖），支持更新（内容比对检测）与卸载。
- **手动**：把 `skill/` 整个复制为 `~/.agents/skills/video-studio/`。

agent 全自动产出一条视频（所有闸门改 auto，brief 自动选方案 1）：

```bash
curl -X POST http://127.0.0.1:4173/api/tasks -H 'content-type: application/json' \
  -d '{"title":"主题","pipeline":"concept-explainer","gates":"auto","input":{"text":"想法…"}}'
# 之后轮询 GET /api/tasks/<id>，直到 stageList 全部 approved；成品在 renders/video.mp4
```

完整驱动指南（闸门语义、多方案 choice、打回重跑、错误处理）见 [skill/SKILL.md](skill/SKILL.md)。

## 仓库结构

```
server/      HTTP 服务（API + 静态 UI）
core/        引擎 / 任务存储 / 队列 / 制品校验 / spec 加载
runners/     模型 Runner（kimi-cli、mock）
tools/       确定性步骤：tts、steps（assemble/check/render）、pipeline/（vendored 管线脚本）
pipelines/   流水线 spec（JSON，声明阶段/类型/输入输出/闸门/自愈）
prompts/     各模型阶段的 prompt 模板
skill/       agent 驱动说明书（SKILL.md，可注册到全局 skill 目录，见「Agent 接入」）
web/         浏览器 UI（原生 JS，无构建步骤）
videos/      任务目录：_template/（新任务骨架）、model-as-plugin/（示例 pilot）
```

## 路线图

二期：Tauri 桌面壳（DESIGN.md D2）、codex cli Runner、真实录屏 pipeline（computer-use）、B 站自动发布（web-bridge）、BGM、9:16 竖屏。
