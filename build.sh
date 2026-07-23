#!/usr/bin/env bash
# Claude Code 沙箱 - 一键打包
# 用法：
#   ./build.sh                # 打 x86_64
#   ./build.sh aarch64        # 临时改 manifest.platform=arm 打包
#   ./build.sh all            # 打 x86_64 + aarch64 两份
#
# 依赖：Linux/macOS + curl + sha256sum
# 输出：dist/claude-code-sandbox_<version>_<arch>.fpk
set -euo pipefail

VERSION="$(grep '^version=' source/claude-code-sandbox/manifest | cut -d= -f2)"
APPNAME="$(grep '^appname=' source/claude-code-sandbox/manifest | cut -d= -f2)"
TARGET="${1:-x86_64}"

FNPACK_VERSION="${FNPACK_VERSION:-1.2.3}"
FNPACK_BASE="https://static2.fnnas.com/fnpack"
FNPACK_BIN="fnpack-${FNPACK_VERSION}-linux-amd64"
FNPACK_URL="${FNPACK_BASE}/${FNPACK_BIN}"

DIST_DIR="dist"
WORK_DIR="build"
mkdir -p "$DIST_DIR" "$WORK_DIR"

# ------------------------------------------------------------
# 1. 下载 fnpack
# ------------------------------------------------------------
if [ ! -x "$WORK_DIR/fnpack" ]; then
    echo ">>> 下载 fnpack ${FNPACK_VERSION} ..."
    curl -#kL "$FNPACK_URL" -o "$WORK_DIR/fnpack"
    chmod +x "$WORK_DIR/fnpack"
fi
echo ">>> fnpack 版本: $($WORK_DIR/fnpack --version 2>/dev/null || echo 'unknown')"

# ------------------------------------------------------------
# 2. 离线校验（fnpack 1.2.3 没有 validate 子命令，用我们自己的）
# ------------------------------------------------------------
echo ">>> 离线校验 source 树 ..."
bash ./validate.sh ./source/claude-code-sandbox

# ------------------------------------------------------------
# 3. 打包
# ------------------------------------------------------------
build_one() {
    local arch="$1"
    local out="$DIST_DIR/${APPNAME}_v${VERSION}_${arch}.fpk"

    # 临时改 platform 字段；fnpack 1.2.3 不支持 --arch CLI 标志
    local orig
    orig="$(grep '^platform=' source/claude-code-sandbox/manifest)"
    trap 'sed -i "s|^platform=.*|$orig|" source/claude-code-sandbox/manifest' RETURN
    case "$arch" in
        x86_64)  sed -i 's|^platform=.*|platform=x86|'  source/claude-code-sandbox/manifest ;;
        aarch64) sed -i 's|^platform=.*|platform=arm|'  source/claude-code-sandbox/manifest ;;
    esac

    echo ">>> 打包 $arch -> $out"
    (
        cd "$WORK_DIR"
        ../"$WORK_DIR/fnpack" build --directory ../source/claude-code-sandbox
    )
    if [ -f "$WORK_DIR/${APPNAME}.fpk" ]; then
        mv "$WORK_DIR/${APPNAME}.fpk" "$out"
    else
        echo "❌ fnpack 没说输出文件在哪"
        exit 1
    fi
    ls -lh "$out"
    echo "    sha256: $(sha256sum "$out" | cut -d' ' -f1)"
}

case "$TARGET" in
    x86_64|aarch64) build_one "$TARGET" ;;
    all)
        build_one x86_64
        build_one aarch64
        ;;
    *) echo "Usage: $0 [x86_64|aarch64|all]"; exit 2 ;;
esac

echo ""
echo "✅ 打包完成。文件在 $DIST_DIR/"
ls -lh "$DIST_DIR"
