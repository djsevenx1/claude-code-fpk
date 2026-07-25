#!/usr/bin/env bash
# Claude Code 沙箱 - GitHub release 上传
# 用法：GH_TOKEN=ghp_xxx ./github-release.sh v1.3.0
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN 未设置}"
REPO_OWNER="djsevenx1"
REPO_NAME="claude-code-sandbox"
TAG="${1:-v1.3.0}"
VERSION="${TAG#v}"

DIST_DIR="$(cd "$(dirname "${0}")" && pwd)/dist"
FPK_X86="${DIST_DIR}/claude-code-sandbox_v${VERSION}_x86_64.fpk"
FPK_ARM="${DIST_DIR}/claude-code-sandbox_v${VERSION}_aarch64.fpk"
SHA_FILE="${DIST_DIR}/claude-code-sandbox_v${VERSION}_SHA256SUMS"

# 准备 sha256
{
    [ -f "$FPK_X86" ] && sha256sum "$FPK_X86"
    [ -f "$FPK_ARM" ] && sha256sum "$FPK_ARM"
} > "$SHA_FILE"
echo ">>> SHA256SUMS:"
cat "$SHA_FILE"

API="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}"
AUTH=(-H "Authorization: token ${GH_TOKEN}" -H "Accept: application/vnd.github+json")

# 1. 确保仓库存在
echo ">>> 检查仓库 ${REPO_OWNER}/${REPO_NAME} ..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "${API}")
if [ "$HTTP_CODE" = "404" ]; then
    echo ">>> 仓库不存在，创建 ..."
    curl -sf -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
        -d '{"name":"'"${REPO_NAME}"'","description":"Claude Code 沙箱 for 飞牛 fnOS（FPK 原生包）","private":false,"auto_init":true}' \
        "https://api.github.com/user/repos" || echo "  (创建仓库可能需要额外权限，跳过)"
elif [ "$HTTP_CODE" = "200" ]; then
    echo ">>> 仓库已存在"
else
    echo "  HTTP $HTTP_CODE，继续 ..."
fi

# 2. 创建 release (或拿已存在的)
echo ">>> 创建 release ${TAG} ..."
REL_JSON=$(curl -sf -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
    -d "$(cat <<JSON
{
  "tag_name": "${TAG}",
  "name": "Claude Code 沙箱 v${VERSION}",
  "body": $(python3 -c "import json,sys; print(json.dumps(open('CHANGELOG_NOTES.md').read() if False else '''## v${VERSION}\n\nFPK 原生包，飞牛 fnOS 上以包用户 + 工作目录隔离方式沙箱运行 Claude Code CLI。\n\n### 主要特性\n- Web 终端 (ttyd) + Web 控制台 (management-api)\n- 运行时下载 ttyd + npm 装 claude-code\n- 多镜像源重试（npmmirror / 腾讯云 / npmjs.org）\n- 详细诊断日志 (info.log + diag_to_user)\n\n### 安装\n1. fnOS 应用中心 → 手动安装 → 选 .fpk\n2. 装好后桌面会出现 **Claude Code 沙箱** + **Claude Code · 控制台** 两个图标\n3. 控制台端口 7682（仅 loopback），与 Web 终端 7681 共用 .env 鉴权\n\n详见仓库 README。'))"),
  "draft": false,
  "prerelease": false
}
JSON
)" "${API}/releases" 2>/dev/null || true)

# 拿 release id / upload_url
RELEASE_ID=$(echo "$REL_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
UPLOAD_URL=$(echo "$REL_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('upload_url',''))" 2>/dev/null || true)

if [ -z "$RELEASE_ID" ]; then
    # 查已存在的 release
    echo ">>> 获取已存在的 release ..."
    REL_JSON=$(curl -sf "${AUTH[@]}" "${API}/releases/tags/${TAG}")
    RELEASE_ID=$(echo "$REL_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
    UPLOAD_URL=$(echo "$REL_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('upload_url',''))")
fi

if [ -z "$RELEASE_ID" ]; then
    echo "❌ 没拿到 release id"
    echo "REL_JSON: $REL_JSON" | head -c 500
    exit 1
fi
echo ">>> release_id=$RELEASE_ID"

# 3. 上传 FPK 和 SHA256SUMS
upload() {
    local file="$1"
    [ -f "$file" ] || { echo "  skip: $file (不存在)"; return 0; }
    local name; name="$(basename "$file")"
    echo ">>> 上传 $name ($(du -h "$file" | cut -f1)) ..."
    curl -sf "${AUTH[@]}" -H "Content-Type: application/octet-stream" \
        --data-binary "@${file}" \
        "${UPLOAD_URL}?name=${name}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  ✅', d.get('browser_download_url','?'))"
}

upload "$FPK_X86"
upload "$FPK_ARM"
upload "$SHA_FILE"

echo ""
echo "✅ 发布完成: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${TAG}"
