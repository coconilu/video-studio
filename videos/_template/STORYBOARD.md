---
format: 1920x1080
duration: 60s
message: "与 BRIEF.md 的 message 保持一致"
arc: concept-explainer
audience: 中文开发者（B站）
mode: autonomous
music: none
---

## Video direction

- **palette system**（来自 frame.md · code-editorial）：暖米白 cream 为底，ink 为正文声音，coral 是唯一「电压」——每帧至多一处 coral；暖 navy 只给代码/终端 surface。display 用 Noto Serif SC、body 用 Noto Sans SC、code/kicker 用等宽。技术术语保持英文等宽。
- **motion grammar**：进入动作用长尾缓动（power3 式，不弹跳）；**VO 节拍揭示**是铁律——画面元素只在配音念到它的那一拍出现，绝不前置倾倒；hold 阶段只允许极轻微的存活感（微浮动）。
- **rhythm / held frames**：F1 hook 快节奏；机制段每拍一个揭示；结尾帧长 hold（最后 40% 几乎静止，只有光标闪烁）。
- **negative list**：禁止 slideshow（前置倾倒后冻结）与 screensaver（万物各自漂浮）；禁止紫蓝「AI 感」渐变、泛光 bokeh；禁止真实品牌 logo；禁止浏览器界面元素入镜；每帧 coral 不超过一处。

<!--
  每帧一节，字段说明：
  - scene        一句话描述画面发生了什么
  - voiceover    与 SCRIPT.md 对应行逐字一致（TTS 实际读的文本）
  - duration     先填估值；配音完成后由 audio.mjs sync-durations 改写为实测值
  - transition_in  cut / crossfade / push-slide LEFT|RIGHT|UP|DOWN（可加时长，如 "crossfade 0.6"）
  - status       outline → animated（帧 HTML 构建完成后改 animated）
  - src          compositions/frames/NN-<slug>.html
  - type         hook / product_intro / feature_showcase / social_proof / benefit_highlight / cta
  - persuasion   说服手法（Counterintuitive claim / Demonstration / Rule of three …）
  - beat         这一拍观众应感受到什么
  - blueprint    动画蓝图（kinetic-type-beats / grid-card-assemble / panel-edit-live-sync / prompt-type-submit-generate …）
  - focal        画面唯一视觉焦点
  - roles        foreground subject / supporting / background 各是什么
  Scene N (a–b s)：帧内时间轴，窗口必须对齐配音短语（先凭 durations，渲染前按 audio_meta.json 的 words[] 实测窗口精修）。
-->

## Frame 1 — Hook：一句话标题

- scene: 画面描述
- voiceover: "与 SCRIPT.md Line 1 逐字一致。"
- duration: 7.0s
- transition_in: cut
- status: outline
- src: compositions/frames/01-hook.html
- type: hook
- persuasion: Counterintuitive claim
- beat: surprise + intrigue
- blueprint: kinetic-type-beats
- focal: 主视觉元素
- roles: 主语 = foreground subject · 辅助 = supporting · 底纹 = background

Scene 1 (0.0–2.0s): 描述这个窗口里什么入场、什么动。
Scene 2 (2.0–4.5s): …
Scene 3 (4.5–7.0s): …落定后静 hold 到结尾。

## Frame 2 — 机制：一句话标题

- scene: 画面描述
- voiceover: "与 SCRIPT.md Line 2 逐字一致。"
- duration: 9.0s
- transition_in: crossfade
- status: outline
- src: compositions/frames/02-mechanism.html
- type: feature_showcase
- persuasion: Progressive disclosure
- beat: comprehension
- blueprint: grid-card-assemble
- focal: 主视觉元素
- roles: …

Scene 1 (0.0–2.0s): …
Scene 2 (2.0–6.0s): …
Scene 3 (6.0–9.0s): …

## Frame 3 — 证据：一句话标题

- scene: 画面描述
- voiceover: "与 SCRIPT.md Line 3 逐字一致。"
- duration: 11.0s
- transition_in: crossfade
- status: outline
- src: compositions/frames/03-proof.html
- type: social_proof
- persuasion: Worked example
- beat: mastery
- blueprint: prompt-type-submit-generate
- focal: 代码窗 / 配置窗
- roles: …

Scene 1 (0.0–1.5s): …
Scene 2 (1.5–8.0s): …
Scene 3 (8.0–11.0s): …

## Frame 4 — 意义：一句话标题

- scene: 画面描述
- voiceover: "与 SCRIPT.md Line 4 逐字一致。"
- duration: 10.0s
- transition_in: cut
- status: outline
- src: compositions/frames/04-payoff.html
- type: benefit_highlight
- persuasion: Rule of three
- beat: conviction
- blueprint: kinetic-type-beats
- focal: …
- roles: …

Scene 1 (0.0–1.5s): …
Scene 2 (1.5–8.5s): …
Scene 3 (8.5–10.0s): …

## Frame 5 — CTA：一句话标题

- scene: 画面描述
- voiceover: "与 SCRIPT.md Line 5 逐字一致。"
- duration: 9.0s
- transition_in: crossfade
- status: outline
- src: compositions/frames/05-cta.html
- type: cta
- persuasion: Callback
- beat: resolve + invitation
- blueprint: prompt-type-submit-generate
- focal: 终端 pill / 入口卡
- roles: …

Scene 1 (0.0–2.0s): …
Scene 2 (2.0–5.0s): …
Scene 3 (5.0–9.0s): 全静 hold，只有光标闪烁。
