#!/bin/bash
set -e

# Start virtual framebuffer (for GUI installers that need a display)
Xvfb :99 -screen 0 1024x768x16 &
XVFB_PID=$!

# Wait briefly for Xvfb to initialize
sleep 1

# If an installer exists at /sandbox/installer.exe, run it via Wine
if [ -f /sandbox/installer.exe ]; then
    echo "[BigBrother] Running installer: /sandbox/installer.exe"
    wine /sandbox/installer.exe
    EXIT_CODE=$?
    echo "[BigBrother] Installer exited with code: $EXIT_CODE"
else
    echo "[BigBrother] No installer found at /sandbox/installer.exe"
    EXIT_CODE=1
fi

# Clean up Xvfb
kill $XVFB_PID 2>/dev/null || true

exit $EXIT_CODE
