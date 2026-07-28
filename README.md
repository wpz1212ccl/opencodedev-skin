<div align="center">

# OpenCode-Skin

**为 OpenCode Desktop 打造的沉浸式皮肤引擎**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows_%7C_macOS-blue.svg)]()
[![Node](https://img.shields.io/badge/Node.js-18+-green.svg)]()

*通过 CDP 注入，让 OpenCode 拥有全屏壁纸 + 毛玻璃 UI + 实时控制面板*

</div>

---

## 效果展示

<div align="center">

|  |  |
|:---:|:---:|
| <img src="https://github.com/user-attachments/assets/0581db71-9740-4cd3-a6bb-2b6eeb15dd93" width="400" alt="demo_imgs1"> | <img src="https://github.com/user-attachments/assets/755e310a-cfe4-4c5e-9b60-e6d32a95a966" width="400" alt="demo_imgs2"> |
| <img src="https://github.com/user-attachments/assets/24e5e58b-106a-4950-b093-21dd3d389675" width="400" alt="demo_imgs3"> | <img src="https://github.com/user-attachments/assets/118c5121-3bee-46b1-8f61-4289127fe405" width="400" alt="demo_imgs4"> |
| <img src="https://github.com/user-attachments/assets/55cfc70b-f861-4ea4-b645-22bcc43b7f61" width="400" alt="demo_imgs5"> | <img src="https://github.com/user-attachments/assets/cc11bb02-4bf0-4fad-883c-f0a66f718165" width="400" alt="demo_imgs6"> |

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

- Windows 10/11 或 macOS 12+
- Node.js 18+
- OpenCode Desktop 已安装

### 🤖 AI 一键配置

将下面整段复制给 Claude Code，它会自动检测系统、安装依赖、验证环境：

#start-prompt
你是一个环境配置专家。请为 opencodedev-skin 项目执行以下完整配置流程：

**第一步：检测环境**
- 判断当前是 Windows 还是 macOS
- 检查 Node.js >= 18（`node --version`）
- 检查 git（`git --version`）

**第二步：根据系统执行对应操作**

*如果检测到 Windows：*
- 确保 `windows/scripts/` 下所有 .ps1 文件存在
- 检查 `windows/assets/theme.json` 中的壁纸路径指向一个真实文件
- 查找 OpenCode 安装路径：`Get-Command OpenCode.exe`，如果找不到则在常见路径下搜索
- 运行验证：`powershell -ExecutionPolicy Bypass -File windows\scripts\verify.ps1`

*如果检测到 macOS：*
- 确保 `macos/scripts/` 下所有 .sh 文件存在且可执行（`chmod +x macos/scripts/*.sh macos/tests/*.sh`）
- 检查必需工具：`curl`、`lsof`、`pgrep`、`mdfind`
- 查找 OpenCode：先找 `/Applications/OpenCode.app`，再用 `mdfind` 和 `which opencode`
- 运行单元测试：`bash macos/tests/run-tests.sh --unit`
- 运行环境检查：`bash macos/tests/run-tests.sh --env`

**第三步：输出配置报告**
- 操作系统 + 版本
- Node.js 版本
- OpenCode 安装路径（找到则显示路径，未找到则提示用户手动指定）
- 所有检查项的结果表（✅ 通过 / ❌ 失败 / ⚠️ 跳过）
- 下一步操作建议
#end-prompt

> 使用方式：打开 Claude Code，粘贴上述提示（从 `#start-prompt` 到 `#end-prompt`），回车即可。

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
├── .gitattributes                # 跨平台换行符配置
├── macos/                        # macOS 支持
│   ├── scripts/
│   │   ├── common.sh             # macOS 通用函数（Find-OpenCode/进程管理/CDP 等待）
│   │   └── start.sh              # macOS 一键启动器
│   └── tests/
│       └── run-tests.sh          # macOS 测试套件（33 项）
└── windows/                      # Windows 支持
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
- **PowerShell** — Windows 系统集成、进程管理
- **Bash** — macOS 系统集成、进程管理
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
