<div align="center">

# OpenCode-Skin

**为 OpenCode Desktop 打造的沉浸式皮肤引擎**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-blue.svg)]()
[![Node](https://img.shields.io/badge/Node.js-18+-green.svg)]()

*通过 CDP 注入，让 OpenCode 拥有全屏壁纸 + 毛玻璃 UI + 实时控制面板*

</div>

---

## 效果展示

### 视频演示

https://github.com/user-attachments/assets/13c29838-195f-4208-b245-711b9af21b18

### 截图

<div align="center">
<img src="https://github.com/user-attachments/assets/564e4782-3b48-4e0c-b60e-6e003d5d625a" width="800" alt="OpenCode-Skin 效果截图">
</div>

### 示例壁纸

| 冷峻眼神 | 回眸少女 | 默认壁纸 |
|:---:|:---:|:---:|
| <img src="https://github.com/user-attachments/assets/1ba577b7-7e1b-4c3e-a31c-9a1dfd80657c" width="250"> | <img src="https://github.com/user-attachments/assets/4c93da48-b344-456d-8e90-e9620bee88a6" width="250"> | <img src="https://github.com/user-attachments/assets/c86c48e9-f183-4a06-8162-f3fc3c000446" width="250"> |

---

## 功能特性

| 功能 | 说明 |
|------|------|
| **全屏壁纸** | 支持 JPG/PNG 图片，自动 cover 适配 |
| **视频背景** | 支持 MP4/WebM 视频循环播放 |
| **毛玻璃 UI** | backdrop-filter blur 半透明覆盖层 |
| **实时控制** | 10 个滑块：模糊/亮度/对比度/饱和度/透明度/位置 |
| **面板透明度** | 标题栏/内容区/输入框 独立控制 |
| **暗色模式** | 跟随系统 or 手动切换 |
| **设置持久化** | localStorage 保存，重启后恢复 |
| **系统托盘** | 最小化到托盘，右键菜单控制 |
| **开机自启** | VBScript 启动器 + auto-inject 后台监控 |
| **主题预设** | 支持自定义主题，一键切换 |

---

## 快速开始

### 前置要求

- Windows 10/11
- Node.js 18+
- OpenCode Desktop 已安装

### 安装

`ash
git clone https://github.com/wpz1212ccl/opencodeev-skin.git
cd opencodeev-skin
`

### 方式一：一键启动

`powershell
cd windows
.\scripts\start.ps1
`

### 方式二：手动启动

`ash
# 1. 启动 OpenCode（带 CDP 调试端口）
& "C:\Path\To\OpenCode.exe" --remote-debugging-port=9335

# 2. 注入皮肤
cd windows
node scripts\injector.mjs --port 9335 --theme-dir .\assets
`

### 方式三：开机自启（推荐）

`powershell
cd windows
.\scripts\setup-autostart.ps1 -Install
.\scripts\auto-inject.ps1
`

---

## 设置面板

按 Ctrl+S 打开/关闭设置面板。

### 背景调节

| 滑块 | 范围 | 默认值 | 说明 |
|------|------|--------|------|
| Blur | 0-20px | 3px | 毛玻璃模糊度 |
| Brightness | 0-200% | 100% | 画面亮度 |
| Contrast | 0-200% | 100% | 画面对比度 |
| Saturate | 0-200% | 100% | 画面饱和度 |
| Opacity | 0-100% | 65% | 主容器透明度 |
| Pos X | 0-100% | 50% | 壁纸水平焦点 |
| Pos Y | 0-100% | 50% | 壁纸垂直焦点 |

### UI 调节

| 滑块 | 范围 | 默认值 | 说明 |
|------|------|--------|------|
| Titlebar | 0-100% | 75% | 标题栏透明度 |
| Content | 0-100% | 70% | 内容区透明度 |
| Composer | 0-100% | 80% | 输入框透明度 |

### 背景管理

- Change：选择本地图片或视频替换壁纸
- Reset：只重置滑块参数，保留当前壁纸

---

## 项目结构

`
opencodeev-skin/
├── README.md
├── LICENSE
├── CHANGELOG.md
├── docs/
│   └── ARCHITECTURE.md
└── windows/
    ├── assets/
    │   ├── dream-skin.css
    │   ├── renderer-inject.js
    │   ├── theme.json
    │   └── default-wallpaper.png
    ├── scripts/
    │   ├── injector.mjs
    │   ├── image-server.mjs
    │   ├── auto-inject.ps1
    │   ├── start.ps1
    │   └── ...
    ├── presets/
    └── tests/
`

---

## 工作原理

`
OpenCode 启动（--remote-debugging-port=9335）
    ↓
auto-inject.ps1 后台监控检测到 OpenCode
    ↓
启动 image-server.mjs（提供壁纸 HTTP 服务）
    ↓
启动 injector.mjs（通过 CDP 连接 OpenCode）
    ↓
注入 CSS + JS
    ↓
皮肤生效
`

---

## 技术栈

- Node.js — CDP 连接 + HTTP 服务器
- PowerShell — 系统集成
- CSS Custom Properties — 实时参数控制
- MutationObserver — 页面变化监听
- Chrome DevTools Protocol — 浏览器远程控制

---

## 许可证

MIT License

## 致谢

- Codex-Dream-Skin — 原始项目
- OpenCode — 目标应用