/**
 * Mock Runner（STUDIO_MOCK=1）：不调用任何模型/外部服务，按阶段声明写占位制品。
 * 仅用于无配额冒烟测试平台自身的状态机与 API。
 * @module runners/mock
 */
import { writeArtifact } from "../core/artifacts.mjs";

export const id = "mock";

const CANNED = {
  "materials/NOTES.md": "# 材料笔记（mock）\n\n- 主题：mock 主题\n- 受众：中文开发者\n",
  "BRIEF.md": "---\nworkflow: faceless-explainer\nflow: automation\nstoryboard: yes\nmessage: \"mock 核心信息\"\ndestination: bilibili\naspect: 1920x1080\nlanguage: zh\nvoice: tts-qwen-chinese\nlength: 30s\nangle: concept\n---\n\n## Intent\n\nmock brief。\n",
  "SCRIPT.md": "# SCRIPT — mock\n\n## Line 1 — Hook (Frame 1)\n\n**Time:** 0.0 – 5.0s\n\n    这是第一句口播。\n\n## Line 2 — 收尾 (Frame 2)\n\n**Time:** 5.0 – 10.0s\n\n    这是第二句口播。\n",
  "STORYBOARD.md": "---\nformat: 1920x1080\nduration: 10s\nmessage: \"mock 核心信息\"\n---\n\n## Frame 1 — Hook\n\n- scene: mock\n- voiceover: \"这是第一句口播。\"\n- duration: 5.0s\n- transition_in: cut\n- status: animated\n- src: compositions/frames/01-hook.html\n- type: hook\n\nScene 1 (0.0–5.0s): mock。\n\n## Frame 2 — CTA\n\n- scene: mock\n- voiceover: \"这是第二句口播。\"\n- duration: 5.0s\n- transition_in: crossfade\n- status: animated\n- src: compositions/frames/02-cta.html\n- type: cta\n\nScene 1 (0.0–5.0s): mock。\n",
  "audio_meta.json": JSON.stringify({
    bgm: null, bgm_pending: false, sfx: [],
    voices: [
      { frame: 1, path: "audio/line-01.wav", duration_s: 5.0, words: [{ id: 0, text: "这是第一句口播。", start: 0, end: 4.6 }] },
      { frame: 2, path: "audio/line-02.wav", duration_s: 5.0, words: [{ id: 0, text: "这是第二句口播。", start: 0, end: 4.6 }] },
    ],
  }, null, 2),
  "caption_groups.json": "{ \"groups\": [] }\n",
};

const FRAME_HTML = (n) => `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#FAF9F5;container-type:size}h1{font:400 6cqw serif;color:#141413;display:grid;place-items:center;height:100%}</style></head>
<body><h1>mock frame ${n}</h1>
<script>window.__timelines = window.__timelines || {};</script>
</body></html>
`;

const CAPTIONS_HTML = `<!doctype html><html><body><template id="captions"></template></body></html>\n`;
const INDEX_HTML = `<!doctype html><html><body><h1>mock index</h1></body></html>\n`;

/**
 * @param {{workdir:string, outputs:string[], stageId:string, candidates?:number}} job
 * @param {(line:string)=>void} log
 * @returns {Promise<{ok:boolean}>}
 */
export async function run(job, log) {
  const taskId = job.workdir.split(/[\\/]/).pop();
  const candN = job.candidates > 1 ? job.candidates : 0;
  // 多方案阶段：每个变体写 candidates/<stage>/<i>/<output>，不写正式制品
  if (candN) {
    for (let i = 1; i <= candN; i += 1) {
      for (const rel of job.outputs || []) {
        if (rel.endsWith("*") || rel.endsWith("/")) {
          log(`mock: skip candidate output ${rel}（目录/通配不支持候选）`);
          continue;
        }
        const content = CANNED[rel] || `# mock ${rel}\n`;
        writeArtifact(taskId, `candidates/${job.stageId}/${i}/${rel}`, `${content}\n<!-- 方案 ${i} -->\n`);
      }
    }
    log(`mock: wrote ${candN} candidate variants for ${job.stageId}`);
    return { ok: true };
  }
  for (const rel of job.outputs || []) {
    if (rel.endsWith("*")) {
      writeArtifact(taskId, "compositions/frames/01-hook.html", FRAME_HTML(1));
      writeArtifact(taskId, "compositions/frames/02-cta.html", FRAME_HTML(2));
      log("mock: wrote 2 frame html files");
      continue;
    }
    if (rel === "audio/") {
      writeArtifact(taskId, "audio/line-01.wav", "MOCK-WAV");
      writeArtifact(taskId, "audio/line-02.wav", "MOCK-WAV");
      log("mock: wrote 2 wav stubs");
      continue;
    }
    if (rel === "index.html") { writeArtifact(taskId, rel, INDEX_HTML); log(`mock: wrote ${rel}`); continue; }
    if (rel === "compositions/captions.html") { writeArtifact(taskId, rel, CAPTIONS_HTML); log(`mock: wrote ${rel}`); continue; }
    if (rel === "renders/video.mp4") { writeArtifact(taskId, rel, "MOCK-MP4"); log(`mock: wrote ${rel}`); continue; }
    const content = CANNED[rel] || `# mock ${rel}\n`;
    writeArtifact(taskId, rel, content);
    log(`mock: wrote ${rel}`);
  }
  return { ok: true };
}
