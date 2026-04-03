#!/bin/bash
set -e
mkdir -p assets/icons/icon.iconset
cp assets/icons/16x16.png   assets/icons/icon.iconset/icon_16x16.png
cp assets/icons/32x32.png   assets/icons/icon.iconset/icon_16x16@2x.png
cp assets/icons/32x32.png   assets/icons/icon.iconset/icon_32x32.png
cp assets/icons/64x64.png   assets/icons/icon.iconset/icon_32x32@2x.png
cp assets/icons/128x128.png assets/icons/icon.iconset/icon_128x128.png
cp assets/icons/256x256.png assets/icons/icon.iconset/icon_128x128@2x.png
cp assets/icons/256x256.png assets/icons/icon.iconset/icon_256x256.png
cp assets/icons/512x512.png assets/icons/icon.iconset/icon_256x256@2x.png
cp assets/icons/512x512.png assets/icons/icon.iconset/icon_512x512.png
cp assets/icons/1024x1024.png assets/icons/icon.iconset/icon_512x512@2x.png
iconutil -c icns assets/icons/icon.iconset -o assets/icons/icon.icns
echo "✓ assets/icons/icon.icns generated"
