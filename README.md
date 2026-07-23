# Claude Code 沙箱 for 飞牛 fnOS

把 [Anthropic Claude Code](https://github.com/anthropics/claude-code) CLI 装到飞牛 NAS 上，以 **包用户 + 工作目录隔离**方式沙箱运行，通过 Web 终端 (ttyd) 访问。

> 仓库 [`djsevenx1/fnos-claude-code-sandbox`](https://github.com/djsevenx1/fnos-claude-code-sandbox) 基础上的 v1.1.0 修复版。
> 主要修复：消除"执行脚本出错且原因未知"提示、补齐 wizard 表单、严格按 fnpack 1.2.3 规范打包。

参考了飞牛官方 OpenClaw（小龙虾）以及社区 [Hermes Agent](https://github.com/iranee/fnos-hermes-agent) 的应用结构。

---

## 下载

| 文件 | SHA256 | 用途 |
|---|---|---|
| `claude-code-sandbox_v1.1.0_x86_64.fpk` | `a357e847e994468df27b70950fa5ef3d72bff1ebf41ec8c32b00b0e715ee1876` | **x86_64 NAS**（含 fnpack 1.2.3 打的最终包） |
| `source/claude-code-sandbox/` | — | 完整源码，可自行 `bash build.sh` 重打 |

## 安装

### 前置

- 飞牛 fnOS >= 0.9.27，**x86_64** 架构
- 应用中心能正常装应用（即应用商店连通）
- NAS 能访问 `github.com`（下 ttyd）和 `registry.npmmirror.com`（装 Claude Code）

### 步骤

1. **应用中心 → 手动安装 → 选 `.fpk` 文件**
2. 系统检测到 `install_dep_apps=nodejs_v22` → 弹出提示，**确认安装 nodejs_v22**（约 1-2 分钟）
3. 回到 Claude Code 安装向导，依次填入：

    | 字段 | 说明 |
    |---|---|
    | Web 终端端口 | 默认 7681，建议改 |
    | Web 终端用户名 / 密码 | 留空 = 不鉴权 |
    | `ANTHROPIC_BASE_URL` | 代理 / 第三方网关（如 aicodemirror / 阿里云百炼 / DeepSeek）；官方直连留空 |
    | `ANTHROPIC_MODEL` | 默认 `claude-sonnet-4-5` |
    | `ANTHROPIC_API_KEY` | **password 字段**，不会明文显示 |
    | `ANTHROPIC_AUTH_TOKEN` | **password 字段**，OAuth Token；与 API Key 二选一 |

4. **等待首次安装**：`install_callback` 会下载 ttyd + 通过 npm 装 Claude Code（约 1-3 分钟）
5. 桌面点 **Claude Code 沙箱** 图标 → Web 终端打开
6. 终端里输入 `claude` 进入 Claude Code TUI

## 沙箱边界

| 维度 | 实现 |
|---|---|
| 进程身份 | `run-as=package`，由 `config/privilege` 声明 `username=claude-code-sandbox` |
| 工作目录 | ttyd 启动时 `chdir` 到 `$TRIM_PKGHOME/home/workspace`，Claude Code 默认在此目录活动 |
| 数据隔离 | 用户数据、`.claude` 配置、API Key 都放在包用户目录，权限 600 |
| 授权路径 | `config/resource` 声明 `workspace` 共享目录；用户可在应用设置中追加授权目录 |
| 凭据保护 | `.env` 权限 600，卸载时用 `shred` 安全删除 |
| 不做（避免误用） | **不**调用 `claude --dangerously-skip-permissions`；**不**走 Docker；**不**给 root 长期运行 |

> 沙箱强度：**用户级隔离**，不是 Linux namespace 容器。
> 适合：在 NAS 上做 AI 辅助开发、写代码、跑测试。
> 不适合：需要访问 `/var`、挂载设备、做网络拦截等特权操作。

## 架构

```
fnOS 桌面图标 -> cmd/main -> ttyd (7681) -> bash 终端
                |
                +-- runuser -u claude-code-sandbox -- (root lifecycle 脚本标准做法)
                v
              claude (npm 安装到应用目录)
                v
              ~/.claude/settings.json (API Key 等)
```

- **依赖**：`install_dep_apps=nodejs_v22`（fnOS 应用商店自动装）
- **运行时**：Node.js v22 + ttyd 1.7.7（应用目录静态二进制）+ Claude Code CLI（npm）
- **沙箱**：Claude Code 进程以应用专属用户 `claude-code-sandbox` 运行，非 root，仅能访问授权目录
- **持久化**：
    - 配置：`/etc/claude-code-sandbox/claude.env`（含 API Key，权限 600）
    - 用户数据：`/var/apps/claude-code-sandbox/home/.claude`（Claude 配置 / 会话）
    - 项目工作区：`/var/apps/claude-code-sandbox/home/workspace`
- **生命周期**：`cmd/main` 维护 PID 文件，支持 `start` / `stop` / `status`

## 目录结构

```
source/claude-code-sandbox/
├── manifest                    # 应用元数据（声明 nodejs_v22 依赖）
├── ICON.PNG (64x64)            # 包图标（应用商店展示）
├── ICON_256.PNG (256x256)      # 包图标大尺寸
├── app/
│   └── ui/
│       ├── config              # 桌面入口 JSON
│       └── images/
│           ├── icon_64.png
│           └── icon_256.png
├── cmd/
│   ├── main                    # start/stop/status（启动 ttyd）
│   ├── install_init            # 安装前预检
│   ├── install_callback        # 下载 ttyd + npm 装 Claude Code（v1.1.0 加 trap ERR）
│   ├── config_init             # 改配置前
│   ├── config_callback         # 改配置后重写 .env / settings.json
│   ├── upgrade_init / upgrade_callback    # 升级时 npm update
│   ├── uninstall_init          # 停服务 + shred 删除 .env
│   └── uninstall_callback      # fnpack 1.2.3 强制要求存在；逻辑由 init 完成
├── config/
│   ├── privilege               # 包用户 claude-code-sandbox
│   └── resource                # 共享目录 workspace
└── wizard/
    ├── install                 # 安装向导（password 字段收集 API Key）
    └── config                  # 修改配置向导
```

## 修改 / 重新打包

```bash
# 1. 克隆仓库
git clone https://github.com/djsevenx1/fnos-claude-code-sandbox.git
cd fnos-claude-code-sandbox

# 2. 一键打 x86_64 包
./build.sh x86_64
# 或 ./build.sh all  # 同时打 x86_64 + aarch64

# 输出在 dist/claude-code-sandbox_v1.1.0_x86_64.fpk
```

`build.sh` 自动拉取 fnpack 1.2.3（无需手动下载），并先跑 `validate.sh` 做 43 项离线预检。

## 故障排查

| 现象 | 排查 |
|---|---|
| 安装时提示"未检测到 nodejs_v22" | 应用中心先装 nodejs_v22 运行时 |
| 安装卡在"下载 ttyd" | 检查 NAS 能否访问 `github.com` |
| 安装卡在"安装 Claude Code" | `cat /var/apps/claude-code-sandbox/var/info.log` |
| Web 终端打不开 | 确认端口没被占用：`netstat -tlnp \| grep ${wizard_service_port}` |
| 启动后输入 `claude` 报 Node 错 | `ls /var/apps/nodejs_v22/target/bin/` 看 node 装好没 |
| 仍看到"执行脚本出错且原因未知" | 升级到 v1.1.0；旧版的 `set -e` 早崩 bug 已修 |

> 与 v1.0.0 相比，v1.1.0 修了一个用户特别痛的问题：
> 原版 `install_callback` 在 `set -e` 模式下若 `TRIM_TEMP_LOGFILE` 父目录不存在或 npm install stderr 被吞，**整段脚本在第 26 行 `log "Node.js: ..."` 就早崩**，没有任何 `TRIM_TEMP_LOGFILE` 兜底消息，所以 UI 显示"原因未知"。v1.1.0 在所有生命周期脚本里都加了：
> - `TRIM_TEMP_LOGFILE` 父目录预先 `mkdir -p`
> - `trap 'echo ... > $TRIM_TEMP_LOGFILE' ERR`
> - 每个 `die` 都先写 log 再 exit 1

## 协议

仅打包集成工具，不对 Claude Code 本身做任何修改。Claude Code 使用 Anthropic 自己的协议。
