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
const CACHE_DURATION = 3600000;

// Deduplication cache
const recentAlerts = new Map();
const DEDUP_DURATION = 60000;

// Known CEX hot wallets
const CEX_WALLETS = {
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': 'Binance',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'Binance',
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': 'Binance',
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase',
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': 'Coinbase',
  '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm': 'Coinbase',
  '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD': 'OKX',
  'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH': 'OKX',
  'AC5RDfQFmDS1deWZos921JfqscXdByf4BKHs5ACWjtW2': 'Bybit',
  'BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6': 'KuCoin',
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': 'Kraken',
};

// DEX Program IDs
const DEX_PROGRAMS = {
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB': 'Jupiter',
  'JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo': 'Jupiter',
  'JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph': 'Jupiter',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h': 'Raydium',
  'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS': 'Raydium',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca',
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1': 'Orca',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora',
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB': 'Meteora',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'Pump.fun AMM',
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'Phoenix',
  'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S': 'Lifinity',
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': 'Marinade',
  'stkitrT1Uoy18Dk1fTrgPw8W6MVzoCfYoAFT4MLsmhq': 'Sanctum',
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'OpenBook',
  'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb': 'OpenBook',
  'FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X': 'Fluxbeam',
  'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG': 'Moonshot',
};

function getFreshnessIndicator(txCount) {
  if (txCount < 10) {
    return { emoji: '\u{1F7E2}', label: 'FRESH' };
  } else if (txCount <= 50) {
    return { emoji: '\u{1F7E1}', label: 'NEW-ISH' };
  } else {
    return { emoji: '\u{26AA}', label: 'ESTABLISHED' };
  }
}

function identifyCexSource(wallet) {
  return CEX_WALLETS[wallet] || null;
}

function identifyDex(programIds) {
  for (const programId of programIds) {
    if (DEX_PROGRAMS[programId]) {
      return DEX_PROGRAMS[programId];
    }
  }
  return 'Unknown DEX';
}

function isDuplicate(signature) {
  const now = Date.now();
  for (const [key, timestamp] of recentAlerts.entries()) {
    if (now - timestamp > DEDUP_DURATION) {
      recentAlerts.delete(key);
    }
  }
  if (recentAlerts.has(signature)) {
    return true;
  }
  recentAlerts.set(signature, now);
  return false;
}

async function getWalletTxCount(walletAddress) {
  const cached = walletCache.get(walletAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.count;
  }
  try {
    const url = 'https://api.helius.xyz/v0/addresses/' + walletAddress + '/transactions?api-key=' + HELIUS_API_KEY + '&limit=100';
    const response = await axios.get(url);
    const txCount = response.data.length;
    walletCache.set(walletAddress, { count: txCount, timestamp: Date.now() });
    return txCount;
  } catch (error) {
    console.error('Error fetching wallet history:', error.message);
    return -1;
  }
}

async function getFundingSource(walletAddress) {
  try {
    const url = 'https://api.helius.xyz/v0/addresses/' + walletAddress + '/transactions?api-key=' + HELIUS_API_KEY + '&limit=100&type=TRANSFER';
    const response = await axios.get(url);
    const transactions = response.data;
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

async function getTokenInfo(tokenAddress) {
  try {
    const url = 'https://api.helius.xyz/v0/token-metadata?api-key=' + HELIUS_API_KEY;
    const response = await axios.post(url, { mintAccounts: [tokenAddress] });
    if (response.data && response.data.length > 0) {
      const token = response.data[0];
      const symbol = (token.onChainMetadata && token.onChainMetadata.metadata && token.onChainMetadata.metadata.data && token.onChainMetadata.metadata.data.symbol) ||
                     (token.legacyMetadata && token.legacyMetadata.symbol) ||
                     (token.offChainMetadata && token.offChainMetadata.metadata && token.offChainMetadata.metadata.symbol) ||
                     tokenAddress.slice(0, 8);
      const name = (token.onChainMetadata && token.onChainMetadata.metadata && token.onChainMetadata.metadata.data && token.onChainMetadata.metadata.data.name) ||
                   (token.legacyMetadata && token.legacyMetadata.name) ||
                   (token.offChainMetadata && token.offChainMetadata.metadata && token.offChainMetadata.metadata.name) ||
                   'Unknown';
      return { symbol: symbol, name: name };
    }
    return { symbol: tokenAddress.slice(0, 8), name: 'Unknown' };
  } catch (error) {
    console.error('Error fetching token info:', error.message);
    return { symbol: tokenAddress.slice(0, 8), name: 'Unknown' };
  }
}

async function sendTelegramAlert(swapData) {
  try {
    const wallet = swapData.wallet;
    const tokenSymbol = swapData.tokenSymbol;
    const tokenName = swapData.tokenName;
    const tokenAddress = swapData.tokenAddress;
    const solAmount = swapData.solAmount;
    const dex = swapData.dex;
    const txCount = swapData.txCount;
    const fundingSource = swapData.fundingSource;
    const fundingCex = swapData.fundingCex;
    const signature = swapData.signature;

    var freshnessLine;
    if (txCount >= 0) {
      const indicator = getFreshnessIndicator(txCount);
      freshnessLine = indicator.emoji + ' <b>' + indicator.label + '</b> (' + txCount + ' transactions)';
    } else {
      freshnessLine = '\u{26AB} <b>UNKNOWN</b> (could not fetch)';
    }

    var fundingLine = '';
    if (fundingCex) {
      fundingLine = '\u{1F4B0} Funded from: <b>' + fundingCex + '</b>';
    } else if (fundingSource) {
      const shortSource = fundingSource.slice(0, 4) + '...' + fundingSource.slice(-4);
      fundingLine = '\u{1F4B0} Funded from: ' + shortSource;
    }

    const shortWallet = wallet.slice(0, 4) + '...' + wallet.slice(-4);
    
    var tokenDisplay;
    if (tokenName !== 'Unknown' && tokenName !== tokenSymbol) {
      tokenDisplay = tokenName + ' (' + tokenSymbol + ')';
    } else {
      tokenDisplay = tokenSymbol;
    }

    var message = '\u{1F40B} <b>BIG BUY ALERT</b>\n\n';
    message += '<b>Token:</b> ' + tokenDisplay + '\n';
    message += '<b>Contract:</b> <code>' + tokenAddress + '</code>\n';
    message += '<b>Wallet:</b> <code>' + shortWallet + '</code>\n';
    message += '<b>Amount:</b> ' + solAmount.toFixed(2) + ' SOL\n';
    message += '<b>DEX:</b> ' + dex + '\n\n';
    message += freshnessLine + '\n';
    if (fundingLine) {
      message += fundingLine + '\n';
    }
    message += '\n\u{1F517} <a href="https://solscan.io/tx/' + signature + '">TX</a>';
    message += ' | <a href="https://solscan.io/account/' + wallet + '">Wallet</a>';
    message += ' | <a href="https://dexscreener.com/solana/' + tokenAddress + '">Dexscreener</a>';
    message += ' | <a href="https://birdeye.so/token/' + tokenAddress + '?chain=solana">Birdeye</a>';

    const telegramUrl = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
    await axios.post(telegramUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    console.log('Alert sent for ' + solAmount.toFixed(2) + ' SOL swap by ' + shortWallet + ' for ' + tokenSymbol);
  } catch (error) {
    console.error('Error sending Telegram alert:', error.message);
  }
}

function processSwapTransaction(tx) {
  try {
    const signature = tx.signature || '';
    const feePayer = tx.feePayer || '';
    const nativeTransfers = tx.nativeTransfers || [];
    const tokenTransfers = tx.tokenTransfers || [];
    const instructions = tx.instructions || [];

    var solSpent = 0;
    for (var i = 0; i < nativeTransfers.length; i++) {
      var transfer = nativeTransfers[i];
      if (transfer.fromUserAccount === feePayer) {
        solSpent += (transfer.amount || 0) / 1e9;
      }
    }

    var tokenSymbol = 'Unknown';
    var tokenAddress = '';
    for (var j = 0; j < tokenTransfers.length; j++) {
      var tt = tokenTransfers[j];
      if (tt.toUserAccount === feePayer) {
        tokenSymbol = tt.tokenSymbol || (tt.mint ? tt.mint.slice(0, 8) : 'Unknown');
        tokenAddress = tt.mint || '';
        break;
      }
    }

    var programIds = [];
    for (var k = 0; k < instructions.length; k++) {
      if (instructions[k].programId) {
        programIds.push(instructions[k].programId);
      }
    }

    if (tx.innerInstructions) {
      for (var m = 0; m < tx.innerInstructions.length; m++) {
        var inner = tx.innerInstructions[m];
        if (inner.instructions) {
          for (var n = 0; n < inner.instructions.length; n++) {
            if (inner.instructions[n].programId) {
              programIds.push(inner.instructions[n].programId);
            }
          }
        }
      }
    }

    if (tx.accountData) {
      for (var p = 0; p < tx.accountData.length; p++) {
        if (tx.accountData[p].account) {
          programIds.push(tx.accountData[p].account);
        }
      }
    }

    var dex = identifyDex(programIds);

    return {
      wallet: feePayer,
      tokenSymbol: tokenSymbol,
      tokenAddress: tokenAddress,
      solAmount: solSpent,
      dex: dex,
      signature: signature
    };
  } catch (error) {
    console.error('Error processing swap:', error.message);
    return null;
  }
}

app.post('/webhook', async function(req, res) {
  try {
    var data = req.body;
    if (!data) {
      return res.status(400).json({ error: 'No data received' });
    }
    if (!Array.isArray(data)) {
      data = [data];
    }

    for (var i = 0; i < data.length; i++) {
      var tx = data[i];
      try {
        if (tx.type !== 'SWAP') {
          continue;
        }
        if (isDuplicate(tx.signature)) {
          console.log('Skipping duplicate: ' + tx.signature);
          continue;
        }

        var swapInfo = processSwapTransaction(tx);
        if (!swapInfo) continue;

        if (swapInfo.solAmount < MIN_SOL_AMOUNT) {
          continue;
        }

        console.log('Processing swap: ' + swapInfo.solAmount.toFixed(2) + ' SOL for ' + swapInfo.tokenSymbol);

        if (swapInfo.tokenAddress) {
          var tokenInfo = await getTokenInfo(swapInfo.tokenAddress);
          swapInfo.tokenSymbol = tokenInfo.symbol;
          swapInfo.tokenName = tokenInfo.name;
        } else {
          swapInfo.tokenName = 'Unknown';
        }

        var txCount = await getWalletTxCount(swapInfo.wallet);
        swapInfo.txCount = txCount;

        if (txCount >= 0 && txCount < 50) {
          var funding = await getFundingSource(swapInfo.wallet);
          swapInfo.fundingSource = funding.wallet;
          swapInfo.fundingCex = funding.cex;
        } else {
          swapInfo.fundingSource = null;
          swapInfo.fundingCex = null;
        }

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

app.get('/health', function(req, res) {
  res.json({ status: 'healthy', min_sol: MIN_SOL_AMOUNT });
});

app.get('/', function(req, res) {
  res.json({
    name: 'Solana Whale Alert Bot',
    status: 'running',
    min_sol_threshold: MIN_SOL_AMOUNT
  });
});

app.listen(PORT, function() {
  console.log('Solana Whale Alert Bot running on port ' + PORT);
  console.log('Minimum SOL threshold: ' + MIN_SOL_AMOUNT);
});
