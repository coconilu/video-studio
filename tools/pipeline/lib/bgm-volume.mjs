// bgm-volume.mjs — BGM 默认电平（vendored 自 media-use/audio/scripts/lib/bgm.mjs，
// 只取平台组装阶段需要的纯函数部分，不含 HeyGen/Lyria/MusicGen 生成链路）。
//
// 有人声时音乐是衬底，必须压在配音之下：0.12 linear ≈ -18 dB。
// 无人声时没有需要闪避的对象，BGM 前置到 0.9。调用方可按 composition 覆盖。

/** 有人声衬底电平。 */
export const BGM_BED_VOLUME = 0.12;
/** 无人声前置电平。 */
export const BGM_SILENT_VOLUME = 0.9;

/**
 * 按是否有配音返回默认 BGM 电平。
 * @param {boolean} hasVoice
 * @returns {number} 线性电平（0–1）
 */
export const bgmDefaultVolume = (hasVoice) => (hasVoice ? BGM_BED_VOLUME : BGM_SILENT_VOLUME);
