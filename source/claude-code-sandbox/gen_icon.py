#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 Anthropic Claude Code 官方 4 角 sparkle 图标。

形态：4 角细长 sparkle（top/right/bottom/left 四个尖角 + 4 个深凹槽）。
颜色：coral #D97757 on 深蓝 #18182F。
"""
import math
import os
from PIL import Image, ImageDraw

# Anthropic 品牌色
BG = (24, 24, 47, 255)          # 深蓝紫底 #18182F
SPARK = (217, 119, 87, 255)     # coral / Claude orange #D97757


def sparkle_icon(size: int) -> Image.Image:
    """画一个 4 角 sparkle（官方 Claude Code logo 形态）。"""
    # 抗锯齿：超采样
    s = size * 8
    img = Image.new('RGBA', (s, s), BG)
    draw = ImageDraw.Draw(img)

    cx = cy = s / 2
    R_outer = s * 0.46   # 尖角到中心
    R_inner = s * 0.085  # 凹槽到中心（控制胖瘦，越小越瘦）

    # 8 个顶点交替：4 尖 + 4 凹
    pts = []
    for i in range(8):
        # 顺序：上尖 -> 右上凹 -> 右尖 -> 右下凹 -> 下尖 -> 左下凹 -> 左尖 -> 左上凹
        ang = math.radians(i * 45 - 90)
        r = R_outer if i % 2 == 0 else R_inner
        x = cx + r * math.cos(ang)
        y = cy + r * math.sin(ang)
        pts.append((x, y))

    # 直线多边形，凹槽尖锐（符合 Anthropic logo 风格）
    draw.polygon(pts, fill=SPARK)

    return img.resize((size, size), Image.LANCZOS)


def main():
    out_dir = '/workspace/claude-code-fpk/upload-pkg/source/claude-code-sandbox'
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.join(out_dir, 'app', 'ui', 'images'), exist_ok=True)

    # 包图标 (FPK 用的 ICON.PNG / ICON_256.PNG)
    sparkle_icon(64).save(os.path.join(out_dir, 'ICON.PNG'))
    sparkle_icon(256).save(os.path.join(out_dir, 'ICON_256.PNG'))

    # UI 入口图标
    sparkle_icon(64).save(os.path.join(out_dir, 'app', 'ui', 'images', 'icon_64.png'))
    sparkle_icon(256).save(os.path.join(out_dir, 'app', 'ui', 'images', 'icon_256.png'))

    print('OK ->', out_dir)


if __name__ == '__main__':
    main()
