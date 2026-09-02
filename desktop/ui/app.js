// 启动页：先检查更新（失败静默），再轮询 Rust 侧的 api_origin 跳转平台 UI。
"use strict";

const msg = document.getElementById("msg");
const err = document.getElementById("err");
const updateBox = document.getElementById("update");
const updateText = document.getElementById("update-text");

/** 启动时检查一次更新；有更新则等用户选择，否则直接放行。失败静默放行。 */
async function checkUpdate() {
  try {
    const updater = window.__TAURI__?.updater;
    if (!updater) return;
    const update = await Promise.race([
      updater.check(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    if (!update) return;
    updateText.textContent = `发现新版本 v${update.version}（当前 v${update.currentVersion}）`;
    updateBox.hidden = false;
    await new Promise((resolve) => {
      document.getElementById("update-skip").onclick = resolve;
      document.getElementById("update-now").onclick = async () => {
        updateText.textContent = "正在下载并安装，完成后会自动重启…";
        updateBox.querySelector(".update-actions").style.display = "none";
        try {
          // Windows NSIS 安装器接管安装并自动重启，无需手动 relaunch
          await update.downloadAndInstall();
        } catch (e) {
          updateText.textContent = `更新失败：${e.message || e}（可跳过继续使用）`;
          updateBox.querySelector(".update-actions").style.display = "";
        }
      };
    });
  } catch {
    // 离线 / 尚无 Release / 超时：静默进入
  }
}

async function poll(deadline) {
  try {
    const origin = await window.__TAURI__.core.invoke("api_origin");
    if (origin.startsWith("ERROR ")) {
      msg.style.display = "none";
      err.style.display = "block";
      err.textContent = origin.slice(6);
      return;
    }
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
  setTimeout(() => poll(deadline), 300);
}

async function boot() {
  await checkUpdate();
  void poll(Date.now() + 30000);
}

void boot();
