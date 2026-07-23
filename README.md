# Claude Code 沙箱 for 飞牛 fnOS

把 [Anthropic Claude Code](https://github.com/anthropics/claude-code) CLI 装到飞牛 NAS 上，原生运行（不依赖 Docker），通过 Web 终端（ttyd）访问。

参考了飞牛官方 OpenClaw（小龙虾）以及社区 [Hermes Agent](https://github.com/iranee/fnos-hermes-agent) 的应用结构。

## 下载

| 文件 | 用途 |
|---|---|
| `claude-code-sandbox-native_v1.0.0_x86.fpk` | **原生 FPK**（推荐），依赖应用商店的 `nodejs_v22` 运行时 |
| `claude-code-sandbox_v1.0.0_x86.fpk` | Docker 版 FPK（无需应用商店依赖，但需 Docker） |

## 安装

### 前置

- 飞牛 fnOS >= 0.9.27，**x86_64** 架构
- 应用中心能正常装应用（即应用商店连通）
- NAS 能访问 `github.com`（下 ttyd）和 `registry.npmmirror.com`（装 Claude Code）

### 步骤

1. **应用中心 -> 手动安装 -> 选 `.fpk` 文件**
2. 系统检测到 `install_dep_apps=nodejs_v22` -> 弹出提示，**确认安装 nodejs_v22**（约 1-2 分钟）
3. 回到 Claude Code 安装向导：
   - 建议设置 Web 终端用户名 / 密码
   - 填入 API Key（Anthropic 官方 / 第三方代理）或留空后续在容器内执行 `claude /login`
4. **等待首次安装**：`install_callback` 会下载 ttyd + 通过 npm 装 Claude Code（约 1-3 分钟）
5. 桌面点 **Claude Code 沙箱** 图标 -> Web 终端打开
6. 终端里输入 `claude` 进入 Claude Code TUI

## 架构

```
fnOS 桌面图标 -> cmd/main -> ttyd (7681) -> bash 终端
                                    |
                                    v
                            claude (npm 安装到应用目录)
                                    |
                                    v
                            ~/.claude/settings.json (API Key 等)
```

- **依赖**：`install_dep_apps=nodejs_v22`（fnOS 应用商店自动装）
- **运行时**：Node.js v22 + ttyd 1.7.7（应用目录静态二进制）+ Claude Code CLI（npm）
- **沙箱**：Claude Code 进程以应用专属用户运行，非 root，仅能访问授权目录
- **持久化**：
  - 配置：`/etc/claude-code-sandbox/claude.env`（含 API Key，权限 600）
  - 用户数据：`/var/apps/claude-code-sandbox/home/.claude`（Claude 配置 / 会话）
  - 项目工作区：`/var/apps/claude-code-sandbox/home/workspace`
- **生命周期**：`cmd/main` 维护 PID 文件，支持 start / stop / status

## 目录结构

```
claude-code-native/
|-- manifest                          # 应用元数据（声明 nodejs_v22 依赖）
|-- ICON.PNG / ICON_256.PNG           # 包图标
|-- app/
|   `-- ui/
|       |-- config                    # Web 终端入口（iframe -> ttyd :7681）
|       `-- images/icon_{64,256}.png
|-- cmd/
|   |-- main                          # start/stop/status（启动 ttyd）
|   |-- install_init                  # 安装前预检
|   |-- install_callback              # 下载 ttyd + npm 装 Claude Code
|   |-- config_init                   # 修改配置前
|   |-- config_callback               # 修改配置后重写 .env / settings.json
|   |-- upgrade_init / upgrade_callback # 升级时 npm update
|   `-- uninstall_init / uninstall_callback # 卸载清理 .env
|-- config/
|   |-- privilege                     # 包用户 claude-code-sandbox
|   `-- resource                      # 共享目录定义
`-- wizard/
    |-- install                       # 安装向导（API Key 等）
    `-- config                        # 修改配置向导
```

## 修改 / 重新打包

```bash
# 1. 安装 fnpack
curl -#kL https://static2.fnnas.com/fnpack/fnpack-1.0.4-linux-amd64 -o fnpack
chmod +x fnpack

# 2. 在 source 目录改文件

# 3. 打包
./fnpack build --directory ./claude-code-native
```

## 注意事项

- 国内使用建议在向导里填写 `ANTHROPIC_BASE_URL`（如 aicodemirror / 阿里云百炼 / DeepSeek 等第三方代理）
- API Key 不会上传到任何地方，仅保存在 NAS 本地的 `.env`（权限 600）
- 卸载时 `uninstall_callback` 会用 `shred` 安全删除 `.env`
- 默认端口 `7681`，建议在向导里改掉以减少被扫描的风险

## 故障排查

| 现象 | 排查 |
|---|---|
| 安装时提示"未检测到 nodejs_v22" | 应用中心先装 nodejs_v22 运行时 |
| 安装卡在"下载 ttyd" | 检查 NAS 能否访问 `github.com` |
| 安装卡在"安装 Claude Code" | `cat /var/apps/claude-code-sandbox/var/info.log` |
| Web 终端打不开 | 确认端口 7681 没被占用，桌面图标跳转地址对不对 |
| 启动后输入 `claude` 报 Node 错 | `ls /var/apps/nodejs_v22/target/bin/` 看 node 装好没 |

## 协议

仅打包集成工具，不对 Claude Code 本身做任何修改。Claude Code 使用 Anthropic 自己的协议。
