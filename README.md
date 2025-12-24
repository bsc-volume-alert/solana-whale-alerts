# 🐋 Solana Whale Alert Bot

Real-time Telegram alerts for large Solana swaps (50+ SOL).

## Features

- ✅ Monitors ALL swaps > 50 SOL across Solana
- ✅ Fresh wallet detection (🟢 FRESH / 🟡 NEW-ISH / ⚪ ESTABLISHED)
- ✅ CEX funding source identification (Binance, Coinbase, OKX, Bybit, KuCoin, Kraken)
- ✅ DEX identification (Jupiter, Raydium, Orca, Meteora, Pump.fun)
- ✅ Direct links to Solscan and Birdeye

## Alert Example

```
🐋 BIG BUY ALERT

Token: BONK
Wallet: 7xKp...3nF
Amount: 62.50 SOL
DEX: Jupiter

🟢 FRESH (3 transactions)
💰 Funded from: Binance

🔗 View TX | Wallet | Chart
```

---

## Deploy to Render

### Step 1: Add Environment Variables

In Render, add these environment variables:

| Key | Value |
|-----|-------|
| `TELEGRAM_BOT_TOKEN` | `8391291963:AAFbK5rRtlylpSrD2ornS0NkxjIACtbwnMw` |
| `TELEGRAM_CHAT_ID` | `5953868240` |
| `HELIUS_API_KEY` | `c08eb6cc-7210-4698-a732-8b04a64ca3bd` |
| `MIN_SOL_AMOUNT` | `50` |

### Step 2: Deploy Settings

- **Build Command:** `npm install`
- **Start Command:** `npm start`

### Step 3: Set Up Helius Webhook

1. Go to [Helius Dashboard](https://dashboard.helius.dev) → Webhooks
2. Click **Create Webhook**
3. Configure:
   - **URL:** `https://YOUR-RENDER-URL.onrender.com/webhook`
   - **Transaction Type:** `SWAP`
   - **Webhook Type:** Enhanced
4. Save

---

## Testing

```bash
curl https://your-render-url.onrender.com/health
```

Should return:
```json
{"status": "healthy", "min_sol": 50}
```

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Required |
| `TELEGRAM_CHAT_ID` | Telegram chat ID | Required |
| `HELIUS_API_KEY` | Helius API key | Required |
| `MIN_SOL_AMOUNT` | Minimum SOL to trigger alert | 50 |

---

## License

MIT
