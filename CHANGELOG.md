# Changelog

## [2.0.2] - 2026-07-31

### Fixed
- macOS 启动器不再直接执行 `.app/Contents/MacOS/OpenCode`，改为优先通过 `open -na ... --args` 启动 bundle，避免 Electron 进入 CDP 端口可监听但 `/json/version` 与 `/json/list` 不稳定的异常状态
- macOS 注入策略从一次性 `--once` 改为后台 `--watch`，解决 renderer target 延迟出现时背景未加载、`Ctrl+S` 设置面板快捷键未注册的问题
- macOS 对“已运行实例”增加真实注入校验，不再仅凭端口与进程存在就误判为“已带皮肤运行”
- macOS `--pause` 参数改为通过 `pause file` 传递给 injector，修复原先向 injector 传入未知参数导致的启动失败
- macOS 启动器改为轮询 OpenCode 主进程退出，并记录 injector PID 到状态文件，确保 `.app` bundle 启动场景也能正确清理
- 主题图片校验与图片服务器改为优先根据文件头识别真实格式，修复扩展名为 `.png` 但内容实际为 JPEG 时 injector 直接拒绝加载背景的问题
- README 与架构文档同步更新 macOS 启动/注入链路说明

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
