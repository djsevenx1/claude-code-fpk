#!/usr/bin/env bash
# Claude Code 沙箱 - 离线校验（不需要 fnpack，CI 友好）
# 校验：
#   1. 目录结构
#   2. JSON 合法
#   3. shell 脚本无语法错
#   4. ICON.PNG 是 64x64、ICON_256.PNG 是 256x256
#   5. manifest 必填字段
#   6. wizard 字段名与 cmd 脚本里引用的 wizard_* 变量对得上
set -euo pipefail
SRC="${1:-./source/claude-code-sandbox}"
ok=0; fail=0
check() { if "$@"; then echo "  ✅ $*"; ok=$((ok+1)); else echo "  ❌ $*"; fail=$((fail+1)); fi; }

echo "=== 1. 目录结构 ==="
for p in manifest ICON.PNG ICON_256.PNG \
         cmd/main cmd/install_init cmd/install_callback \
         cmd/upgrade_init cmd/upgrade_callback \
         cmd/uninstall_init cmd/uninstall_callback \
         cmd/config_init cmd/config_callback \
         cmd/lib/log.sh \
         config/privilege config/resource \
         app/ui/config app/ui/images/icon_64.png app/ui/images/icon_256.png \
         wizard/install wizard/config; do
    [ -e "$SRC/$p" ] && check true "$p 存在" || check false "$p 缺失"
done

echo "=== 2. JSON 合法 ==="
for f in $SRC/config/privilege $SRC/config/resource $SRC/app/ui/config $SRC/wizard/install $SRC/wizard/config; do
    [ -f "$f" ] && python3 -c "import json; json.load(open('$f'))" 2>/dev/null && check true "$f 合法 JSON" || check false "$f JSON 错"
done

echo "=== 3. shell 脚本无语法错 ==="
# lib/ 子目录里的共享脚本
for f in "$SRC/cmd/lib/log.sh"; do
    [ -f "$f" ] && bash -n "$f" 2>/dev/null && check true "$f bash -n OK" || check false "$f bash 语法错或缺失"
done
# cmd/ 顶层脚本
for f in "$SRC/cmd/main" "$SRC/cmd/install_init" "$SRC/cmd/install_callback" \
         "$SRC/cmd/upgrade_init" "$SRC/cmd/upgrade_callback" \
         "$SRC/cmd/uninstall_init" "$SRC/cmd/uninstall_callback" \
         "$SRC/cmd/config_init" "$SRC/cmd/config_callback"; do
    [ -f "$f" ] && bash -n "$f" 2>/dev/null && check true "$f bash -n OK" || check false "$f bash 语法错或缺失"
done

echo "=== 4. 图标尺寸 ==="
python3 - <<PY
from PIL import Image
import os, sys
def chk(path, w, h):
    try:
        im = Image.open(path); s = im.size
        if s == (w, h) and os.path.getsize(path) <= 1024*1024:
            print(f"  ✅ {path}  {s}  {os.path.getsize(path)//1024}KB")
        else:
            print(f"  ❌ {path} 期望 {w}x{h} 实际 {s}")
            sys.exit(1)
    except Exception as e:
        print(f"  ❌ {path}  {e}"); sys.exit(1)
chk("$SRC/ICON.PNG", 64, 64)
chk("$SRC/ICON_256.PNG", 256, 256)
chk("$SRC/app/ui/images/icon_64.png", 64, 64)
chk("$SRC/app/ui/images/icon_256.png", 256, 256)
PY
[ $? -eq 0 ] && ok=$((ok+1)) || fail=$((fail+1))

echo "=== 5. manifest 必填字段 ==="
for k in appname version display_name desc source platform os_min_version desktop_uidir service_port install_dep_apps; do
    grep -q "^${k}=" "$SRC/manifest" && check true "manifest.${k} 存在" || check false "manifest.${k} 缺失"
done

echo "=== 6. wizard_* 字段名一致性 ==="
# 提取所有 wizard/*.json 里所有 field 名
wizard_fields=$(python3 -c "
import json, glob
fields = set()
for f in sorted(glob.glob('$SRC/wizard/*')):
    try:
        w = json.load(open(f))
        for step in w:
            for item in step.get('items', []):
                f = item.get('field')
                if f: fields.add(f)
    except Exception:
        pass
print(' '.join(sorted(fields)))
")
echo "  wizard 字段: $wizard_fields"
# 提取 cmd 脚本里所有 $wizard_xxx 引用
referenced=$(grep -rohE '\$\{?wizard_[a-zA-Z0-9_]+' $SRC/cmd | sed -E 's/[\$\{]//g' | sort -u)
echo "  cmd 引用:   $referenced"
missing=$(comm -23 <(echo "$referenced" | tr ' ' '\n') <(echo "$wizard_fields" | tr ' ' '\n') | grep -v '^$' || true)
if [ -z "$missing" ]; then
    check true "所有 wizard 引用都已在 wizard/install 中声明"
else
    check false "cmd 引用了但 wizard 未声明: $missing"
fi

echo ""
echo "=== 总结 ==="
echo "  通过: $ok    失败: $fail"
[ $fail -eq 0 ]
