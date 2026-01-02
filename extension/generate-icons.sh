#!/bin/bash
# 生成扩展图标
# 需要安装 ImageMagick: sudo apt install imagemagick

cd "$(dirname "$0")/icons"

if command -v convert &> /dev/null; then
    convert -background none -resize 16x16 icon.svg icon16.png
    convert -background none -resize 32x32 icon.svg icon32.png
    convert -background none -resize 48x48 icon.svg icon48.png
    convert -background none -resize 128x128 icon.svg icon128.png
    echo "图标生成完成！"
elif command -v rsvg-convert &> /dev/null; then
    rsvg-convert -w 16 -h 16 icon.svg -o icon16.png
    rsvg-convert -w 32 -h 32 icon.svg -o icon32.png
    rsvg-convert -w 48 -h 48 icon.svg -o icon48.png
    rsvg-convert -w 128 -h 128 icon.svg -o icon128.png
    echo "图标生成完成！"
else
    echo "请安装 ImageMagick 或 librsvg:"
    echo "  Ubuntu/Debian: sudo apt install imagemagick"
    echo "  或: sudo apt install librsvg2-bin"
fi
