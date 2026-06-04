#!/bin/bash
# MikroLan Mobile App Deployment Script
# Run on VPS as root

set -e

echo "=== MikroLan Mobile App Deployment ==="

# 1. Create directory
echo "Creating /opt/mikrolan/mobile..."
mkdir -p /opt/mikrolan/mobile

# 2. Copy app.html
echo "Copying app.html..."
cp app.html /opt/mikrolan/mobile/app.html

# 3. Verify app.html exists
if [ ! -f /opt/mikrolan/mobile/app.html ]; then
    echo "ERROR: app.html not copied"
    exit 1
fi
echo "✓ app.html copied successfully"

# 4. Deploy systemd service
echo "Installing systemd service..."
cp mikrolan-mobile.service /etc/systemd/system/
chmod 644 /etc/systemd/system/mikrolan-mobile.service

# 5. Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

# 6. Enable service
echo "Enabling service..."
systemctl enable mikrolan-mobile.service

# 7. Start service
echo "Starting service..."
systemctl start mikrolan-mobile.service

# 8. Verify service
sleep 2
if systemctl is-active --quiet mikrolan-mobile.service; then
    echo "✓ Service is running"
else
    echo "ERROR: Service failed to start"
    systemctl status mikrolan-mobile.service
    exit 1
fi

# 9. Test endpoint
echo "Testing endpoint..."
if curl -s http://localhost:8080/app.html > /dev/null; then
    echo "✓ App is accessible at http://localhost:8080/app.html"
else
    echo "⚠ Warning: Could not verify endpoint"
fi

echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo "FINAL URL: http://149.28.232.230:8080/app.html"
echo ""
echo "Status: $(systemctl status mikrolan-mobile.service --no-pager | grep Active)"
echo "Check logs: journalctl -u mikrolan-mobile.service -f"
