#!/bin/bash
# Team TaskFlow Launcher Script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
echo "กำลังเปิดระบบจัดการงานทีม (Team TaskFlow)..."

# เปิดไฟล์ index.html บน macOS ใน Default Browser
if which open > /dev/null; then
    open "$DIR/index.html"
else
    # Fallback to python http server if needed
    echo "เปิดเซิร์ฟเวอร์ที่ http://localhost:8000"
    python3 -m http.server 8000 --directory "$DIR"
fi
