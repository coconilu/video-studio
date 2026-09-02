// 启动页：轮询 Rust 侧的 api_origin；拿到即跳转平台 UI，超时给出错误提示。
"use strict";

const msg = document.getElementById("msg");
const err = document.getElementById("err");
const deadline = Date.now() + 30000;

async function poll() {
  try {
    const origin = await window.__TAURI__.core.invoke("api_origin");
    if (origin) {
      window.location.replace(origin);
      return;
    }
  } catch (e) {
    err.style.display = "block";
    err.textContent = `与桌面壳通信失败：${e.message || e}`;
    return;
  }
  if (Date.now() > deadline) {
    msg.style.display = "none";
    err.style.display = "block";
    err.textContent = "平台服务启动超时。请确认安装包完整；若以开发模式运行，请确认系统已安装 Node ≥ 22。";
    return;
  }
  setTimeout(poll, 300);
}

void poll();
