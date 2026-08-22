/**
 * web-bridge 调用封装：本地守护进程（127.0.0.1:10086）HTTP 直连，控制用户真实浏览器
 * （带登录态）。Node 侧直接发请求——不经 shell，天然避开 Windows 非 ASCII 参数损坏。
 * @module bridges/webbridge
 */
import { WEBBRIDGE_URL } from "../config.mjs";

/**
 * 调用一个 web-bridge 动作。
 * @param {string} action 动作名（navigate / snapshot / click / fill / evaluate / screenshot / …）
 * @param {object} args 动作参数
 * @param {string} session 会话名（同一任务的调用用同一会话，标签页才会归组）
 * @returns {Promise<any>} 守护进程返回的 JSON
 */
export async function callBridge(action, args, session) {
  const res = await fetch(WEBBRIDGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args, session }),
  });
  if (!res.ok) throw new Error(`web-bridge ${action}: HTTP ${res.status}`);
  return res.json();
}

/**
 * 抓取一个 URL 的正文文本（经用户真实浏览器，带登录态），供 ingest 阶段消化。
 * @param {string} url @param {string} session
 * @returns {Promise<string>} 页面可见文本
 */
export async function fetchPageText(url, session) {
  await callBridge("navigate", { url, newTab: true, group_title: "video-studio" }, session);
  const snap = await callBridge("snapshot", {}, session);
  return snap?.tree ? String(snap.tree) : JSON.stringify(snap);
}
