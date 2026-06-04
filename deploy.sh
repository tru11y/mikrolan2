#!/bin/bash
set -e

echo "=== MikroLan Mobile App Deployment ==="

# 1. Create /opt/mikrolan if not exists
mkdir -p /opt/mikrolan

# 2. Copy app.html
cat > /opt/mikrolan/app.html << 'APPHTML'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MikroLan - Router Onboarding</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            width: 100%;
            max-width: 500px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px 20px;
            text-align: center;
        }
        .header h1 {
            font-size: 28px;
            margin-bottom: 8px;
        }
        .header p {
            font-size: 14px;
            opacity: 0.9;
        }
        .content {
            padding: 30px 20px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            font-weight: 500;
            margin-bottom: 8px;
            color: #333;
            font-size: 14px;
        }
        input, select, textarea {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            font-family: inherit;
            transition: border-color 0.3s;
        }
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        textarea {
            resize: vertical;
            min-height: 80px;
            font-family: 'Courier New', monospace;
        }
        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 30px;
        }
        button {
            flex: 1;
            padding: 14px;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }
        .btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .btn-secondary {
            background: #f0f0f0;
            color: #333;
        }
        .btn-secondary:hover:not(:disabled) {
            background: #e0e0e0;
        }
        .status-section {
            margin-top: 30px;
            padding-top: 30px;
            border-top: 1px solid #eee;
        }
        .status-item {
            padding: 12px;
            margin-bottom: 10px;
            border-radius: 6px;
            font-size: 13px;
        }
        .status-pending {
            background: #fff3cd;
            color: #856404;
            border-left: 4px solid #ffc107;
        }
        .status-success {
            background: #d4edda;
            color: #155724;
            border-left: 4px solid #28a745;
        }
        .status-error {
            background: #f8d7da;
            color: #721c24;
            border-left: 4px solid #dc3545;
        }
        .status-progress {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid #ffc107;
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .logs {
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 12px;
            margin-top: 15px;
            max-height: 200px;
            overflow-y: auto;
            font-size: 12px;
            font-family: 'Courier New', monospace;
            color: #333;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .log-entry {
            margin-bottom: 4px;
        }
        .log-time {
            color: #999;
        }
        .alert {
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 15px;
            display: none;
        }
        .alert.show {
            display: block;
        }
        .alert-error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .alert-success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .tabs {
            display: flex;
            border-bottom: 1px solid #ddd;
            margin-bottom: 20px;
            gap: 0;
        }
        .tab-btn {
            flex: 1;
            padding: 15px;
            border: none;
            background: white;
            border-bottom: 3px solid transparent;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            color: #666;
            transition: all 0.3s;
        }
        .tab-btn.active {
            color: #667eea;
            border-bottom-color: #667eea;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .router-item {
            padding: 12px;
            background: #f9f9f9;
            border-radius: 6px;
            margin-bottom: 10px;
            border-left: 4px solid #667eea;
        }
        .router-item h3 {
            margin-bottom: 5px;
            color: #333;
        }
        .router-item p {
            margin: 3px 0;
            font-size: 12px;
            color: #666;
        }
        .state-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: 600;
            margin-top: 5px;
        }
        .state-new { background: #e3f2fd; color: #1976d2; }
        .state-api-ok { background: #e1f5fe; color: #0277bd; }
        .state-wg-ready { background: #f3e5f5; color: #6a1b9a; }
        .state-tunnel-up { background: #fce4ec; color: #c2185b; }
        .state-locked { background: #fff3e0; color: #e65100; }
        .state-done { background: #e8f5e9; color: #2e7d32; }
        .state-error { background: #ffebee; color: #c62828; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 MikroLan</h1>
            <p>Router Onboarding System</p>
        </div>
        <div class="content">
            <div class="tabs">
                <button class="tab-btn active" onclick="switchTab('onboard')">Onboard Router</button>
                <button class="tab-btn" onclick="switchTab('status')">Status</button>
            </div>

            <div id="onboard" class="tab-content active">
                <div id="alert" class="alert"></div>
                <form id="onboardForm" onsubmit="submitForm(event)">
                    <div class="form-group">
                        <label for="routerId">Router ID</label>
                        <input type="text" id="routerId" placeholder="e.g., router-001" required>
                    </div>

                    <div class="form-group">
                        <label for="routerIp">Router IP Address</label>
                        <input type="text" id="routerIp" placeholder="e.g., 192.168.1.1" required>
                    </div>

                    <div class="form-group">
                        <label for="routerUser">Username</label>
                        <input type="text" id="routerUser" placeholder="e.g., admin" required>
                    </div>

                    <div class="form-group">
                        <label for="routerPass">Password</label>
                        <input type="password" id="routerPass" placeholder="Router password" required>
                    </div>

                    <div class="form-group">
                        <label for="vpnMode">VPN Mode</label>
                        <select id="vpnMode" required>
                            <option value="">Select VPN Mode</option>
                            <option value="wireguard">WireGuard</option>
                            <option value="openvpn">OpenVPN</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="config">Configuration (JSON)</label>
                        <textarea id="config" placeholder='{"key": "value"}' required></textarea>
                    </div>

                    <div class="button-group">
                        <button type="submit" class="btn-primary" id="submitBtn">Start Onboarding</button>
                        <button type="reset" class="btn-secondary">Clear</button>
                    </div>
                </form>

                <div class="status-section">
                    <h3>Onboarding Status</h3>
                    <div id="status"></div>
                </div>
            </div>

            <div id="status" class="tab-content">
                <div id="statusList"></div>
                <button class="btn-primary" onclick="loadAllStatus()" style="width: 100%; margin-top: 20px;">Refresh Status</button>
            </div>
        </div>
    </div>

    <script>
        const API_URL = 'http://149.28.232.230:8000';

        function switchTab(tab) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(tab).classList.add('active');
            event.target.classList.add('active');
            if (tab === 'status') {
                loadAllStatus();
            }
        }

        function showAlert(message, type) {
            const alert = document.getElementById('alert');
            alert.textContent = message;
            alert.className = `alert show alert-${type}`;
            setTimeout(() => alert.classList.remove('show'), 5000);
        }

        async function submitForm(event) {
            event.preventDefault();
            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.textContent = 'Submitting...';

            try {
                const formData = {
                    router_id: document.getElementById('routerId').value,
                    router_ip: document.getElementById('routerIp').value,
                    username: document.getElementById('routerUser').value,
                    password: document.getElementById('routerPass').value,
                    vpn_mode: document.getElementById('vpnMode').value,
                    config: JSON.parse(document.getElementById('config').value)
                };

                const response = await fetch(`${API_URL}/routers/onboard`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                if (!response.ok) {
                    const error = await response.json();
                    showAlert(`Error: ${error.detail || 'Failed to start onboarding'}`, 'error');
                } else {
                    const data = await response.json();
                    showAlert(`Onboarding started for ${data.router_id}`, 'success');
                    document.getElementById('onboardForm').reset();
                    pollStatus(formData.router_id);
                }
            } catch (error) {
                showAlert(`Error: ${error.message}`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Start Onboarding';
            }
        }

        async function pollStatus(routerId) {
            const statusDiv = document.getElementById('status');
            statusDiv.innerHTML = '<div class="status-item status-pending"><div class="status-progress"><div class="spinner"></div>Checking status...</div></div>';

            try {
                const response = await fetch(`${API_URL}/routers/${routerId}/status`);
                if (!response.ok) throw new Error('Failed to fetch status');

                const data = await response.json();
                renderStatus(data);
            } catch (error) {
                statusDiv.innerHTML = `<div class="status-item status-error">Error: ${error.message}</div>`;
            }
        }

        function renderStatus(data) {
            const statusDiv = document.getElementById('status');
            statusDiv.innerHTML = '';

            const stateElement = document.createElement('div');
            const stateClass = `state-${data.state.toLowerCase().replace(/_/g, '-')}`;
            stateElement.className = `state-badge ${stateClass}`;
            stateElement.textContent = data.state;

            const statusHtml = `
                <div class="status-item">
                    <strong>Router ID:</strong> ${data.router_id}<br>
                    <strong>State:</strong> ${stateElement.outerHTML}<br>
                    <strong>Progress:</strong> ${data.progress || '0%'}
                </div>
            `;

            statusDiv.innerHTML = statusHtml;

            if (data.logs && data.logs.length > 0) {
                const logsHtml = '<div class="logs">' + data.logs.map((log, i) =>
                    `<div class="log-entry"><span class="log-time">[${i}]</span> ${escapeHtml(log)}</div>`
                ).join('') + '</div>';
                statusDiv.innerHTML += logsHtml;
            }

            if (data.error) {
                const retryBtn = `<button class="btn-primary" onclick="retryOnboarding('${data.router_id}')" style="width: 100%; margin-top: 10px;">Retry Onboarding</button>`;
                statusDiv.innerHTML += `<div class="status-item status-error">Error: ${escapeHtml(data.error)}</div>${retryBtn}`;
            }

            if (data.state === 'DONE') {
                statusDiv.innerHTML += '<div class="status-item status-success">✓ Onboarding completed successfully!</div>';
            }
        }

        async function retryOnboarding(routerId) {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = 'Retrying...';

            try {
                const response = await fetch(`${API_URL}/routers/${routerId}/retry`, {
                    method: 'POST'
                });

                if (!response.ok) throw new Error('Failed to retry');

                showAlert('Retry started', 'success');
                pollStatus(routerId);
            } catch (error) {
                showAlert(`Error: ${error.message}`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Retry Onboarding';
            }
        }

        async function loadAllStatus() {
            const statusList = document.getElementById('statusList');
            statusList.innerHTML = '<div class="status-item status-pending"><div class="status-progress"><div class="spinner"></div>Loading routers...</div></div>';

            try {
                const response = await fetch(`${API_URL}/routers`);
                if (!response.ok) throw new Error('Failed to fetch routers');

                const routers = await response.json();
                if (!routers.length) {
                    statusList.innerHTML = '<div class="status-item">No routers found</div>';
                    return;
                }

                statusList.innerHTML = routers.map(router => `
                    <div class="router-item">
                        <h3>${router.router_id}</h3>
                        <p><strong>IP:</strong> ${router.router_ip}</p>
                        <p><strong>VPN Mode:</strong> ${router.vpn_mode}</p>
                        <span class="state-badge state-${router.state.toLowerCase().replace(/_/g, '-')}">${router.state}</span>
                        <button class="btn-primary" onclick="viewRouterDetail('${router.router_id}')" style="width: 100%; margin-top: 10px;">View Details</button>
                    </div>
                `).join('');
            } catch (error) {
                statusList.innerHTML = `<div class="status-item status-error">Error: ${error.message}</div>`;
            }
        }

        async function viewRouterDetail(routerId) {
            const response = await fetch(`${API_URL}/routers/${routerId}/status`);
            if (!response.ok) {
                showAlert('Failed to fetch details', 'error');
                return;
            }
            const data = await response.json();
            renderStatus(data);
            switchTab('onboard');
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>
APPHTML

# 3. Install and configure nginx
apt-get update -qq
apt-get install -y nginx > /dev/null 2>&1

# 4. Create nginx server block
cat > /etc/nginx/sites-available/mikrolan << 'NGINXCONF'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    root /opt/mikrolan;
    index app.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location = /app.html {
        expires -1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    error_page 404 /app.html;
}
NGINXCONF

# 5. Enable site (create symlink if not exists)
if [ ! -L /etc/nginx/sites-enabled/mikrolan ]; then
    ln -s /etc/nginx/sites-available/mikrolan /etc/nginx/sites-enabled/mikrolan
fi

# 6. Disable default site
rm -f /etc/nginx/sites-enabled/default

# 7. Test nginx config
nginx -t > /dev/null 2>&1 || {
    echo "ERROR: nginx config test failed"
    exit 1
}

# 8. Start/restart nginx
systemctl restart nginx
systemctl enable nginx

# 9. Verify
sleep 1
if systemctl is-active --quiet nginx; then
    echo "✓ nginx running"
else
    echo "✗ nginx failed to start"
    exit 1
fi

echo "=== Deployment Complete ==="
echo "Mobile app: http://149.28.232.230/"
