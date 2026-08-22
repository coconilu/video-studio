# 教学视频模板（_template）

从文字主题到 1080p MP4 的完整生产线。用法：**复制整个目录、改名、按顺序填三个源头文件，然后跑管线**。整体流程图见 [../video-pipeline.svg](../video-pipeline.svg)。

```bash
cd dsh-learning-guide/videos
cp -r _template my-video-slug
cd my-video-slug
# 改 package.json / meta.json 里的 your-video-slug 为本目录名
```

## 目录结构：源头文件 vs 生成物

手写（源头，改动只动这些）：

- `BRIEF.md` — 意图与约束（一句话 message、受众、时长、风格预设）
- `SCRIPT.md` — 口播稿；每个缩进块是唯一进入 TTS 的文本
- `STORYBOARD.md` — 分镜表：每帧的 voiceover / duration / transition_in / Scene 时间轴
- `frame.md` — 设计预设（code-editorial，逐字复用，一般不改）
- `compositions/frames/NN-*.html` — 每帧一个 HyperFrames 子合成

生成（管线产物，不要手改；改源头后重跑对应步骤）：

- `audio/line-NN.wav` ← TTS 合成
- `audio_meta.json` ← 配音实测时长 + 字幕时间窗
- `caption_groups.json`、`compositions/captions.html` ← `captions.mjs build`
- `index.html` ← `assemble-index.mjs`（组装根时间线）
- 转场轨道 ← `transitions.mjs inject`（注入 index.html）
- `renders/video.mp4` ← `npm run render`

## 管线：从骨架到成片的 10 步

以下命令都在项目目录下、Git Bash 里执行。先设两个环境变量：

```bash
SCRIPTS=/c/Users/admin/.agents/skills/faceless-explainer/scripts
FFMPEG=/c/ProgramData/chocolatey/bin
```

1. **填 BRIEF.md** — 一句话 message 是全片的锚，后面所有决策向它对齐。
2. **写 SCRIPT.md** — 一行 = 一帧 = 一个信息点；60–90s 片子 6–8 行，每行 25–45 字。写作规范见 SCRIPT.md 头部注释。
3. **搭 STORYBOARD.md 骨架** — 每帧一节，字段照模板填；duration 先填估值（第 6 步会被实测值覆盖）。
4. **TTS 配音** — 对每行调用 MCP 工具 `synthesize_speech`（model `qwen3-tts-flash`，默认音色 `Elias`；备选 `Neil` 新闻男声、`Eldric Sage` 沉稳老者）。产物 WAV 在
   `C:\Users\admin\AppData\Local\com.bayeswang.token-plan-media-hub\artifacts\<年>\<月>\<job_id>\<artifact_id>\output.wav`，复制为 `audio/line-NN.wav`。
5. **构建 audio_meta.json** — 格式：

   ```json
   { "bgm": null, "bgm_pending": false, "sfx": [],
     "voices": [{ "frame": 1, "path": "audio/line-01.wav", "duration_s": 7.28,
       "words": [{ "id": 0, "text": "字幕短语", "start": 0.0, "end": 2.98 }] }] }
   ```

   `duration_s` **必须用 ffprobe 实测**（media-hub 的 WAV 头尺寸字段是假的，不能信）：

   ```bash
   "$FFMPEG/ffprobe" -v error -show_entries format=duration -of csv=p=0 audio/line-01.wav
   ```

   `words[]` 把每行切成 3–6 个字幕短语，`text` 是**显示文本**，`start/end` 是该短语在配音里的实际时间窗（听音频或按语速比例估算后抽听校正）。
6. **同步帧时长** — `node $SCRIPTS/audio.mjs sync-durations`，把 STORYBOARD.md 里每帧 duration 改写为「配音实长 + 0.8s 尾部 hold」。
7. **精修 Scene 时间轴** — 按 audio_meta.json 的 words[] 窗口，把每帧 Scene N 的起止对齐到「配音念到它的那一拍」。
8. **构建帧 HTML** — 每帧一个 `compositions/frames/NN-*.html`。铁律：每个定时元素有 `data-start` / `data-duration` / `data-track-index` 且带 `class="clip"`；GSAP 时间线 paused 并注册到 `window.__timelines["<frame-id>"]`；帧容器设 `container-type: size`，尺寸用 `cqw/cqh`（`px ÷ 1920 × 100`）；**确定性**——无 `Date.now()` / `Math.random()` / 网络请求。写完把 STORYBOARD 对应帧 `status` 改为 `animated`。
9. **字幕 → 组装 → 转场 → 检查**（四连）：

   ```bash
   node $SCRIPTS/captions.mjs build        # → caption_groups.json + compositions/captions.html
   node $SCRIPTS/assemble-index.mjs        # → index.html（根时间线）
   node $SCRIPTS/transitions.mjs inject    # 按 transition_in 注入转场轨道
   node $SCRIPTS/transitions.mjs verify    # 校验转场跨轨、无同轨重叠
   npm run check                           # lint + runtime + layout + motion + contrast
   ```

   `check` 必须 0 error；warning 逐条过目。
10. **渲染 + 目检**：

    ```bash
    export HYPERFRAMES_BROWSER_PATH="$HOME/.cache/puppeteer/chrome-headless-shell/win64-150.0.7871.24/chrome-headless-shell-win64/chrome-headless-shell.exe"
    npm run render                        # → renders/video.mp4
    ```

    交付前抽帧目检（每个场景转换点至少一帧）：

    ```bash
    "$FFMPEG/ffmpeg" -y -ss 46.5 -i renders/video.mp4 -frames:v 1 .verify/check.png
    ```

## 环境硬事实（踩过的坑，别再踩）

- **HYPERFRAMES_BROWSER_PATH 必须设置**。hyperframes 自带的 152 版 chrome-headless-shell 二进制损坏（exit 3221225595 / 0xC000007B）；Puppeteer 缓存里的 150 版完好，路径见第 10 步。升级 chrome-headless-shell 后先小渲染验证再删此变量。
- **所有重命令后台静默跑**：渲染 / check / 安装一律 `run_in_background=true`，绝不在前台弹 PowerShell 窗口；渲染日志保留完整输出（不要 `| tail` 截断）。
- **多音字**：TTS 输入用同音字替代（「一行代码」→「一航代码」），audio_meta.json 的 `words[].text` 保持正确字形——字幕显示与配音发音由此解耦。
- **换音色/重配后时间码会漂移**：重跑第 5–7 步（测时长 → sync-durations → 按新 words[] 窗口重对齐受影响帧的 Scene 与帧内时间线），不要只替换音频文件。
- **CSS 层叠坑**：帧内 JS 恢复元素可见性时用显式 `el.style.display = "inline"`（或 `"block"`），**不要赋 `""`**——样式表里的 `display:none` 会回落生效，元素永远不显示（pilot 05 帧实踩）。
- **帧时长不够时**用 `transitions.mjs` 自带的 pad 机制（`lib/pad-frame-duration.mjs`），不要手改 index.html。

## 质量门槛（交付前逐项过）

- `npm run check` 零 error。
- 成片抽帧目检：hook 拍点、每帧揭示点、转场中点、结尾 hold。
- 字幕与配音逐句对听一遍（多音字、术语读音）。
- 帧内容顶部 83% 安全区内，coral 每帧至多一处（对照 frame.md 的 Pre-Render Self-Audit）。

## 复用资产

- `frame.md` — code-editorial 设计预设（色板 / 字阶 / 组件 / 六种帧型），与课程网站同源。
- 音色：`Elias`（默认）。整条线保持同一音色，系列感来自一致性。
- 参考实现：`../model-as-plugin/`（pilot 成片，遇到不熟悉的模式先去那里抄）。
