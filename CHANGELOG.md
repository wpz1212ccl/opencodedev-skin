# Changelog

## [Unreleased]

### Added
- macOS 基础支持（Phase 1）：一键启动脚本 + 共享目录重组
  - `macos/scripts/common.sh` — macOS 平台公共函数库
  - `macos/scripts/start.sh` — macOS 一键启动器
  - 平台无关资源提升到根目录（`assets/`、`presets/`、`scripts/`）
  - macOS 开发路线图（`plan/macos-support-plan.md`）
- OpenCode 安装查找支持 macOS（Spotlight `mdfind`、`/Applications`、`which`）
- macOS 进程管理（`pgrep`/`pkill`/`lsof`）

### Changed
- 目录结构重构：`assets/`、`presets/`、`scripts/*.mjs` 从 `windows/` 提升到根目录，实现 Windows/macOS 共享
- Windows PowerShell 脚本路径适配新的根级目录

### Fixed
- `assets/theme.json` 壁纸引用修正（`五条悟.png` → `default-wallpaper.png`）

## [2.0.0] - 2025-07-19

### Added
- 设置面板（Settings Panel）：10 个滑块实时控制 + Dark mode + Change/Reset
- 视频背景支持（Change 按钮选择本地视频）
- 背景图/视频持久化到 localStorage
- 性能优化：`applySettings` 脏标记检查、视频后台暂停、`requestIdleCallback` 写 localStorage
- 自动化测试脚本（性能/功能/导航/Opacity/Reset）
- 预设主题系统

### Fixed
- 首页壁纸被 OpenCode UI 遮挡（`dream-active-home` 全局标记策略）
- 首页 Opacity 滑块失效（CSS Specificity：dream-home 规则改用 CSS 变量）
- Reset 后滑块失效（`dispatchEvent` 同步浏览器内部状态）
- 从对话页重启后首页壁纸消失（MutationObserver `subtree: true` + 500ms 定时轮询）
- 视频播放时滑块卡顿（移除 `will-change: transform` + 视频时禁用 `backdrop-filter`）
- CSS 注入语法错误（双引号模板避免 `content: ''` 冲突）
- strict mode `arguments.callee` 不可用（改为具名函数）
- `backdrop-filter: blur` 性能问题（`contain: layout style` + 设置面板 blur 降低）

### Changed
- Reset 按钮只重置滑块参数，保留当前背景图/视频
- 快捷键从 `Ctrl+Shift+S` 改为 `Ctrl+S`

## [1.0.0] - 2025-07-18

### Added
- 初始版本：CDP 连接 + CSS/JS 注入
- 全屏壁纸背景
- 半透明毛玻璃 UI
- 开机自启（VBScript + auto-inject.ps1）
- 系统托盘
- 主题管理（theme.ps1）
- 图片 HTTP 服务器（内存缓存）
