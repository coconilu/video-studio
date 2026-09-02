#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Video Studio 桌面壳：启动时拉起 Node sidecar 跑平台 server（仅回环），
//! 从 stdout 读到 `video-studio listening: <origin>` 后把 origin 经 api_origin
//! 命令提供给启动页；启动页轮询到 origin 即跳转。退出时按进程树清理 sidecar。
//!
//! sidecar 定位：
//! - 开发（tauri dev）：平台代码 = 仓库根（CARGO_MANIFEST_DIR 上两级），Node 用 PATH 上的
//! - 安装包：平台代码与 Node 运行时都在 resources/ 下（bundle 脚本注入），用户无需装 Node

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

struct ApiOrigin(Mutex<String>);

#[tauri::command]
fn api_origin(state: tauri::State<ApiOrigin>) -> String {
    state.0.lock().unwrap().clone()
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 4173 空闲就用它（与 npm start 习惯一致），否则让系统分配随机端口。
fn pick_port() -> u16 {
    if TcpListener::bind("127.0.0.1:4173").is_ok() {
        return 4173;
    }
    TcpListener::bind("127.0.0.1:0")
        .map(|l| l.local_addr().unwrap().port())
        .unwrap_or(4173)
}

/// 平台代码目录：开发时回退仓库根，否则用打包进 resources 的副本。
fn platform_dir() -> PathBuf {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    if dev.join("server").join("index.mjs").exists() {
        return dev;
    }
    resource_root().join("platform")
}

/// Node 可执行文件：开发用 PATH 上的 node，打包后用随包运行时。
fn node_bin() -> PathBuf {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    if dev.join("server").join("index.mjs").exists() {
        return PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" });
    }
    resource_root().join(if cfg!(windows) {
        "node/node.exe"
    } else {
        "node/node"
    })
}

/// 打包后 resources/ 的根：Windows 在 exe 同级，macOS 在 .app/Contents/Resources。
fn resource_root() -> PathBuf {
    let exe = std::env::current_exe().expect("无法定位当前 exe");
    let dir = exe.parent().expect("exe 无父目录").to_path_buf();
    #[cfg(target_os = "macos")]
    return dir.join("../Resources/resources");
    #[cfg(not(target_os = "macos"))]
    dir.join("resources")
}

fn spawn_sidecar() -> (Child, String) {
    let platform = platform_dir();
    let server = platform.join("server").join("index.mjs");
    let port = pick_port();
    let mut cmd = Command::new(node_bin());
    cmd.arg(&server)
        .current_dir(&platform)
        .env("STUDIO_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().unwrap_or_else(|e| {
        panic!("无法启动平台 sidecar（{}）：{e}", server.display())
    });
    let stdout = child.stdout.take().expect("sidecar stdout 不可用");
    let mut reader = BufReader::new(stdout);
    let mut origin = String::new();
    let mut line = String::new();
    // 等首行就绪信号；server 启动失败时 read_line 返回 0，origin 留空交给启动页报错
    let _ = reader.read_line(&mut line);
    if let Some(rest) = line.trim().strip_prefix("video-studio listening: ") {
        origin = rest.to_string();
    }
    (child, origin)
}

#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.output();
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree(pid: u32) {
    let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).output();
}

fn main() {
    let (child, origin) = spawn_sidecar();
    let pid = child.id();
    let app = tauri::Builder::default()
        .manage(ApiOrigin(Mutex::new(origin)))
        .invoke_handler(tauri::generate_handler![api_origin])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(move |_handle, event| {
        if let tauri::RunEvent::Exit = event {
            kill_process_tree(pid);
        }
    });
}
