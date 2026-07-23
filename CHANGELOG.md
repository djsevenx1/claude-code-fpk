# Changelog - Claude Code 沙箱

## v1.1.0 (2026-07-23)

修复 & 增强，按 [飞牛 fnOS 官方开发文档](https://developer.fnnas.com/docs/guide/) 校准。

### 🐛 修复

- **"执行脚本出错且原因未知"** — 原版 `install_callback` 在 `set -e` + 不可写 `TRIM_TEMP_LOGFILE` 时会在第 26 行早崩，没有任何兜底消息。新版在所有生命周期脚本里加：
  - `TRIM_TEMP_LOGFILE` 兜底默认路径 + 父目录 `mkdir -p`
  - `trap 'echo ... > $TRIM_TEMP_LOGFILE' ERR`
  - 每个 `die()` 都先把可读消息写入 log + UI

- **`wizard/` 目录在 main 分支不存在** — 补齐 `wizard/install` + `wizard/config`，含 7 个字段（端口、ttyd 用户密码、4 个 Anthropic 凭据）

- **`fnpack` 1.0.4 → 1.2.3** — 新版校验更严，build 流程修正：
  - `platform` 在 x86 包里写 `x86`，arm 包里写 `arm`（`--arch` 不支持，靠临时改 manifest 实现）
  - `ICON.PNG` 严格 64×64、`ICON_256.PNG` 严格 256×256
  - `cmd/uninstall_callback` 即使空壳也得有（fnpack 1.2.3 强制）

- **属主错** — `npm install` 跑在 root 下，`chown -R $TRIM_USERNAME` 把 `node_modules` 改到包用户

- **沙箱身份** — `cmd/main` 用 `runuser -u "$TRIM_USERNAME" --` 启动 ttyd（root lifecycle 脚本标准做法）

### ✨ 新增

- 完整 `wizard/install`：端口 + ttyd 用户密码（text）+ Anthropic 凭据（password）
- `wizard/config`：安装后可在应用设置里改所有配置
- `validate.sh`：43 项离线预检（比 fnpack 1.2.3 自己的 build 校验还严格）
- `build.sh`：一键拉 fnpack 1.2.3 + 校验 + 打 x86_64 / aarch64 包到 `dist/`
- 真实 `.fpk` 输出：`dist/claude-code-sandbox_v1.1.0_x86_64.fk` (127K)
- README 重写：明确"沙箱边界"——是用户级隔离，不是 namespace 容器

### ⚠️ 已知限制

- `fnpack` 1.2.3 不支持 `wizard/uninstall`，所以没有"卸载时彻底删数据"的向导选项。卸载由 `uninstall_init` 负责：停服务 + `shred -u` API Key；用户数据（`var/ etc/ home/`）由 fnOS 自动清理。
- 当前只打 `x86_64` 包（NAS 大多数是 x86）；aarch64 需 `./build.sh aarch64` 单独打。

## v1.0.0 (2026-07-23)

初始发布：Claude Code 沙箱 FPK（native + docker）。
