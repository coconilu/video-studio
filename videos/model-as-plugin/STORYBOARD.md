---
format: 1920x1080
duration: 60s
message: "在 DeepSeek Harness 里，模型只是一个可替换的插件"
arc: concept-explainer
audience: 中文开发者（B站）
mode: autonomous
music: none
---

## Video direction

- **palette system**（来自 frame.md · code-editorial）：暖米白 cream 为底，ink 为正文声音，coral 是唯一「电压」——每帧至多一处 coral（关键词下划线、一个 ✱、或一条状态翻转）；暖 navy 只给代码/终端 surface。中文排版按预设的 CJK 规则：display 用 Noto Serif SC、body 用 Noto Sans SC、code/kicker 用等宽（Noto Sans Mono CJK / JetBrains Mono）。技术术语（plugin / provider / ctx.llm / cordis.yml）保持英文等宽。
- **motion grammar**：所有进入动作用长尾缓动（power3 式平滑，不弹跳过度）；**VO 节拍揭示**是铁律——画面元素只在配音念到它的那一拍出现，绝不前置倾倒；hold 阶段只允许极轻微的存活感（微浮动），禁止懒惰呼吸。
- **rhythm / held frames**：F1 hook 快节奏字拍；F2–F5 机制段每拍一个揭示；F6 三句接力每句 hold ~1.5s；F7 结尾终端卡长 hold（最后 40% 几乎静止，只有光标闪烁）。
- **negative list**：禁止 slideshow（前置倾倒后冻结）与 screensaver（万物各自漂浮）；禁止紫蓝「AI 感」渐变、泛光 bokeh；禁止真实品牌 logo；禁止浏览器/chrome 界面元素入镜；每帧 coral 不超过一处。

## Frame 1 — Hook：模型不是中心

- scene: 大字排印逐拍打出三个模型名，随后一行声明把它们全部压下去
- voiceover: "GPT、Kimi、Claude——在这套框架里，它们都不是核心，只是插件。"
- duration: 7.28s
- transition_in: cut
- status: animated
- src: compositions/frames/01-hook.html
- type: hook
- persuasion: Counterintuitive claim
- beat: surprise + intrigue
- blueprint: kinetic-type-beats (Reproduce · Hook escalation 子形)
- focal: 三个模型名与声明句（大字排印）
- roles: 模型名 = foreground subject · 声明句 = foreground payoff · 淡网格底纹 = background（dim ~35%）

Adapt: 保留「逐拍 escalate + 收束」签名；内容是纯文字，无 logo 收束，改为声明句压场后 hold。
Scene 1 (0.0–2.0s): cream 底 + 极淡发丝网格；「GPT」「Kimi」「Claude」三个等宽大字逐拍 spring-pop 落于中轴，各占一拍，coral ✱ 随第一拍出现一次。
Scene 2 (2.0–3.9s): 三个名字缩小并下沉成一排小标签（VO：「在这套框架里」），视线被引向中心。
Scene 3 (3.9–6.8s): 声明句「它们都不是核心，只是插件」以 serif display 逐词 reveal 占据中心（VO 正念到），落定后静止 hold 到结尾。Centered，hero 文字占 ~50% 画面；内容在顶部 83% 内。

## Frame 2 — 命名：一切皆插件

- scene: 插件树逐层组装——从 Cordis 微内核出发，工具、会话、loop、模型适配器逐一挂为叶子
- voiceover: "DeepSeek Harness，一切皆插件：工具、会话、loop 是插件——模型适配器，也只是树上一片叶子。"
- duration: 9.36s
- transition_in: crossfade
- status: animated
- src: compositions/frames/02-plugin-tree.html
- type: product_intro
- persuasion: Concretization（插件树）
- beat: clarity + orientation
- blueprint: grid-card-assemble (Adapt · 树形组装)
- focal: 正在生长的插件树（中心 Cordis 核 + 叶片卡片）
- roles: 插件树 = foreground subject · 叶片标签 = supporting · 底纹 = background

Adapt: 保留「逐项 stagger 组装入位 + 落定 hold」签名；网格改为树：中心核在左，叶片向右上/右下展开。
Scene 1 (0.0–1.8s): 「DeepSeek Harness」serif 标题居上落定；下方一枚深色「Cordis 微内核」节点弹入（VO 报名字）。
Scene 2 (1.8–6.4s):  VO 念到「工具、会话、loop」时三张叶片卡片逐张 stagger 弹入并连线到核；每片标一行 mono 小字（tools / session / agent-loop）。
Scene 3 (6.4–8.6s):  VO 念「模型适配器」——第四片叶子以同一节奏入场但带 coral 描边（本帧唯一 coral），标注 llm-adapter。
Scene 4 (8.6–9.76s):  整树轻微收拢定位，静 hold；树占画面 ~55%。Asymmetric 60/40：左核右叶。

## Frame 3 — 机制：能力缝隙三角色

- scene: 三张角色卡自组装成一行——Service Definition / Service Provider / Consumer，标注 llm 缝隙实例
- voiceover: "模型从一条「能力缝隙」接入：Definition 声明接口，Provider 实现它，Consumer 只认接口。"
- duration: 10.56s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-seam.html
- type: feature_showcase
- persuasion: Progressive disclosure + Frame-then-fill
- beat: comprehension
- blueprint: grid-card-assemble (Reproduce · 三卡 cascade)
- focal: 三角色卡 + 之间的接口连线
- roles: 角色卡 = foreground subject · 连线/箭头 = supporting · 「能力缝隙 capability seam」kicker = chrome

Scene 1 (0.0–1.6s): coral ✱ kicker「能力缝隙 · capability seam」落定（本帧 coral 用在此处）。
Scene 2 (1.6–4.6s):  VO 点名顺序，左→右逐张弹入「Service Definition（声明接口）」→「Service Provider（实现）」，两卡之间画出接口连线。
Scene 3 (4.6–7.2s):  第三张「Consumer（只认接口）」入场；从 Consumer 到 Definition 画一条虚线箭头标注 inject。
Scene 4 (7.2–8.72s):  三卡落定静 hold，连线微光存活。Triptych 横排，卡组占 ~55% 画面。

## Frame 4 — 机制兑现：换模型 = 换插件

- scene: 同一消费者下方，DeepSeek 适配器卡片滑出、另一 provider 卡片滑入，接口连线不断
- voiceover: "换掉模型，只是换掉 Provider 这片插件——接口不动，消费者一行代码不改。"
- duration: 9.12s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-swap.html
- type: feature_showcase
- persuasion: Before/after + Demonstration
- beat: aha + confidence
- blueprint: panel-edit-live-sync (Adapt · 配置↔图联动替换)
- focal: provider 卡片的滑出/滑入替换
- roles: Consumer 卡（上）= supporting · provider 槽位（下）= foreground subject · 接口连线 = supporting

Adapt: 保留「一处改动、另一处同步响应」的 live-sync 签名；舞台为上下两层：上方 Consumer 卡（agent-loop），下方 provider 槽位。
Scene 1 (0.0–1.5s): 舞台建立：上方 Consumer「agent-loop」，下方槽位里是「llm-deepseek」卡，接口连线接通。
Scene 2 (1.5–4.2s):  VO 念「换掉模型」——llm-deepseek 卡向左滑出，一张标注「OpenAI 兼容 provider」的新卡同时从右滑入（同一节拍、同一槽位），连线保持不断。
Scene 3 (4.2–6.0s):  VO 念「接口不动，消费者一行代码不改」——Consumer 卡上打出珊瑚色 ✓（本帧唯一 coral），连线轻微脉冲一次。
Scene 4 (6.0–7.52s):  静 hold。Split 上下两层，槽位区占 ~50%。

## Frame 5 — 证据：一行配置接兼容端点

- scene: 暖黑代码窗里逐行打出 cordis.yml patch：baseURL 指向 OpenAI 兼容端点，底部状态条翻转成功
- voiceover: "想接任何 OpenAI 兼容端点？一段 patch：改个 baseURL，挂上你的凭据，完成。"
- duration: 11.44s
- transition_in: crossfade
- status: animated
- src: compositions/frames/05-config.html
- type: social_proof
- persuasion: Worked example（真实配置）
- beat: mastery
- blueprint: prompt-type-submit-generate (Adapt · 终端/code 打字 + 状态收束)
- focal: cordis.yml patch 代码窗
- roles: 代码窗（warm navy surface）= foreground subject · 文件名 chrome = supporting · 底部状态条 = payoff

Adapt: 保留「逐键打入 + 机器应声收束」签名；不是 prompt 而是配置打字，收束为状态翻转。
Scene 1 (0.0–1.4s): 暖 navy 代码窗弹入，标题条 mono 文件名「cordis.patch.yml」（VO 设问句）。
Scene 2 (1.4–7.4s):  逐行打出 patch：`- id: llm-adapter` → `config:` → `baseURL: "https://你的兼容端点/v1"`（VO 念「改个 baseURL」时该行高亮）→ `apiKey: !!js ctx.credentials.get('MY_KEY')`（念「凭据」时高亮）。
Scene 3 (7.4–9.6s):  底部状态条翻转「✓ provider 已切换」（唯一 coral 用在 ✓），静 hold。代码窗居中占 ~62% 宽，顶部 83% 内。

## Frame 6 — 意义：不被锁定

- scene: 三条短句接力——不被厂商锁定 / 多模型按场景切换 / 新模型写个 adapter 就接进来
- voiceover: "这意味着：不被任何厂商锁定，多模型随场景切换，下一个新模型来了，写个适配器就接进来。"
- duration: 11.04s
- transition_in: cut
- status: animated
- src: compositions/frames/06-payoff.html
- type: benefit_highlight
- persuasion: Rule of three
- beat: conviction + momentum
- blueprint: kinetic-type-beats (Reproduce · Benefits statement-relay 子形)
- focal: 三条收益句（serif 大字接力）
- roles: 收益句 = foreground subject · 序号 01/02/03 mono 标记 = supporting

Scene 1 (0.0–1.3s): 「这意味着：」mono kicker 落定。
Scene 2 (1.3–4.0s):  01「不被任何厂商锁定」serif 大字入场并 hold ~1.5s。
Scene 3 (4.0–6.4s):  硬切到 02「多模型，随场景切换」，同样 hold。
Scene 4 (6.4–9.6s):  硬切到 03「新模型来了，写个 adapter 就接进来」；落定静 hold 到结尾。Centered，每句占 ~50%；无 coral（本帧珊瑚预算留给空白，保持克制）。

## Frame 7 — CTA：课程入口

- scene: 标题退位，终端 pill 弹入并打出课程命令，两张课次卡 L3 / L9 落位，长 hold
- voiceover: "想亲手做到？实战课程第三课带你接入，第九课带你造一个。评论区见。"
- duration: 9.84s
- transition_in: crossfade
- status: animated
- src: compositions/frames/07-cta.html
- type: cta
- persuasion: Callback + Distillation
- beat: resolve + invitation
- blueprint: prompt-type-submit-generate (Adapt · install-command end card)
- focal: 终端 pill + L3/L9 课次卡
- roles: 终端命令 = foreground subject · 课次卡 = supporting · 标题 = background demoted

Adapt: 保留「标题退位 + 终端 pill 打字 + 长 hold」签名；命令换成课程引导，课次卡替代 tool icon row。
Scene 1 (0.0–1.6s): 开场标题「亲手做到？」serif 落定后 demote（缩小上移变淡）。
Scene 2 (1.6–3.8s):  终端 pill 弹入拉宽，逐键打出 `pnpm dsh web`（光标闪烁）。
Scene 3 (3.8–5.6s):  两张 hairline 课次卡左右落位：「L3 · 接入任意模型」「L9 · 写一个模型适配器」；底部 mono 小字「dsh-learning-guide · 实战课程」。
Scene 4 (5.6–7.2s):  全静 hold，只有终端光标闪烁。Centered；coral 用在终端提示符。
