# Changelog

## [2.1.0] - 2026-08-01

### Performance
- **启动性能优化（实测 20-22s → 15-18s）**：injector 优先使用 image-server 提供壁纸（HTTP HEAD 探测 + 500ms 超时），避免将壁纸 base64 内联进 3.6MB payload；image-server 不可用时才回退 data: URL
- **魔数嗅探 MIME 检测**：`detectImageMime` 按文件真实格式（JPEG/PNG/WebP 魔数）识别，不再信任扩展名——修复 JPEG 伪装成 .png 导致 `parsePng` 失败、injector 崩溃退出的问题
- **视频壁纸强制走 image-server**：拒绝将 100MB+ 视频 base64 内联进 payload（会拖爆渲染进程），image-server 未运行时明确报错而非静默失败
- **SIGINT/SIGTERM 立即中断**：`runWatch` 改用 AbortController + interruptibleSleep，Ctrl+C 不再等待最长 2s 的 sleep 轮询

### Fixed
- **CSS @layer 优先级**：皮肤样式包裹进 `@layer dream-skin`，避免被 OpenCode 的 utilities 层覆盖（滑块/背景失效）
- **customArt XSS 加固**：`sanitizeCustomArt` 只接受 data:（图片/视频）与 localhost 环回地址，拒绝任意 file:// 或 javascript: URL
- **tray.ps1 数组拼接**：修复 PowerShell 5.1 `@($a) + $b` 被解析为参数名的问题
- **setup-autostart.ps1 重构**：改为创建 `D:\oc-skin` junction + 快捷方式直连 start.ps1（替代旧 auto-inject 监控），新增 `-WhatIf` 预览模式
- **start.ps1**：移除误传给 OpenCode.exe 的 `--theme-dir` 参数（该参数仅 image-server/injector 使用）

### Added
- `detectImageMime` / `detectImageFormat` 导出（image-metadata.mjs）
- `windows/tests/` 测试目录：skin-monitor.mjs（皮肤注册监控）、perf-*.mjs（启动性能测量脚本）、回归测试工具

## [2.0.1] - 2026-07-28

### Added
- 右侧边栏（ASIDE）壁纸透明修复：`[class*="bg-v2-background"]` 通用选择器覆盖所有 `bg-v2-*` 变体
- 暗色模式同步：右侧边栏暗色模式透明规则

### Fixed
- **启动器重构**：移除 auto-inject 后台轮询机制，改用快捷方式直连 `start.ps1`
- **中文路径 Bug**：`.lnk` 快捷方式存储中文路径时损坏 → 目录符号链接 `D:\oc-skin` 绕过
- **Start-Process 静默退出**：`--watch` 模式通过 `Start-Process` 启动后立即退出 → 改用内联 `--once` 模式
- **chromePresent 验证死循环**：`waitForVerifiedSession` 因 `chromePresent` 元素未创建而超时 30s → 改为合理超时
- **图片服务器未启动**：`start.ps1` 新增图片服务器启动/清理逻辑
- **PowerShell 5.1 兼容**：`@($a) + $b` 数组拼接被解释为参数名报错 → 显式变量暂存

### Changed
- 桌面快捷方式不再直接启动 OpenCode.exe，改为通过 PowerShell 隐藏窗口运行 `start.ps1`
- 项目文档和索引同步更新至 Obsidian 知识库

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
