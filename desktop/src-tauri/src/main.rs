#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Video Studio 桌面壳：启动时拉起 Node sidecar 跑平台 server（仅回环），
//! 从 stdout 读到 `video-studio listening: <origin>` 后把 origin 经 api_origin
//! 命令提供给启动页；启动页轮询到 origin 即跳转。退出时按进程树清理 sidecar。
//!
//! sidecar 定位：
//! - 开发（debug 构建且仓库存在）：平台代码 = 仓库根（CARGO_MANIFEST_DIR 上两级），Node 用 PATH 上的
//! - 安装包（release）：平台代码与 Node 运行时都在 resources/ 下（bundle 脚本注入），用户无需装 Node
//!
//! sidecar 启动失败不 panic（GUI 进程 panic 用户什么都看不到），
//! 错误字符串经 api_origin 的 `ERROR ...` 前缀传给启动页渲染。

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

/// (origin, error)：sidecar 启动结果。error 非空且 origin 为空时以 `ERROR ` 前缀返回。
struct Launch(Mutex<(String, String)>);

#[tauri::command]
fn api_origin(state: tauri::State<Launch>) -> String {
    let (origin, error) = &*state.0.lock().unwrap();
    if origin.is_empty() && !error.is_empty() {
        return format!("ERROR {error}");
    }
    origin.clone()
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 4173 空闲就用它（与 npm start 习惯一致），否则让系统分配随机端口。
/// 返回 None 表示连系统分配都失败（极端情况，如实报错而不是退回去撞 4173）。
fn pick_port() -> Option<u16> {
    if TcpListener::bind("127.0.0.1:4173").is_ok() {
        return Some(4173);
    }
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .map(|l| l.local_addr().unwrap().port())
}

/// 开发模式回退：仅 debug 构建且仓库代码存在时生效。
/// release 安装包必须用包内资源——行为不随机器上有没有仓库而漂移。
fn dev_repo_root() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    dev.join("server").join("index.mjs").exists().then_some(dev)
}

/// 平台代码目录。
fn platform_dir() -> PathBuf {
    dev_repo_root().unwrap_or_else(|| resource_root().join("platform"))
}

/// Node 可执行文件：开发用 PATH 上的 node，打包后用随包运行时。
fn node_bin() -> PathBuf {
    if dev_repo_root().is_some() {
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

/// 启动 sidecar，返回 (child, origin, error)。origin 等不到时 10s 超时放行，
/// 由启动页的超时文案兜底；child 为 None 表示 spawn 即失败。
fn spawn_sidecar() -> (Option<Child>, String, String) {
    let Some(port) = pick_port() else {
        return (None, String::new(), "127.0.0.1 无可用端口".into());
    };
    let platform = platform_dir();
    let server = platform.join("server").join("index.mjs");
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
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return (
                None,
                String::new(),
                format!("无法启动平台 sidecar（{}）：{e}", server.display()),
            );
        }
    };
    let stdout = child.stdout.take().expect("sidecar stdout 不可用");
    let (tx, rx) = mpsc::channel::<String>();
    // 读线程常驻 drain stdout：读端一直活着，server 后续写日志不会因 EPIPE 崩掉
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => {
                    let _ = tx.send(String::new()); // EOF：通知主线程别再等
                    break;
                }
                Ok(_) => {
                    if let Some(rest) = line.trim().strip_prefix("video-studio listening: ") {
                        // MOCK 模式行尾带 " (MOCK)"，只取 URL 本体
                        let _ = tx.send(rest.split(' ').next().unwrap_or("").to_string());
                    }
                }
            }
        }
    });
    let origin = rx.recv_timeout(Duration::from_secs(10)).unwrap_or_default();
    (Some(child), origin, String::new())
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
    // 注意：只杀直接子进程，渲染中的 ffmpeg/chrome 孙进程可能残留（二期可换进程组）
    let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).output();
}

fn main() {
    let (child, origin, error) = spawn_sidecar();
    let pid = child.map(|c| c.id());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Launch(Mutex::new((origin, error))))
        .invoke_handler(tauri::generate_handler![api_origin])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(move |_handle, event| {
        if let (tauri::RunEvent::Exit, Some(pid)) = (event, pid) {
            kill_process_tree(pid);
        }
    });
}
