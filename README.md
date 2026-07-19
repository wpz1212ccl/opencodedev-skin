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
<img src="https://github.com/wpz1212ccl/opencodedev-skin/releases/download/untagged-38a929f313ed0feea4b8/screenshot.png" width="800" alt="OpenCode-Skin 效果截图">
</div>

### 示例壁纸

| 冷峻眼神 | 回眸少女 | 默认壁纸 |
|:---:|:---:|:---:|
| <img src="https://github.com/wpz1212ccl/opencodedev-skin/releases/download/untagged-38a929f313ed0feea4b8/lengjunshenyan.png" width="250"> | <img src="https://github.com/wpz1212ccl/opencodedev-skin/releases/download/untagged-38a929f313ed0feea4b8/huimouShaonv.png" width="250"> | <img src="windows/assets/default-wallpaper.png" width="250"> |

---

## 功能特性

| 功能 | 说明 |
|------|------|
| **全屏壁纸** | 支持 JPG/PNG 图片，自动 cover 适配 |
| **视频背景** | 支持 MP4/WebM 视频循环播放 |
| **毛玻璃 UI** | `backdrop-filter: blur()` 半透明覆盖层 |
| **实时控制** | 10 个滑块：模糊 / 亮度 / 对比度 / 饱和度 / 透明度 / 位置 |
| **面板透明度** | 标题栏 / 内容区 / 输入框 独立控制 |
| **暗色模式** | 跟随系统 or 手动切换 |
| **设置持久化** | localStorage 保存，重启后恢复 |
| **系统托盘** | 最小化到托盘，右键菜单控制 |
| **开机自启** | VBScript 启动器 + auto-inject 后台监控 |
| **主题预设** | 支持自定义主题，一键切换 |

---

## 快速开始

### 前置要求

- **Windows** 10/11
- **Node.js** 18+
- **OpenCode Desktop** 已安装

### 安装

```bash
git clone https://github.com/your-username/opencode-skin.git
cd opencode-skin
```

### 方式一：一键启动

```powershell
cd windows
.\scripts\start.ps1
```

### 方式二：手动启动

```bash
# 1. 启动 OpenCode（带 CDP 调试端口）
& "C:\Path\To\OpenCode.exe" --remote-debugging-port=9335

# 2. 注入皮肤
cd windows
node scripts\injector.mjs --port 9335 --theme-dir .\assets
```

### 方式三：开机自启（推荐）

```powershell
cd windows

# 安装开机自启
.\scripts\setup-autostart.ps1 -Install

# 手动启动后台监控
.\scripts\auto-inject.ps1
```

---

## 设置面板

按 **`Ctrl + S`** 打开/关闭设置面板。

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

- **Change**：选择本地图片或视频替换壁纸
- **Reset**：只重置滑块参数，保留当前壁纸

---

## 项目结构

```
opencode-skin/
├── README.md
├── LICENSE
├── CHANGELOG.md
├── docs/
│   └── ARCHITECTURE.md          # 架构文档
└── windows/
    ├── assets/
    │   ├── dream-skin.css       # CSS 主题规则
    │   ├── renderer-inject.js   # JS 注入逻辑
    │   ├── theme.json           # 默认主题配置
    │   ├── default-wallpaper.png # 默认壁纸
    │   └── samples/             # 示例资源
    ├── scripts/
    │   ├── injector.mjs         # CDP 注入核心
    │   ├── image-server.mjs     # HTTP 图片服务器
    │   ├── auto-inject.ps1      # 后台监控
    │   ├── start.ps1            # 启动入口
    │   ├── tray.ps1             # 系统托盘
    │   └── ...                  # 其他脚本
    ├── presets/                 # 预设主题
    └── tests/                   # 测试脚本
```

---

## 工作原理

```
┌──────────────────────────────────────────────────────┐
│  OpenCode Desktop (Electron)                         │
│  ┌────────────────────────────────────────────────┐  │
│  │  CDP Port 9335                                 │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │  injector.mjs 连接渲染进程               │  │  │
│  │  │  ↓                                       │  │  │
│  │  │  注入 CSS (dream-skin.css)               │  │  │
│  │  │  注入 JS  (renderer-inject.js)           │  │  │
│  │  │  ↓                                       │  │  │
│  │  │  JS 创建设置面板 DOM                     │  │  │
│  │  │  JS 设置 CSS 变量                        │  │  │
│  │  │  JS 监听页面变化 (MutationObserver)      │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  image-server.mjs (端口 18765)                 │  │
│  │  提供壁纸 HTTP 服务，内存缓存                   │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### CSS 变量体系

所有视觉参数通过 CSS 自定义属性控制，支持实时调整：

```css
--dream-blur: 3px;              /* 模糊度 */
--dream-brightness: 100%;       /* 亮度 */
--dream-contrast: 100%;         /* 对比度 */
--dream-saturate: 100%;         /* 饱和度 */
--dream-container-alpha: 0.65;  /* 主容器透明度 */
--dream-titlebar-alpha: 0.75;   /* 标题栏透明度 */
--dream-content-alpha: 0.7;     /* 内容区透明度 */
--dream-composer-alpha: 0.8;    /* 输入框透明度 */
--dream-art: url(...);          /* 壁纸图片 */
--dream-art-position: 50% 50%;  /* 壁纸焦点 */
```

---

## 主题

### 使用预设

```powershell
.\scripts\theme.ps1 -List          # 列出可用主题
.\scripts\theme.ps1 -Set romantic  # 应用主题
.\scripts\theme.ps1 -Current       # 查看当前主题
```

### 自定义主题

在 `assets/` 目录创建 `theme.json`：

```json
{
  "image": "my-wallpaper.png",
  "art": {
    "focusX": 0.5,
    "focusY": 0.5,
    "safeArea": "auto",
    "taskMode": "ambient"
  }
}
```

---

## 测试

```powershell
cd windows

# 性能测试（FPS / Long Task / 掉帧检测）
node tests\perf-video-slider.mjs --port 9335 --cycles 15

# 功能测试（所有滑块 CSS 变量验证）
node tests\test-all-sliders.mjs --port 9335

# 首页 Opacity 测试
node tests\test-opacity-home.mjs

# 页面导航测试
node tests\test-nav-home.mjs

# Reset 全流程测试
node tests\test-reset-full.mjs
```

---

## 已知限制

| 限制 | 说明 |
|------|------|
| **OpenCode 版本** | 当前基于 v1.18.3，更新后 DOM 选择器可能变化 |
| **Electron Sandbox** | `file://` URL 被拦截，壁纸需通过 HTTP 服务器提供 |
| **视频背景** | 实验性功能，性能取决于硬件解码能力 |
| **多窗口** | 每个标签页独立 BrowserWindow，需分别注入 |

---

## 技术栈

- **Node.js** — CDP 连接 + HTTP 服务器
- **PowerShell** — 系统集成（启动/托盘/自启）
- **CSS Custom Properties** — 实时参数控制
- **MutationObserver** — 页面变化监听
- **Chrome DevTools Protocol** — 浏览器远程控制

---

## 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 致谢

- [Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) — 原始项目
- [OpenCode](https://github.com/opencode-ai/opencode) — 目标应用

---

<div align="center">

**如果这个项目对你有帮助，请给个 Star 支持一下！**

</div>
