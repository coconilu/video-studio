/**
 * TTS 工具阶段：解析 SCRIPT.md → 逐行合成 → ffprobe 实测时长 → 构建 audio_meta.json。
 * 字幕短语窗口当前为按字符占比的估算（精度够 captions.mjs 用）；精修由 storyboard 阶段对齐。
 * @module tools/tts
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { FFPROBE } from "../config.mjs";
import { synthesizeSpeech } from "./media-hub.mjs";
import { readArtifact, writeArtifact } from "../core/artifacts.mjs";
import { taskDir } from "../core/tasks.mjs";

/**
 * 从 SCRIPT.md 提取口播行：`(Frame N)` 小节的缩进块为口播原文（与 audio.mjs 的约定一致）。
 * 小节内 `<!-- 字幕：… -->` 注释给出该行的**字幕显示文本**（多音字替代的正字、
 * 「叹号叹号 JS」→「!!js」等）；存在时 words[].text 用显示文本，TTS 仍读口播原文。
 * @param {string} md SCRIPT.md 内容
 * @returns {Array<{frame:number, text:string, display?:string}>}
 */
export function parseScriptLines(md) {
  const lines = [];
  let cur = null;
  for (const raw of md.split("\n")) {
    const h = /\(Frame\s+(\d+)\)/.exec(raw);
    if (raw.startsWith("## ") && h) {
      if (cur) lines.push(cur);
      cur = { frame: Number(h[1]), text: "" };
      continue;
    }
    if (cur) {
      if (raw.startsWith("## ")) { lines.push(cur); cur = null; continue; }
      const caption = /^\s*<!--\s*字幕：(.+?)\s*-->\s*$/.exec(raw);
      if (caption) { cur.display = caption[1]; continue; }
      if (/^\s{4}\S/.exec(raw)) cur.text += raw.trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.filter((l) => l.text);
}

/** @param {string} wavPath @returns {number} ffprobe 实测秒数（WAV 头尺寸不可信）。 */
export function probeDuration(wavPath) {
  const out = execFileSync(FFPROBE, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath,
  ], { encoding: "utf8" });
  const d = Number.parseFloat(out.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe bad duration for ${wavPath}: ${out}`);
  return d;
}

/**
 * 把一行口播按标点切成 3–6 个字幕短语，按字符占比分配时间窗。
 * @param {string} text @param {number} duration
 * @returns {Array<{id:number, text:string, start:number, end:number}>}
 */
export function phraseWindows(text, duration) {
  const parts = text.split(/(?<=[，。；：？！、—…])/).filter(Boolean);
  const merged = [];
  for (const p of parts) {
    if (merged.length > 0 && (merged[merged.length - 1] + p).length <= 14 && merged.length >= parts.length - 5) {
      merged[merged.length - 1] += p;
    } else {
      merged.push(p);
    }
  }
  const total = merged.reduce((s, p) => s + p.length, 0) || 1;
  let t = 0;
  return merged.map((p, i) => {
    const span = (p.length / total) * duration;
    const w = { id: i, text: p, start: round3(t), end: round3(Math.min(t + span, duration)) };
    t += span;
    return w;
  });
}

const round3 = (x) => Number(x.toFixed(3));

/**
 * 执行 tts 阶段。
 * @param {string} taskId 任务 id
 * @param {(line:string)=>void} log
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function runTts(taskId, log) {
  try {
    const script = readArtifact(taskId, "SCRIPT.md");
    const lines = parseScriptLines(script);
    if (lines.length === 0) return { ok: false, error: "SCRIPT.md: no (Frame N) lines found" };
    const voices = [];
    for (const line of lines) {
      const nn = String(line.frame).padStart(2, "0");
      log(`tts frame ${line.frame}: ${line.text.slice(0, 24)}…`);
      const src = await synthesizeSpeech(line.text);
      const rel = `audio/line-${nn}.wav`;
      const dest = join(taskDir(taskId), rel);
      mkdirSync(join(taskDir(taskId), "audio"), { recursive: true });
      copyFileSync(src, dest);
      const duration = probeDuration(dest);
      // 字幕显示文本：有「字幕：」注释用正字（按显示文本切短语），否则用口播原文
      const display = line.display || line.text;
      voices.push({ frame: line.frame, path: rel, duration_s: round3(duration), words: phraseWindows(display, duration) });
      log(`  -> ${rel} (${duration.toFixed(2)}s)`);
    }
    writeArtifact(taskId, "audio_meta.json", JSON.stringify({ bgm: null, bgm_pending: false, voices, sfx: [] }, null, 2) + "\n");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
