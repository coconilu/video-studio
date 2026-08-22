---
workflow: faceless-explainer
flow: automation
storyboard: yes
message: "一句话核心信息——观众看完必须记住的那句话"
destination: bilibili
aspect: 1920x1080
language: zh
voice: tts-qwen-chinese
length: 75s
angle: concept
---

## Intent

这条视频回答什么问题、给谁看、看完能做什么。风格默认沿用课程站点的
code-editorial 预设（见 frame.md）：暖米白底、ink 正文、coral 只作唯一强调色。

## Assets

- 无实拍素材；视觉按 frame.md 设计令牌与 SVG 图解语言重新发明。
- （如需截屏/录屏素材，在此列出来源与路径。）

## Customizations

- 中文 TTS 配音（media-hub qwen3-tts-flash，默认音色 Elias）+ 硬字幕。
- 复用课程站点配色：canvas #F7F5F3 / ink #1C1C29 / muted #908D89。

## Notes

- 术语保留英文原词（plugin / provider / cordis.yml …），用等宽字体。
- 不出现任何真实品牌 logo；第三方产品只用文字指代。
