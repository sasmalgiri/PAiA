#!/bin/bash
#
# PAiA license server — one-shot deploy script for Ubuntu 22.04+ / Debian 12+.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/sasmalgiri/PAiA/main/paia-electron/server/deploy/install.sh | sudo bash -s -- license.paia.app
#
# Or, after cloning the repo:
#   sudo bash server/deploy/install.sh license.paia.app
#
# Arguments:
#   $1 — the FQDN this server will respond on (must already point at this
#         machine's IP via DNS)
#
# This script installs Node 20, nginx, certbot, creates a `paia` system
# user, drops the server code into /opt/paia-license, sets up systemd,
# nginx vhost, and Let's Encrypt SSL.
#
# It does NOT populate the .env file — you must edit
# /etc/paia-license/.env with your real secrets and then restart the
# service:
#
#   sudo systemctl restart paia-license

set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <domain>"
  echo "Example: $0 license.paia.app"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (or with sudo)"
  exit 1
fi

echo "═══ PAiA license server installer ═══"
echo "Target domain: $DOMAIN"
echo

# ── 1. Install dependencies ─────────────────────────────────────
echo "[1/7] Installing dependencies…"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg nginx certbot python3-certbot-nginx >/dev/null

# Node 20 from Nodesource
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1)" != "v20" && "$(node -v | cut -d. -f1)" != "v22" ]]; then
  echo "[1/7] Installing Node 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs >/dev/null
fi

echo "Node version: $(node -v)"

# ── 2. Create the paia system user ──────────────────────────────
echo "[2/7] Creating paia system user…"
if ! id paia &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin paia
fi

# ── 3. Install the server code ──────────────────────────────────
echo "[3/7] Installing server code into /opt/paia-license…"
mkdir -p /opt/paia-license

# Detect whether we're running from inside the repo or via curl
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../license-server.mjs" ]]; then
  cp "$SCRIPT_DIR/../license-server.mjs" /opt/paia-license/
else
  echo "  ERROR: license-server.mjs not found alongside this script."
  echo "  Clone the repo and run: sudo bash server/deploy/install.sh $DOMAIN"
  exit 1
fi

chown -R paia:paia /opt/paia-license

# ── 4. Set up env file ──────────────────────────────────────────
echo "[4/7] Setting up /etc/paia-license/.env…"
mkdir -p /etc/paia-license
if [[ ! -f /etc/paia-license/.env ]]; then
  if [[ -f "$SCRIPT_DIR/.env.example" ]]; then
    cp "$SCRIPT_DIR/.env.example" /etc/paia-license/.env
  else
    cat > /etc/paia-license/.env <<'EOF'
PORT=8787
PAIA_PRIVATE_KEY_B64=
STRIPE_WEBHOOK_SECRET=
LEMONSQUEEZY_WEBHOOK_SECRET=
RESEND_API_KEY=
RESEND_FROM=hello@paia.app
EOF
  fi
  chmod 600 /etc/paia-license/.env
  chown paia:paia /etc/paia-license/.env
  echo "  Edit /etc/paia-license/.env with your real secrets, then restart the service."
fi

# ── 5. Install systemd unit ─────────────────────────────────────
echo "[5/7] Installing systemd unit…"
if [[ -f "$SCRIPT_DIR/paia-license.service" ]]; then
  cp "$SCRIPT_DIR/paia-license.service" /etc/systemd/system/
else
  cat > /etc/systemd/system/paia-license.service <<'EOF'
[Unit]
Description=PAiA license issuance webhook server
After=network.target

[Service]
Type=simple
User=paia
Group=paia
WorkingDirectory=/opt/paia-license
EnvironmentFile=/etc/paia-license/.env
ExecStart=/usr/bin/node /opt/paia-license/license-server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
fi

systemctl daemon-reload
systemctl enable paia-license

# ── 6. nginx vhost ──────────────────────────────────────────────
echo "[6/7] Configuring nginx vhost for $DOMAIN…"
cat > /etc/nginx/sites-available/paia-license.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_request_buffering on;
        proxy_buffering off;
        client_max_body_size 1m;
    }
}
EOF

ln -sf /etc/nginx/sites-available/paia-license.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ── 7. SSL via Let's Encrypt ────────────────────────────────────
echo "[7/7] Requesting Let's Encrypt SSL certificate…"
echo "  (this needs port 80 reachable from the internet)"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
  echo "  WARNING: certbot failed. The HTTP-only site is up — run certbot manually later:"
  echo "    sudo certbot --nginx -d $DOMAIN"
}

# ── start the service ───────────────────────────────────────────
systemctl restart paia-license || true
sleep 2

echo
echo "═══ Installation complete ═══"
echo
echo "Status:"
systemctl is-active paia-license && echo "  paia-license: ✓ running" || echo "  paia-license: ✗ NOT running (check 'journalctl -u paia-license')"
systemctl is-active nginx && echo "  nginx:        ✓ running" || echo "  nginx:        ✗ NOT running"
echo
echo "Next steps:"
echo "  1. Edit /etc/paia-license/.env with your real secrets"
echo "  2. sudo systemctl restart paia-license"
echo "  3. Test:  curl https://$DOMAIN/health  → should return 'ok'"
echo "  4. Configure your Stripe / LemonSqueezy webhook to POST to:"
echo "       https://$DOMAIN/webhook/stripe"
echo "       https://$DOMAIN/webhook/lemonsqueezy"
echo
echo "Logs:"
echo "  sudo journalctl -u paia-license -f"
echo
