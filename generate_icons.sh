#!/bin/bash
set -e

SOURCE="public/icon_source.jpg"
ICONSET="public/icon.iconset"
mkdir -p "$ICONSET"

# Function to resize and set format
resize() {
  sips -z $1 $1 -s format png "$SOURCE" --out "$ICONSET/$2"
}

# Generate all required sizes
resize 16 "icon_16x16.png"
resize 32 "icon_16x16@2x.png"
resize 32 "icon_32x32.png"
resize 64 "icon_32x32@2x.png"
resize 128 "icon_128x128.png"
resize 256 "icon_128x128@2x.png"
resize 256 "icon_256x256.png"
resize 512 "icon_256x256@2x.png"
resize 512 "icon_512x512.png"
resize 1024 "icon_512x512@2x.png"

# Create .icns
iconutil -c icns "$ICONSET" -o "public/icon.icns"

# Generate Windows .ico
# ffmpeg can handle this. Using a basic 256x256 ico.
./ffmpeg-bin/mac/ffmpeg -i "$SOURCE" -vf scale=256:256 -y "public/icon.ico"

# Create a standard png for other uses
sips -s format png "$SOURCE" --out "public/icon.png"

# Cleanup
rm -rf "$ICONSET"
rm "public/icon_source.jpg"

echo "Icons generated successfully!"
