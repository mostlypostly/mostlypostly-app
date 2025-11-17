#!/bin/bash

# ==========================================
# MostlyPostly Telegram Webhook Toggle Script
# LOCAL MACHINE ONLY — DO NOT COMMIT THIS FILE
# ==========================================

# Make sure required environment variables exist
if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
  echo "❌ ERROR: TELEGRAM_BOT_TOKEN is not set."
  echo "   Add this to your ~/.zshrc:"
  echo "   export TELEGRAM_BOT_TOKEN=\"<your-token>\""
  exit 1
fi

if [[ -z "$NGROK_TUNNEL_URL" ]]; then
  echo "❌ ERROR: NGROK_TUNNEL_URL is not set."
  echo "   Add this to ~/.zshrc (your local URL):"
  echo "   export NGROK_TUNNEL_URL=\"https://xxxxx.ngrok-free.app\""
  exit 1
fi

STAGING_URL="https://mostlypostly-staging.onrender.com/inbound/telegram/webhook"

MODE=$1

if [[ "$MODE" == "local" ]]; then
  echo "🔧 Switching Telegram webhook → LOCAL ($NGROK_TUNNEL_URL/inbound/telegram/webhook)"
  curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=$NGROK_TUNNEL_URL/inbound/telegram/webhook"
  echo -e "\n✅ Webhook set to LOCAL"
  exit 0
fi

if [[ "$MODE" == "staging" ]]; then
  echo "🔧 Switching Telegram webhook → STAGING ($STAGING_URL)"
  curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=$STAGING_URL"
  echo -e "\n✅ Webhook set to STAGING"
  exit 0
fi

if [[ "$MODE" == "off" ]]; then
  echo "🔧 Removing Telegram webhook"
  curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
  echo -e "\n🚫 Webhook removed"
  exit 0
fi

if [[ "$MODE" == "status" ]]; then
  echo "🔍 Checking current Telegram webhook status…"
  curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq
  exit 0
fi

echo ""
echo "⚠️ Usage:"
echo "  ./toggle_telegram_webhook.sh local     # Point webhook to ngrok"
echo "  ./toggle_telegram_webhook.sh staging   # Point webhook to staging server"
echo "  ./toggle_telegram_webhook.sh off       # Remove webhook"
echo "  ./toggle_telegram_webhook.sh status    # Show current webhook"
echo ""
exit 1

