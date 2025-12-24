const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PORT = process.env.PORT || 3000;

// Dynamic thresholds based on wallet freshness
const THRESHOLD_FRESH = 20;       // Fresh wallets (<10 tx): 20 SOL
const THRESHOLD_NEWISH = 35;      // New-ish wallets (10-50 tx): 35 SOL
const THRESHOLD_ESTABLISHED = 100; // Established wallets (>50 tx): 100 SOL

// Cluster detection settings
const CLUSTER_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const CLUSTER_MIN_WALLETS = 3;

// Caches
const walletCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

const recentAlerts = new Map();
const DEDUP_DURATION = 300000; // 5 minutes

const recentBuys = new Map();

const tokenAgeCache = new Map();
const TOKEN_AGE_CACHE_DURATION = 3600000;

const tokenInfoCache = new Map();
const TOKEN_INFO_CACHE_DURATION = 3600000;

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

// DEX Program IDs - Extended
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
  '24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi': 'Meteora',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'Pump.fun AMM',
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'Phoenix',
  'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S': 'Lifinity',
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'OpenBook',
  'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb': 'OpenBook',
  'FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X': 'Fluxbeam',
  'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG': 'Moonshot',
};

function getFreshnessIndicator(txCount) {
  if (txCount < 10) {
    return { emoji: '\u{1F7E2}', label: 'FRESH', threshold: THRESHOLD_FRESH };
  } else if (txCount <= 50) {
    return { emoji: '\u{1F7E1}', label: 'NEW-ISH', threshold: THRESHOLD_NEWISH };
  } else {
    return { emoji: '\u{26AA}', label: 'ESTABLISHED', threshold: THRESHOLD_ESTABLISHED };
  }
}

function identifyCexSource(wallet) {
  return CEX_WALLETS[wallet] || null;
}

function identifyDex(programIds) {
  for (var i = 0; i < programIds.length; i++) {
    if (DEX_PROGRAMS[programIds[i]]) {
      return DEX_PROGRAMS[programIds[i]];
    }
  }
  return 'Unknown DEX';
}

// Clean old entries from dedup cache
function cleanDedupCache() {
  var now = Date.now();
  var keysToDelete = [];
  for (var entry of recentAlerts.entries()) {
    if (now - entry[1] > DEDUP_DURATION) {
      keysToDelete.push(entry[0]);
    }
  }
  for (var i = 0; i < keysToDelete.length; i++) {
    recentAlerts.delete(keysToDelete[i]);
  }
}

function isDuplicate(signature) {
  // Don't dedupe empty signatures
  if (!signature || signature.length < 10) {
    return false;
  }
  
  cleanDedupCache();
  
  if (recentAlerts.has(signature)) {
    return true;
  }
  
  recentAlerts.set(signature, Date.now());
  return false;
}

function cleanRecentBuys() {
  var now = Date.now();
  for (var entry of recentBuys.entries()) {
    var tokenAddress = entry[0];
    var buys = entry[1];
    var validBuys = buys.filter(function(buy) {
      return now - buy.timestamp < CLUSTER_WINDOW_MS;
    });
    if (validBuys.length === 0) {
      recentBuys.delete(tokenAddress);
    } else {
      recentBuys.set(tokenAddress, validBuys);
    }
  }
}

function trackBuy(tokenAddress, swapData) {
  cleanRecentBuys();
  
  if (!recentBuys.has(tokenAddress)) {
    recentBuys.set(tokenAddress, []);
  }
  
  var buys = recentBuys.get(tokenAddress);
  buys.push({
    wallet: swapData.wallet,
    solAmount: swapData.solAmount,
    txCount: swapData.txCount,
    fundingCex: swapData.fundingCex,
    timestamp: Date.now()
  });
  recentBuys.set(tokenAddress, buys);
  
  return buys;
}

function checkForCluster(tokenAddress) {
  var buys = recentBuys.get(tokenAddress) || [];
  
  var freshBuys = buys.filter(function(buy) {
    return buy.txCount >= 0 && buy.txCount < 50;
  });
  
  var uniqueWallets = [];
  var seenWallets = {};
  for (var i = 0; i < freshBuys.length; i++) {
    if (!seenWallets[freshBuys[i].wallet]) {
      seenWallets[freshBuys[i].wallet] = true;
      uniqueWallets.push(freshBuys[i]);
    }
  }
  
  if (uniqueWallets.length >= CLUSTER_MIN_WALLETS) {
    return {
      isCluster: true,
      buys: uniqueWallets,
      totalSol: uniqueWallets.reduce(function(sum, b) { return sum + b.solAmount; }, 0)
    };
  }
  
  return { isCluster: false };
}

async function getWalletTxCount(walletAddress) {
  var cached = walletCache.get(walletAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.count;
  }
  try {
    var url = 'https://api.helius.xyz/v0/addresses/' + walletAddress + '/transactions?api-key=' + HELIUS_API_KEY + '&limit=100';
    var response = await axios.get(url);
    var txCount = response.data.length;
    walletCache.set(walletAddress, { count: txCount, timestamp: Date.now() });
    return txCount;
  } catch (error) {
    console.error('Error fetching wallet history:', error.message);
    return -1;
  }
}

async function getFundingSource(walletAddress) {
  try {
    var url = 'https://api.helius.xyz/v0/addresses/' + walletAddress + '/transactions?api-key=' + HELIUS_API_KEY + '&limit=50&type=TRANSFER';
    var response = await axios.get(url);
    var transactions = response.data;
    for (var i = transactions.length - 1; i >= 0; i--) {
      var tx = transactions[i];
      if (tx.type === 'TRANSFER' && tx.nativeTransfers) {
        for (var j = 0; j < tx.nativeTransfers.length; j++) {
          var transfer = tx.nativeTransfers[j];
          if (transfer.toUserAccount === walletAddress) {
            var fromWallet = transfer.fromUserAccount;
            var cexName = identifyCexSource(fromWallet);
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
  var cached = tokenInfoCache.get(tokenAddress);
  if (cached && Date.now() - cached.timestamp < TOKEN_INFO_CACHE_DURATION) {
    return cached.info;
  }
  
  try {
    var url = 'https://api.helius.xyz/v0/token-metadata?api-key=' + HELIUS_API_KEY;
    var response = await axios.post(url, { mintAccounts: [tokenAddress] });
    if (response.data && response.data.length > 0) {
      var token = response.data[0];
      var symbol = (token.onChainMetadata && token.onChainMetadata.metadata && token.onChainMetadata.metadata.data && token.onChainMetadata.metadata.data.symbol) ||
                   (token.legacyMetadata && token.legacyMetadata.symbol) ||
                   (token.offChainMetadata && token.offChainMetadata.metadata && token.offChainMetadata.metadata.symbol) ||
                   tokenAddress.slice(0, 8);
      var name = (token.onChainMetadata && token.onChainMetadata.metadata && token.onChainMetadata.metadata.data && token.onChainMetadata.metadata.data.name) ||
                 (token.legacyMetadata && token.legacyMetadata.name) ||
                 (token.offChainMetadata && token.offChainMetadata.metadata && token.offChainMetadata.metadata.name) ||
                 'Unknown';
      var info = { symbol: symbol, name: name };
      tokenInfoCache.set(tokenAddress, { info: info, timestamp: Date.now() });
      return info;
    }
    return { symbol: tokenAddress.slice(0, 8), name: 'Unknown' };
  } catch (error) {
    console.error('Error fetching token info:', error.message);
    return { symbol: tokenAddress.slice(0, 8), name: 'Unknown' };
  }
}

async function getTokenAge(tokenAddress) {
  var cached = tokenAgeCache.get(tokenAddress);
  if (cached && Date.now() - cached.timestamp < TOKEN_AGE_CACHE_DURATION) {
    return cached.age;
  }
  
  try {
    var url = 'https://api.helius.xyz/v0/addresses/' + tokenAddress + '/transactions?api-key=' + HELIUS_API_KEY + '&limit=1';
    var response = await axios.get(url);
    
    if (response.data && response.data.length > 0) {
      var tx = response.data[0];
      var txTime = tx.timestamp * 1000;
      var ageMs = Date.now() - txTime;
      
      tokenAgeCache.set(tokenAddress, { age: ageMs, timestamp: Date.now() });
      return ageMs;
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching token age:', error.message);
    return null;
  }
}

function formatAge(ageMs) {
  if (!ageMs) return 'Unknown age';
  
  var seconds = Math.floor(ageMs / 1000);
  var minutes = Math.floor(seconds / 60);
  var hours = Math.floor(minutes / 60);
  var days = Math.floor(hours / 24);
  
  if (days > 30) {
    return Math.floor(days / 30) + ' months old';
  } else if (days > 0) {
    return days + ' day' + (days > 1 ? 's' : '') + ' old';
  } else if (hours > 0) {
    return hours + ' hour' + (hours > 1 ? 's' : '') + ' old';
  } else if (minutes > 0) {
    return minutes + ' min' + (minutes > 1 ? 's' : '') + ' old';
  } else {
    return 'Just launched!';
  }
}

async function sendClusterAlert(tokenAddress, tokenSymbol, tokenName, tokenAge, cluster) {
  try {
    var ageStr = formatAge(tokenAge);
    var isNewToken = tokenAge && tokenAge < 24 * 60 * 60 * 1000;
    
    var message = '\u{1F6A8} <b>CLUSTER ALERT - COORDINATED BUYING</b> \u{1F6A8}\n\n';
    message += '<b>Token:</b> ' + (tokenName !== 'Unknown' ? tokenName + ' (' + tokenSymbol + ')' : tokenSymbol) + '\n';
    message += '<b>Contract:</b> <code>' + tokenAddress + '</code>\n';
    message += '<b>Token Age:</b> ' + (isNewToken ? '\u{1F525} ' : '') + ageStr + '\n\n';
    message += '<b>' + cluster.buys.length + ' fresh wallets bought in last 10 mins:</b>\n\n';
    
    for (var i = 0; i < cluster.buys.length; i++) {
      var buy = cluster.buys[i];
      var shortWallet = buy.wallet.slice(0, 4) + '...' + buy.wallet.slice(-4);
      var fundingStr = buy.fundingCex ? ' (' + buy.fundingCex + ')' : '';
      message += '\u{2022} ' + shortWallet + ': ' + buy.solAmount.toFixed(1) + ' SOL' + fundingStr + '\n';
    }
    
    message += '\n<b>Total:</b> ' + cluster.totalSol.toFixed(1) + ' SOL\n\n';
    message += '\u{1F517} <a href="https://dexscreener.com/solana/' + tokenAddress + '">Dexscreener</a>';
    message += ' | <a href="https://birdeye.so/token/' + tokenAddress + '?chain=solana">Birdeye</a>';

    var telegramUrl = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
    await axios.post(telegramUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    console.log('CLUSTER ALERT sent for ' + tokenSymbol + ' - ' + cluster.buys.length + ' wallets, ' + cluster.totalSol.toFixed(1) + ' SOL');
  } catch (error) {
    console.error('Error sending cluster alert:', error.message);
  }
}

async function sendTelegramAlert(swapData) {
  try {
    var wallet = swapData.wallet;
    var tokenSymbol = swapData.tokenSymbol;
    var tokenName = swapData.tokenName;
    var tokenAddress = swapData.tokenAddress;
    var solAmount = swapData.solAmount;
    var dex = swapData.dex;
    var txCount = swapData.txCount;
    var fundingSource = swapData.fundingSource;
    var fundingCex = swapData.fundingCex;
    var signature = swapData.signature;
    var tokenAge = swapData.tokenAge;

    var freshnessLine;
    if (txCount >= 0) {
      var indicator = getFreshnessIndicator(txCount);
      freshnessLine = indicator.emoji + ' <b>' + indicator.label + '</b> (' + txCount + ' transactions)';
    } else {
      freshnessLine = '\u{26AB} <b>UNKNOWN</b> (could not fetch)';
    }

    var fundingLine = '';
    if (fundingCex) {
      fundingLine = '\u{1F4B0} Funded from: <b>' + fundingCex + '</b>';
    } else if (fundingSource) {
      var shortSource = fundingSource.slice(0, 4) + '...' + fundingSource.slice(-4);
      fundingLine = '\u{1F4B0} Funded from: ' + shortSource;
    }

    var shortWallet = wallet.slice(0, 4) + '...' + wallet.slice(-4);
    
    var tokenDisplay;
    if (tokenName !== 'Unknown' && tokenName !== tokenSymbol) {
      tokenDisplay = tokenName + ' (' + tokenSymbol + ')';
    } else {
      tokenDisplay = tokenSymbol;
    }

    var ageStr = formatAge(tokenAge);
    var isNewToken = tokenAge && tokenAge < 24 * 60 * 60 * 1000;
    var ageLine = '\u{23F0} Token: ' + (isNewToken ? '\u{1F525} ' : '') + ageStr;

    var message = '\u{1F40B} <b>BIG BUY ALERT</b>\n\n';
    message += '<b>Token:</b> ' + tokenDisplay + '\n';
    message += '<b>Contract:</b> <code>' + tokenAddress + '</code>\n';
    message += '<b>Wallet:</b> <code>' + shortWallet + '</code>\n';
    message += '<b>Amount:</b> ' + solAmount.toFixed(2) + ' SOL\n';
    message += '<b>DEX:</b> ' + dex + '\n\n';
    message += freshnessLine + '\n';
    message += ageLine + '\n';
    if (fundingLine) {
      message += fundingLine + '\n';
    }
    message += '\n\u{1F517} <a href="https://solscan.io/tx/' + signature + '">TX</a>';
    message += ' | <a href="https://solscan.io/account/' + wallet + '">Wallet</a>';
    message += ' | <a href="https://dexscreener.com/solana/' + tokenAddress + '">Dexscreener</a>';
    message += ' | <a href="https://birdeye.so/token/' + tokenAddress + '?chain=solana">Birdeye</a>';

    var telegramUrl = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
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
    var signature = tx.signature || '';
    var feePayer = tx.feePayer || '';
    var nativeTransfers = tx.nativeTransfers || [];
    var tokenTransfers = tx.tokenTransfers || [];
    var instructions = tx.instructions || [];

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

var alertedClusters = new Map();
var CLUSTER_ALERT_COOLDOWN = 30 * 60 * 1000;

app.post('/webhook', async function(req, res) {
  try {
    var data = req.body;
    if (!data) {
      return res.status(400).json({ error: 'No data received' });
    }
    if (!Array.isArray(data)) {
      data = [data];
    }

    console.log('Received ' + data.length + ' transactions');

    // Respond quickly to webhook
    res.status(200).json({ status: 'ok' });

    // Process in background
    for (var i = 0; i < data.length; i++) {
      var tx = data[i];
      
      try {
        if (tx.type !== 'SWAP') {
          continue;
        }
        
        var sig = tx.signature || 'no-sig-' + Date.now() + '-' + i;
        
        if (isDuplicate(sig)) {
          console.log('Skipping duplicate: ' + sig.slice(0, 20) + '...');
          continue;
        }

        var swapInfo = processSwapTransaction(tx);
        if (!swapInfo) continue;

        // Pre-filter tiny swaps
        if (swapInfo.solAmount < THRESHOLD_FRESH) {
          console.log('Below threshold: ' + swapInfo.solAmount.toFixed(2) + ' SOL');
          continue;
        }

        console.log('Checking wallet for ' + swapInfo.solAmount.toFixed(2) + ' SOL swap...');

        // Get wallet tx count
        var txCount = await getWalletTxCount(swapInfo.wallet);
        swapInfo.txCount = txCount;

        // Check dynamic threshold
        var freshnessInfo = getFreshnessIndicator(txCount >= 0 ? txCount : 100);
        if (swapInfo.solAmount < freshnessInfo.threshold) {
          console.log('Below dynamic threshold: ' + swapInfo.solAmount.toFixed(2) + ' < ' + freshnessInfo.threshold + ' SOL');
          continue;
        }

        console.log('Processing: ' + swapInfo.solAmount.toFixed(2) + ' SOL for ' + swapInfo.tokenSymbol);

        // Get token info
        if (swapInfo.tokenAddress) {
          var tokenInfo = await getTokenInfo(swapInfo.tokenAddress);
          swapInfo.tokenSymbol = tokenInfo.symbol;
          swapInfo.tokenName = tokenInfo.name;
          swapInfo.tokenAge = await getTokenAge(swapInfo.tokenAddress);
        } else {
          swapInfo.tokenName = 'Unknown';
        }

        // Get funding source for fresh wallets
        if (txCount >= 0 && txCount < 50) {
          var funding = await getFundingSource(swapInfo.wallet);
          swapInfo.fundingSource = funding.wallet;
          swapInfo.fundingCex = funding.cex;
        } else {
          swapInfo.fundingSource = null;
          swapInfo.fundingCex = null;
        }

        // Send alert
        await sendTelegramAlert(swapInfo);

        // Cluster tracking
        if (txCount >= 0 && txCount < 50 && swapInfo.tokenAddress) {
          trackBuy(swapInfo.tokenAddress, swapInfo);
          
          var cluster = checkForCluster(swapInfo.tokenAddress);
          
          if (cluster.isCluster) {
            var lastAlert = alertedClusters.get(swapInfo.tokenAddress);
            if (!lastAlert || Date.now() - lastAlert > CLUSTER_ALERT_COOLDOWN) {
              await sendClusterAlert(swapInfo.tokenAddress, swapInfo.tokenSymbol, swapInfo.tokenName, swapInfo.tokenAge, cluster);
              alertedClusters.set(swapInfo.tokenAddress, Date.now());
            }
          }
        }
      } catch (error) {
        console.error('Error processing swap:', error.message);
      }
    }
  } catch (error) {
    console.error('Webhook error:', error.message);
  }
});

app.get('/health', function(req, res) {
  res.json({ 
    status: 'healthy', 
    dedupCacheSize: recentAlerts.size,
    thresholds: {
      fresh: THRESHOLD_FRESH,
      newish: THRESHOLD_NEWISH,
      established: THRESHOLD_ESTABLISHED
    }
  });
});

app.get('/', function(req, res) {
  res.json({
    name: 'Solana Whale Alert Bot v2',
    status: 'running',
    features: ['cluster_detection', 'dynamic_thresholds', 'token_age', 'extended_dex'],
    thresholds: {
      fresh_wallets: THRESHOLD_FRESH + ' SOL',
      newish_wallets: THRESHOLD_NEWISH + ' SOL',
      established_wallets: THRESHOLD_ESTABLISHED + ' SOL'
    }
  });
});

app.listen(PORT, function() {
  console.log('Solana Whale Alert Bot v2 running on port ' + PORT);
  console.log('Thresholds - Fresh: ' + THRESHOLD_FRESH + ' SOL, New-ish: ' + THRESHOLD_NEWISH + ' SOL, Established: ' + THRESHOLD_ESTABLISHED + ' SOL');
});
