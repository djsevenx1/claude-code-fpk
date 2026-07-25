#!/bin/bash
# Claude Code 沙箱 - 共享日志模块
# 所有 cmd/* 脚本 source 此文件，统一日志到 ${TRIM_PKGVAR}/info.log
#
# 设计参照 OpenClaw（oc-deploy v1.2.3）：
#   - 单一 info.log，避免 main/ttyd.log + install.log 两份文件难追
#   - TRIM_TEMP_LOGFILE 失败时塞"可执行诊断"（环境探测 + 关键路径 + 最近日志）
#
# 用法（在 cmd/foo 脚本顶部）：
#   _LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/lib"
#   [ -f "${_LIB_DIR}/log.sh" ] && source "${_LIB_DIR}/log.sh"
#
# 暴露函数：
#   log_msg  <msg>           追加一行到 info.log
#   log_kv   <key> <val>     追加 "key=val"（隐藏值尾部）
#   diag_to_user <标题> <原因>  把可执行诊断写到 TRIM_TEMP_LOGFILE
#                              （fnOS 会展示给用户），然后 exit 1

# 统一日志：所有阶段都写这一个文件
LOG_FILE="${TRIM_PKGVAR:-/tmp/claude-code-sandbox}/info.log"
mkdir -p "$(dirname "${LOG_FILE}")" 2>/dev/null || true

# 写到 TRIM_TEMP_LOGFILE 的失败横幅前缀
_USER_BANNER="========================================"

# log_msg <msg>
# 追加一行带时间戳的日志。静默失败，避免再触发 die 链路。
log_msg() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "${LOG_FILE}" 2>/dev/null || true
}

# log_kv <key> <val>
# 记录 key=val，val 末尾超过 8 个字符的部分用 **** 遮罩（API Key 不会裸进日志）
log_kv() {
    local k="$1" v="$2"
    if [ "${#v}" -gt 8 ]; then
        v="${v:0:4}****${v: -4}"
    elif [ -n "$v" ]; then
        v="****"
    fi
    log_msg "${k}=${v}"
}

# diag_to_user <short_title> <cause>
# 失败时把"短标题 + 原因 + 关键路径探测 + 最近 50 行日志"打包写到
# TRIM_TEMP_LOGFILE，fnOS 会把它展示给用户。然后 exit 1。
#
# 关键设计（学 OpenClaw install_callback）：
#   - 用户看到的不是一行字，而是"为什么 + 怎么自查"的可执行信息
#   - 完整日志路径写出来，用户能 SSH 进去 cat
diag_to_user() {
    local title="$1" cause="$2"

    {
        echo "${_USER_BANNER}"
        echo "Claude Code ${title}"
        echo "${_USER_BANNER}"
        echo ""
        echo "【时间】$(date '+%Y-%m-%d %H:%M:%S')"
        echo ""
        echo "【失败原因】"
        echo "  ${cause}"
        echo ""
        echo "【关键路径探测】"
        printf '  TRIM_APPNAME      = %s\n' "${TRIM_APPNAME:-<unset>}"
        printf '  TRIM_APPDEST      = %s\n' "${TRIM_APPDEST:-<unset>}"
        printf '  TRIM_PKGETC       = %s\n' "${TRIM_PKGETC:-<unset>}"
        printf '  TRIM_PKGVAR       = %s\n' "${TRIM_PKGVAR:-<unset>}"
        printf '  TRIM_PKGHOME      = %s\n' "${TRIM_PKGHOME:-<unset>}"
        printf '  TRIM_USERNAME     = %s\n' "${TRIM_USERNAME:-<unset>}"
        printf '  nodejs_v22 node   = %s\n' "$(command -v node 2>/dev/null || echo '<not found>')"
        if command -v node >/dev/null 2>&1; then
            printf '  node version      = %s\n' "$(node --version 2>/dev/null || echo '<failed>')"
        fi
        printf '  python3           = %s\n' "$(command -v python3 2>/dev/null || echo '<not found>')"
        echo ""
        echo "【可能原因 / 自查步骤】"
        case "${title}" in
            *安装*|*预检*)
                echo "  1. 打开 fnOS 应用中心 → 搜索 'nodejs_v22' → 点安装"
                echo "  2. 装好后回到 Claude Code → 点重装"
                echo "  3. 若仍失败，把下面完整日志贴 issue 或截图发给我"
                ;;
            *启动*|*停止*)
                echo "  1. SSH 进 NAS 执行：bash /var/apps/${TRIM_APPNAME:-claude-code-sandbox}/cmd/main status"
                echo "  2. 看端口 7681 是否被占用：ss -ltn | grep 7681"
                echo "  3. 强制清残留：pkill -9 -f ttyd ; pkill -9 -f claude"
                echo "  4. 然后再点启动"
                ;;
            *)
                echo "  1. 看下面完整日志定位"
                echo "  2. 必要时 SSH 进 NAS：cat ${LOG_FILE}"
                ;;
        esac
        echo ""
        if [ -f "${LOG_FILE}" ]; then
            echo "【info.log 最后 50 行】"
            tail -n 50 "${LOG_FILE}"
            echo ""
            echo "完整日志: ${LOG_FILE}"
        else
            echo "(info.log 还没生成: ${LOG_FILE})"
        fi
    } > "${TRIM_TEMP_LOGFILE}" 2>/dev/null || true

    log_msg "FATAL (${title}): ${cause}"
    exit 1
}
