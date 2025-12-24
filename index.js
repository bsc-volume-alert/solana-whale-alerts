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

// DEX Program IDs
const DEX_PROGRAMS = {
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB': 'Jupiter',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
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

// Send Telegram alert
async function sendTelegramAlert(swapData) {
  try {
    const { wallet, tokenSymbol, tokenAddress, solAmount, dex, txCount, fundingSource, fundingCex, signature } = swapData;

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

    const message = `
🐋 <b>BIG BUY ALERT</b>

<b>Token:</b> ${tokenSymbol}
<b>Wallet:</b> <code>${shortWallet}</code>
<b>Amount:</b> ${solAmount.toFixed(2)} SOL
<b>DEX:</b> ${dex}

${freshnessLine}
${fundingLine}

🔗 <a href="https://solscan.io/tx/${signature}">View TX</a> | <a href="https://solscan.io/account/${wallet}">Wallet</a> | <a href="https://birdeye.so/token/${tokenAddress}?chain=solana">Chart</a>
`.trim();

    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(telegramUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    console.log(`Alert sent for ${solAmount.toFixed(2)} SOL swap by ${shortWallet}`);
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

    // Identify DEX
    const programIds = instructions.map(inst => inst.programId || '');
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

        // Process the swap
        const swapInfo = processSwapTransaction(tx);
        if (!swapInfo) continue;

        // Check if amount meets threshold
        if (swapInfo.solAmount < MIN_SOL_AMOUNT) {
          continue;
        }

        console.log(`Processing swap: ${swapInfo.solAmount.toFixed(2)} SOL for ${swapInfo.tokenSymbol}`);

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
