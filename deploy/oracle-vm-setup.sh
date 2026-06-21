#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:-}"
APP_DIR="${APP_DIR:-/opt/wapstro}"
APP_USER="${APP_USER:-wapstro}"
NODE_MAJOR="${NODE_MAJOR:-20}"

if [[ -z "$REPO_URL" ]]; then
  echo "Usage: sudo bash deploy/oracle-vm-setup.sh <git-repo-url>"
  echo "Example: sudo bash deploy/oracle-vm-setup.sh https://github.com/you/wapstro.git"
  exit 2
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/oracle-vm-setup.sh <git-repo-url>"
  exit 2
fi

apt-get update
apt-get install -y ca-certificates curl git

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q "^v${NODE_MAJOR}\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

sudo -u "$APP_USER" npm --prefix "$APP_DIR" ci

if [[ ! -f /etc/wapstro.env ]]; then
  cp "$APP_DIR/deploy/wapstro.env.example" /etc/wapstro.env
  chmod 600 /etc/wapstro.env
  echo "Created /etc/wapstro.env. Edit it before starting the service."
fi

cp "$APP_DIR/deploy/wapstro.service" /etc/systemd/system/wapstro.service
systemctl daemon-reload

cat <<EOF
Oracle VM setup complete.

Next:
  1. Edit /etc/wapstro.env
       sudo nano /etc/wapstro.env

  2. Link WhatsApp on the VM if auth/ is not already restored:
       sudo -iu $APP_USER
       cd $APP_DIR
       npm run link
       exit

  3. Start the bot:
       sudo systemctl enable --now wapstro

  4. Check logs:
       journalctl -u wapstro -f
EOF
