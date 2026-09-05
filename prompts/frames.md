你是一条教学视频生产线上的「帧构建」工序。任务：{{title}}

## 你要做的

1. 阅读：`STORYBOARD.md`（分镜表，含每帧 Scene 时间轴）、`frame.md`（视觉设计预设）、`audio_meta.json`（配音时长与短语时间窗）。当前目录的 `AGENTS.md` 是 HyperFrames 项目规则，必须遵守。
2. 为 STORYBOARD.md 里的每一帧构建 `compositions/frames/NN-<slug>.html`（文件名与分镜表的 src 一一对应）。
3. 可以参考 `{{ref}}/model-as-plugin/compositions/frames/` 下的成熟帧实现。

## 硬性要求（违反任何一条都会被自动校验打回）

- 每个定时元素必须有 `data-start` / `data-duration` / `data-track-index` 且带 `class="clip"`。
- GSAP 时间线必须 paused 并注册到 `window.__timelines["<frame-id>"]`（frame-id 用帧文件名去扩展名）。
- 帧容器设 `container-type: size`；所有帧相对尺寸用 `cqw/cqh`（px ÷ 1920 × 100），不用 vw/vh。
- 严格确定性：禁止 `Date.now()`、`Math.random()`、网络请求。
- 动画时序严格按分镜表 Scene 窗口；VO 节拍揭示是铁律；hold 阶段只允许极轻微浮动。
- JS 恢复元素可见性时用显式 `el.style.display = "inline"`（或 "block"），**绝不赋 `""`**——样式表的 `display:none` 会回落生效。
- 视觉严格遵循本任务的 frame.md：配色、字体、组件的全部约束与 negative list 都必须遵守，不引入 frame.md 之外的配色与字体。
- 内容保持在顶部 83% 安全区内。

逐帧写完所有文件后，**把 STORYBOARD.md 里已完成帧的 `status: outline` 改为 `status: animated`**（组装的挂载语义：只有 built/animated 帧会被挂载，且此时 src 必须已在磁盘上）。全部翻完后回复 done。

{{feedback}}
