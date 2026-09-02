构建安装包前由 `npm run bundle` 填充：
- node/     Node 独立运行时（bundle-runtime.mjs 下载）
- platform/ 平台代码副本（bundle-platform.mjs 从仓库根复制）
此占位文件仅为让 tauri.conf.json 的 resources/* glob 在开发期也能匹配。
