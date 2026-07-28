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

<div align="center">

|  |  |
|:---:|:---:|
| <img src="https://github.com/user-attachments/assets/39821dea-bace-4d70-b1b8-2578d31e0b5f" width="400" alt="demo_imgs1"> | <img src="https://github.com/user-attachments/assets/6f87da88-27a1-4185-aac8-f2f4c975cfa1" width="400" alt="demo_imgs2"> |
| <img src="https://github.com/user-attachments/assets/9cec6074-98cb-4dc9-9c97-485da02766e3" width="400" alt="demo_imgs3"> | <img src="https://github.com/user-attachments/assets/8d38e11b-27eb-413b-b66b-ab9e49f7803d" width="400" alt="demo_imgs4"> |
| <img src="https://github.com/user-attachments/assets/1df73440-17a2-4da7-b6d0-7097f470d2f4" width="400" alt="demo_imgs5"> | <img src="https://github.com/user-attachments/assets/1f4cf470-3aa3-460f-8bee-1f7d9cecb85a" width="400" alt="demo_imgs6"> |

</div>

### 视频演示

<video src="https://github.com/user-attachments/assets/e0c3bd6e-e7d7-4d2f-9ae8-f489c89f6d2b" controls width="800" alt="demo_video1"></video>

<video src="https://github.com/user-attachments/assets/aca2e7d9-0ad8-4966-83aa-36c161780964" controls width="800" alt="demo_video2"></video>

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
| **快捷键操作** | Ctrl+S 切换设置面板 |
| **主题预设** | 支持自定义主题，一键切换 |

---

## 快速开始

### 前置要求

- Windows 10/11
- Node.js 18+
- OpenCode Desktop 已安装

### 安装

```bash
git clone https://github.com/wpz1212ccl/opencodedev-skin.git
cd opencodedev-skin
```

### 使用方式

#### 方式一：通过桌面快捷方式（推荐）

执行安装脚本配置快捷方式：

```powershell
cd windows
.\scripts\setup-autostart.ps1
```

安装脚本会自动：
1. 创建目录符号链接 `D:\oc-skin`（绕过 Windows 快捷方式中文路径编码问题）
2. 修改桌面 OpenCode 快捷方式，指向启动器

之后**双击桌面 OpenCode 图标**即可自动注入皮肤。

#### 方式二：直接运行启动脚本

```powershell
cd windows
.\scripts\start.ps1 -OpenCodePath "D:\OpenCode\OpenCode.exe" -CdpPort 9335
```

启动脚本会自动：
1. 启动图片服务器（HTTP 端口 18765）
2. 启动 OpenCode（带 `--remote-debugging-port=9335`）
3. 等待 CDP 就绪
4. 注入皮肤

关闭 OpenCode 后自动清理所有后台进程，零残留。

#### 方式三：手动注入

```bash
# 1. 启动 OpenCode（带 CDP 调试端口）
& "C:\Path\To\OpenCode.exe" --remote-debugging-port=9335

# 2. 注入皮肤
cd windows
node scripts\injector.mjs --port 9335 --auto-browser-id --theme-dir .\assets --once
```

---

## 设置面板

按 **Ctrl+S** 打开/关闭设置面板。

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
opencodedev-skin/
├── README.md
├── LICENSE
├── CHANGELOG.md
├── .gitignore
└── windows/
    ├── assets/
    │   ├── dream-skin.css           # CSS 主题规则
    │   ├── renderer-inject.js       # DOM 注入/清理逻辑
    │   ├── theme.json               # 主题配置（默认壁纸路径）
    │   ├── 【哲风壁纸】*.png         # 壁纸图片资源
    │   └── video-bg.mp4             # 视频背景资源
    ├── scripts/
    │   ├── injector.mjs             # CDP 连接器，核心注入逻辑
    │   ├── image-server.mjs         # HTTP 图片服务器（端口 18765）
    │   ├── image-metadata.mjs       # 图片元数据验证
    │   ├── start.ps1                # 启动脚本（推荐入口）
    │   ├── auto-inject.ps1          # 后台监控脚本（可选）
    │   ├── setup-autostart.ps1      # 自启动配置
    │   ├── common.ps1               # 通用函数
    │   ├── theme.ps1                # 主题管理
    │   ├── tray.ps1                 # 系统托盘
    │   ├── install.ps1              # 安装脚本
    │   ├── restore.ps1              # 恢复脚本
    │   └── verify.ps1               # 验证脚本
    └── presets/
        └── preset-romantic-rose/
            └── theme.json           # 预设主题
```

---

## 工作原理

```
双击桌面 OpenCode 图标
    ↓
start.ps1（PowerShell 隐藏窗口）
    ├─ 启动 image-server.mjs（HTTP 端口 18765，提供壁纸）
    ├─ 启动 OpenCode（--remote-debugging-port=9335）
    ├─ 等待 CDP 就绪
    └─ 运行 injector.mjs（--once 模式）
         ↓
         通过 WebSocket 连接 CDP
         ↓
         注入 CSS（dream-skin.css）+ JS（renderer-inject.js）
         ↓
         皮肤生效 ✅
    ↓
（等待 OpenCode 关闭）
    └─ 自动清理：关闭图片服务器 + injector
         ↓
         零残留进程
```

---

## 技术栈

- **Node.js** — CDP WebSocket 连接 + HTTP 图片服务器
- **PowerShell** — 系统集成、进程管理
- **CSS Custom Properties** — 实时参数控制（滑块 → CSS 变量）
- **MutationObserver** — 页面导航监听
- **Chrome DevTools Protocol** — 浏览器远程调试接口

---

## 项目状态

| 功能 | 状态 |
|------|------|
| 全屏壁纸注入 | ✅ |
| 毛玻璃 UI（backdrop-filter） | ✅ |
| 暗色/亮色模式 | ✅ |
| 皮肤控制面板（Ctrl+S） | ✅ |
| 设置持久化（localStorage） | ✅ |
| 首页壁纸显示 | ✅ |
| 右侧边栏壁纸 | ✅ |
| Change 换图/视频 | ✅ |
| 性能优化（脏标记 + 空闲回调） | ✅ |
| 启动器稳定性 | ✅ |
| 视频背景（默认） | ❌ 实验性 |

---

## 常见问题

### Q: 桌面快捷方式双击无反应？

检查快捷方式属性，确保目标指向正确：

```
Target: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
Args: -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\oc-skin\opencode-skin\windows\scripts\start.ps1" -OpenCodePath "D:\OpenCode\OpenCode.exe" -CdpPort 9335 -NoTray
```

> **注意**：如果项目路径包含中文，必须使用目录符号链接（如 `D:\oc-skin`）避免 `.lnk` 编码问题。详见 `setup-autostart.ps1`。

### Q: 皮肤没有生效？

1. 检查 OpenCode 是否以 `--remote-debugging-port=9335` 启动
2. 运行手动注入：`node scripts\injector.mjs --port 9335 --auto-browser-id --once`
3. 如果首页壁纸不显示，参考 `renderer-inject.js` 中的首页选择器配置

### Q: 如何更换壁纸？

修改 `windows/assets/theme.json` 中的 `"image"` 字段，指向 assets 目录下的图片文件：

```json
{
  "image": "你的壁纸文件名.png"
}
```

---

## 许可证

MIT License

## 致谢

- [Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) — 原始项目灵感
- [OpenCode](https://opencode.ai/) — 目标应用
