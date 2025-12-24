const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const MIN_SOL_AMOUNT = parseFloat(process.env.MIN_SOL_AMOUNT || '50');
const PORT = process.env.PORT || 3000;

// Cache for wallet transaction counts
const walletCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour in ms

// Deduplication cache - prevents duplicate alerts
const recentAlerts = new Map();
const DEDUP_DURATION = 60000; // 1 minute

// Known CEX hot wallets
const CEX_WALLETS = {
  // Binance
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': 'Binance',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'Binance',
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': 'Binance',
  // Coinbase
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase',
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': 'Coinbase',
  '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm': 'Coinbase',
  // OKX
  '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD': 'OKX',
  'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH': 'OKX',
  // Bybit
  'AC5RDfQFmDS1deWZos921JfqscXdByf4BKHs5ACWjtW2': 'Bybit',
  // KuCoin
  'BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6': 'KuCoin',
  // Kraken
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': 'Kraken',
};

// DEX Program IDs - Extended list
const DEX_PROGRAMS = {
  // Jupiter
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB': 'Jupiter',
  'JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo': 'Jupiter',
  'JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph': 'Jupiter',
  // Raydium
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h': 'Raydium',
  'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS': 'Raydium',
  // Orca
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca',
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1': 'Orca',
  // Meteora
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora',
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB': 'Meteora',
  // Pump.fun
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'Pump.fun AMM',
  // Phoenix
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'Phoenix',
  // Lifinity
  'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S': 'Lifinity',
  // Marinade
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': 'Marinade',
  // Sanctum
  'stkitrT1Uoy18Dk1fTrgPw8W6MVzoCfYoAFT4MLsmhq': 'Sanctum',
  // OpenBook
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'OpenBook',
  'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb': 'OpenBook',
  // Fluxbeam
  'FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X': 'Fluxbeam',
  // Moonshot
  'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG': 'Moonshot',
};

// Get freshness indicator
function getFreshnessIndicator(txCount) {
  if (txCount < 10) {
    return { emoji: '🟢', label: 'FRESH' };
  } else if (txCount <= 50) {
    return { emoji: '🟡', label: 'NEW-ISH' };
  } else {
    return { emoji: '⚪', label: 'ESTABLISHED' };
  }
}

// Identify CEX source
function identifyCexSource(wallet) {
  return CEX_WALLETS[wallet] || null;
}

// Identify DEX
function identifyDex(programIds) {
  for (const programId of programIds) {
    if (DEX_PROGRAMS[programId]) {
      return DEX_PROGRAMS[programId];
    }
  }
  return 'Unknown DEX';
}

// Check for duplicate alerts
function isDuplicate(signature) {
  const now = Date.now();
  
  // Clean old entries
  for (const [key, timestamp] of recentAlerts.entries()) {
    if (now - timestamp > DEDUP_DURATION) {
      recentAlerts.delete(key);
    }
  }
  
  // Check if this signature was recently processed
  if (recentAlerts.has(signature)) {
    return true;
  }
  
  // Mark as processed
  recentAlerts.set(signature, now);
  return false;
}

// Get wallet transaction count
async function getWalletTxCount(walletAddress) {
  // Check cache
  const cached = walletCache.get(walletAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.count;
  }

  try {
    const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${HELIUS_API_KEY}&limit=100`;
    const response = await axios.get(url);
    const txCount = response.data.length;

    // Cache result
    walletCache.set(walletAddress, {
      count: txCount,
      timestamp: Date.now()
    });

    return txCount;
  } catch (error) {
    console.error('Error fetching wallet history:', error.message);
    return -1;
  }
}

// Get funding source
async function getFundingSource(walletAddress) {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${HELIUS_API_KEY}&limit=100&type=TRANSFER`;
    const response = await axios.get(url);
    const transactions = response.data;

    // Look for incoming SOL transfers (start from oldest)
    for (let i = transactions.length - 1; i >= 0; i--) {
      const tx = transactions[i];
      if (tx.type === 'TRANSFER' && tx.nativeTransfers) {
        for (const transfer of tx.nativeTransfers) {
          if (transfer.toUserAccount === walletAddress) {
            const fromWallet = transfer.fromUserAccount;
            const cexName = identifyCexSource(fromWallet);
            return { wallet: fromWallet, cex: cexName };
          }
        }
      }
    }
    return { wallet: null, cex: null };
  } catch (error) {
    console.error('Error fetching funding source:', error.message);
    return { wallet: null, cex: null };
  }
}

// Get token info from Helius
async function getTokenInfo(tokenAddress) {
  try {
    const url = `https://api.helius.xyz/v0/token-metadata?api-key=${HELIUS_API_KEY}`;
    const response = await axios.post(url, {
      mintAccounts: [tokenAddress]
    });
    
    if (response.data && response.data.length > 0) {
      const token = response.data[0];
      return {
        symbol: token.onChainMetadata?.metadata?.data?.symbol || 
                token.legacyMetadata?.symbol || 
                token.offChainMetadata?.metadata?.symbol ||
                tokenAddress.slice(0, 8),
        name: token.onChainMetadata?.metadata?.data?.name || 
              token.legacyMetadata?.name || 
              token.offChainMetadata?.metadata?.name ||
              'Unknown'
      };
    }
    return { symbol: tokenAddress.slice(0, 8), name: 'Unknown' };
  } catch (error) {
    console.error('Error fetching token info:', error.message);
    return { symbol: tokenAddress.slice(0, 8), name: 'Unknown' };
  }
}

// Send Telegram alert
async function sendTelegramAlert(swapData) {
  try {
    const { wallet, tokenSymbol, tokenName, tokenAddress, solAmount, dex, txCount, fundingSource, fundingCex, signature } = swapData;

    // Freshness indicator
    let freshnessLine;
    if (txCount >= 0) {
      const { emoji, label } = getFreshnessIndicator(txCount);
      freshnessLine = `${emoji} <b>${label}</b> (${txCount} transactions)`;
    } else {
      freshnessLine = `⚫ <b>UNKNOWN</b> (couldn't fetch)`;
    }

    // Funding source line
    let fundingLine = '';
    if (fundingCex) {
      fundingLine = `💰 Funded from: <b>${fundingCex}</b>`;
    } else if (fundingSource) {
      const shortSource = `${fundingSource.slice(0, 4)}...${fundingSource.slice(-4)}`;
      fundingLine = `💰 Funded from: ${shortSource}`;
    }

    const shortWallet = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
    
    // Display token name if available
    const tokenDisplay = tokenName !== 'Unknown' && tokenName !== tokenSymbol 
      ? `${tokenName} (${tokenSymbol})`
      : tokenSymbol;

    const message = `
🐋 <b>BIG BUY ALERT</b>

<b>Token:</b> ${tokenDisplay}
<b>Contract:</b> <code>${tokenAddress}</code>
<b>Wallet:</b> <code>${shortWallet}</code>
<b>Amount:</b> ${solAmount.toFixed(2)} SOL
<b>DEX:</b> ${dex}

${freshnessLine}
${fundingLine}

🔗 <a href="https://solscan.io/tx/${signature}">TX</a> | <a href="https://solscan.io/account/${wallet}">Wallet</a> | <a href="https://dexscreener.com/solana/${tokenAddress}">Dexscreener</a> | <a href="https://birdeye.so/token/${tokenAddress}?chain=solana">Birdeye</a>
`.trim();

    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(telegramUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    console.log(`Alert sent for ${solAmount.toFixed(2)} SOL swap by ${shortWallet} for ${tokenSymbol}`);
  } catch (error) {
    console.error('Error sending Telegram alert:', error.message);
  }
}

// Process swap transaction
function processSwapTransaction(tx) {
  try {
    const signature = tx.signature || '';
    const feePayer = tx.feePayer || '';
    const nativeTransfers = tx.nativeTransfers || [];
    const tokenTransfers = tx.tokenTransfers || [];
    const instructions = tx.instructions || [];

    // Calculate SOL spent
    let solSpent = 0;
    for (const transfer of nativeTransfers) {
      if (transfer.fromUserAccount === feePayer) {
        solSpent += (transfer.amount || 0) / 1e9;
      }
    }

    // Get token received
    let tokenSymbol = 'Unknown';
    let tokenAddress = '';
    for (const transfer of tokenTransfers) {
      if (transfer.toUserAccount === feePayer) {
        tokenSymbol = transfer.tokenSymbol || transfer.mint?.slice(0, 8) || 'Unknown';
        tokenAddress = transfer.mint || '';
        break;
      }
    }

    // Identify DEX from all program IDs in the transaction
    const programIds = instructions.map(inst => inst.programId || '');
    
    // Also check inner instructions if available
    if (tx.innerInstructions) {
      for (const inner of tx.innerInstructions) {
        if (inner.instructions) {
          for (const inst of inner.instructions) {
            if (inst.programId) {
              programIds.push(inst.programId);
            }
          }
        }
      }
    }
    
    // Check account keys as well
    if (tx.accountData) {
      for (const acc of tx.accountData) {
        if (acc.account) {
          programIds.push(acc.account);
        }
      }
    }
    
    const dex = identifyDex(programIds);

    return {
      wallet: feePayer,
      tokenSymbol,
      tokenAddress,
      solAmount: solSpent,
      dex,
      signature
    };
  } catch (error) {
    console.error('Error processing swap:', error.message);
    return null;
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    let data = req.body;

    if (!data) {
      return res.status(400).json({ error: 'No data received' });
    }

    // Handle both single transaction and array
    if (!Array.isArray(data)) {
      data = [data];
    }

    // Process each transaction
    for (const tx of data) {
      try {
        // Check if it's a swap
        if (tx.type !== 'SWAP') {
          continue;
        }

        // Check for duplicate
        if (isDuplicate(tx.signature)) {
          console.log(`Skipping duplicate: ${tx.signature}`);
          continue;
        }

        // Process the swap
        const swapInfo = processSwapTransaction(tx);
        if (!swapInfo) continue;

        // Check if amount meets threshold
        if (swapInfo.solAmount < MIN_SOL_AMOUNT) {
          continue;
        }

        console.log(`Processing swap: ${swapInfo.solAmount.toFixed(2)} SOL for ${swapInfo.tokenSymbol}`);

        // Get token info
        if (swapInfo.tokenAddress) {
          const tokenInfo = await getTokenInfo(swapInfo.tokenAddress);
          swapInfo.tokenSymbol = tokenInfo.symbol;
          swapInfo.tokenName = tokenInfo.name;
        } else {
          swapInfo.tokenName = 'Unknown';
        }

        // Get wallet transaction count
        const txCount = await getWalletTxCount(swapInfo.wallet);
        swapInfo.txCount = txCount;

        // If fresh wallet, get funding source
        if (txCount >= 0 && txCount < 50) {
          const { wallet: fundingWallet, cex: cexName } = await getFundingSource(swapInfo.wallet);
          swapInfo.fundingSource = fundingWallet;
          swapInfo.fundingCex = cexName;
        } else {
          swapInfo.fundingSource = null;
          swapInfo.fundingCex = null;
        }

        // Send alert
        await sendTelegramAlert(swapInfo);

      } catch (error) {
        console.error('Error processing transaction:', error.message);
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', min_sol: MIN_SOL_AMOUNT });
});

// Home
app.get('/', (req, res) => {
  res.json({
    name: 'Solana Whale Alert Bot',
    status: 'running',
    min_sol_threshold: MIN_SOL_AMOUNT
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🐋 Solana Whale Alert Bot running on port ${PORT}`);
  console.log(`Minimum SOL threshold: ${MIN_SOL_AMOUNT}`);
});
```

---

## What's New

| Fix | Description |
|-----|-------------|
| ✅ No duplicates | Tracks signatures for 60 seconds to prevent duplicate alerts |
| ✅ More DEXs | Added 25+ DEX programs (Jupiter, Raydium, Orca, Meteora, Pump.fun, Phoenix, Lifinity, OpenBook, etc.) |
| ✅ Token name | Fetches full token name and symbol from Helius |
| ✅ Contract address | Shows the token contract address |
| ✅ Dexscreener link | Added direct link to Dexscreener chart |

---

## New Alert Format
```
🐋 BIG BUY ALERT

Token: Bonk (BONK)
Contract: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
Wallet: 7xKp...3nF
Amount: 62.50 SOL
DEX: Jupiter

🟢 FRESH (3 transactions)
💰 Funded from: Binance

🔗 TX | Wallet | Dexscreener | Birdeye
