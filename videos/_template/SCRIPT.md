# SCRIPT — your-video-slug

**Voice:** qwen3-tts-flash / Elias（知识讲解女声，media-hub 引擎）
**Voice settings:** 默认
**Voice direction:** 专业、利落、自信的技术讲解，语速中等偏快。

写作规范：

- 一行 = 一帧 = 一个信息点；60–90s 的视频 6–8 行。
- 每行 25–45 个汉字（约 6–12s 配音）；长句拆短，枚举不超过三项。
- 避免多音字歧义；无法避开时在 TTS 输入里用同音字替代（见 README「多音字」）。
- 术语保持英文原词，TTS 能直接读的不改写。

---

## Line 1 — Hook (Frame 1)

**Time:** 0.0 – 7.0s
**Delivery:** 开场冲突/反直觉断言，语速与停顿提示写在这里。

    在这里写口播原文。这个缩进块是唯一进入 TTS 的文本。

## Line 2 — 机制 (Frame 2)

**Time:** 7.0 – 18.0s
**Delivery:** 讲解语气提示。

    口播原文。

## Line 3 — 证据 (Frame 3)

**Time:** 18.0 – 30.0s
**Delivery:** 语气提示。

    口播原文。

## Line 4 — 意义 (Frame 4)

**Time:** 30.0 – 40.0s
**Delivery:** 语气提示。

    口播原文。

## Line 5 — CTA (Frame 5)

**Time:** 40.0 – 50.0s
**Delivery:** 收束，友好。

    口播原文。
