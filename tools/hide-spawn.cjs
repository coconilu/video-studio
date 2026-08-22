// NODE_OPTIONS --require 钩子：强制 node 进程树内所有 child_process 派生 windowsHide。
// 背景：puppeteer 启动 chrome-headless-shell 不传 windowsHide，父进程无 console 时
// Windows 会为孙进程新建可见终端窗口（渲染/校验时连弹多个 PowerShell 窗口）。
// 由 steps.mjs 通过 NODE_OPTIONS 注入，勿直接 import。
"use strict";
const cp = require("node:child_process");

const hide = (orig) =>
  function (...args) {
    const last = args[args.length - 1];
    const cb = typeof last === "function" ? args.pop() : null;
    const opts = args.find((a) => a && typeof a === "object" && !Array.isArray(a));
    // 无 options 实参时补一个：spawn(cmd) / spawn(cmd, []) / exec(cmd) 均兼容末尾补 options
    if (opts) opts.windowsHide = true;
    else args.push({ windowsHide: true });
    if (cb) args.push(cb);
    return orig.apply(this, args);
  };

cp.spawn = hide(cp.spawn);
cp.execFile = hide(cp.execFile);
cp.exec = hide(cp.exec);
