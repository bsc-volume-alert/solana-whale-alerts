const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const PORT = process.env.PORT || 3000;

// WSOL mint address
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Stablecoins and wrapped majors to filter out - not alpha signals
const STABLECOINS = [
  // Stablecoins
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX',  // USDH
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',  // USDS
  'EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCCWMpXLeBjVx', // DAI
  'Ea5SjE2Y6yvCeW5dYTn7PYMuW5ikXkvbGdcmSnXeaLjS', // PAI
  'BJUH9GJLaMSLV1E7B3SQLCy9eCfyr6zsrwGcpS2MkqR1', // wUST
  '9vMJfxuKxXBoEa7rM12mYLMwTacLMLDJqHozw96WQL8i', // UST
  '7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT', // UXD
  // Wrapped ETH
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // WETH (Wormhole)
  'So11111111111111111111111111111111111111112',  // WSOL
  // Wrapped BTC
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', // cbBTC (Coinbase)
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // WBTC (Wormhole)
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', // BTC (Sollet)
];

// Known old tokens - skip age calculation for these
const KNOWN_OLD_TOKENS = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'So11111111111111111111111111111111111111112',  // WSOL
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',  // HNT
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  // RENDER
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // ETHER (Wormhole)
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  'AFbX8oGjGpmVFywbVouvhQSRmiW2aR1mohfahi4Y2AdB', // GST
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',  // ORCA
  'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt',  // SRM
  'kinXdEcpDQeHPEuQnqmUgtYykqKGVFq6CeVX5iAHJq6',  // KIN
  'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey',  // MNDE
];

// Dynamic thresholds based on wallet freshness
const THRESHOLD_FRESH = 20;
const THRESHOLD_NEWISH = 30;
const THRESHOLD_ESTABLISHED = 30;

// Accumulation tracking settings
const ACCUMULATION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const ACCUMULATION_THRESHOLD = 30; // Alert if wallet accumulates 30+ SOL total
const ACCUMULATION_MIN_BUYS = 2; // Minimum buys to trigger

// Multi-wallet detection settings
const MULTI_WALLET_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MULTI_WALLET_MIN = 2; // 2+ wallets from same funder

// Cluster detection settings
const CLUSTER_WINDOW_MS = 10 * 60 * 1000;
const CLUSTER_MIN_WALLETS = 3;

// Caches
const walletCache = new Map();
const CACHE_DURATION = 3600000;

const recentAlerts = new Map();
const DEDUP_DURATION = 300000;

const recentBuys = new Map();

const tokenAgeCache = new Map();
const TOKEN_AGE_CACHE_DURATION = 3600000;

const tokenInfoCache = new Map();
const TOKEN_INFO_CACHE_DURATION = 3600000;

// Accumulation tracking: wallet -> [{token, amount, timestamp}, ...]
const walletAccumulation = new Map();

// Multi-wallet tracking: funder -> [{wallet, token, amount, timestamp}, ...]
const funderTracking = new Map();

// Cooldowns for new alert types
const accumulationAlerts = new Map();
const multiWalletAlerts = new Map();
const ACCUMULATION_COOLDOWN = 30 * 60 * 1000;
const MULTI_WALLET_COOLDOWN = 30 * 60 * 1000;

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

// Track wallet accumulation
function trackAccumulation(wallet, tokenAddress, tokenSymbol, amount) {
  var now = Date.now();
  var key = wallet;
  
  if (!walletAccumulation.has(key)) {
    walletAccumulation.set(key, []);
  }
  
  var buys = walletAccumulation.get(key);
  buys.push({ token: tokenAddress, symbol: tokenSymbol, amount: amount, timestamp: now });
  
  // Clean old entries
  var validBuys = buys.filter(function(b) {
    return now - b.timestamp < ACCUMULATION_WINDOW_MS;
  });
  walletAccumulation.set(key, validBuys);
  
  // Check for accumulation on same token
  var tokenBuys = validBuys.filter(function(b) { return b.token === tokenAddress; });
  if (tokenBuys.length >= ACCUMULATION_MIN_BUYS) {
    var totalSol = tokenBuys.reduce(function(sum, b) { return sum + b.amount; }, 0);
    if (totalSol >= ACCUMULATION_THRESHOLD) {
      return { isAccumulating: true, buys: tokenBuys, totalSol: totalSol };
    }
  }
  
  return { isAccumulating: false };
}

// Track multi-wallet from same funder
function trackMultiWallet(funder, wallet, tokenAddress, tokenSymbol, amount) {
  if (!funder) return { isMultiWallet: false };
  
  var now = Date.now();
  
  if (!funderTracking.has(funder)) {
    funderTracking.set(funder, []);
  }
  
  var wallets = funderTracking.get(funder);
  wallets.push({ wallet: wallet, token: tokenAddress, symbol: tokenSymbol, amount: amount, timestamp: now });
  
  // Clean old entries
  var validWallets = wallets.filter(function(w) {
    return now - w.timestamp < MULTI_WALLET_WINDOW_MS;
  });
  funderTracking.set(funder, validWallets);
  
  // Check for multiple wallets buying same token
  var tokenBuys = validWallets.filter(function(w) { return w.token === tokenAddress; });
  var uniqueWallets = [];
  var seen = {};
  for (var i = 0; i < tokenBuys.length; i++) {
    if (!seen[tokenBuys[i].wallet]) {
      seen[tokenBuys[i].wallet] = true;
      uniqueWallets.push(tokenBuys[i]);
    }
  }
  
  if (uniqueWallets.length >= MULTI_WALLET_MIN) {
    var totalSol = uniqueWallets.reduce(function(sum, w) { return sum + w.amount; }, 0);
    return { isMultiWallet: true, wallets: uniqueWallets, totalSol: totalSol, funder: funder };
  }
  
  return { isMultiWallet: false };
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

async function getTokenInfoFromDexScreener(tokenAddress) {
  try {
    var url = 'https://api.dexscreener.com/latest/dex/tokens/' + tokenAddress;
    var response = await axios.get(url);
    
    if (response.data && response.data.pairs && response.data.pairs.length > 0) {
      var pair = response.data.pairs[0];
      if (pair.baseToken && pair.baseToken.symbol) {
        return {
          symbol: pair.baseToken.symbol,
          name: pair.baseToken.name || 'Unknown'
        };
      }
    }
    return null;
  } catch (error) {
    console.error('Error fetching token info from DexScreener:', error.message);
    return null;
  }
}

async function getTokenInfo(tokenAddress) {
  var cached = tokenInfoCache.get(tokenAddress);
  if (cached && Date.now() - cached.timestamp < TOKEN_INFO_CACHE_DURATION) {
    return cached.info;
  }
  
  var symbol = tokenAddress.slice(0, 8);
  var name = 'Unknown';
  
  // Try Helius first
  try {
    var url = 'https://api.helius.xyz/v0/token-metadata?api-key=' + HELIUS_API_KEY;
    var response = await axios.post(url, { mintAccounts: [tokenAddress] });
    if (response.data && response.data.length > 0) {
      var token = response.data[0];
      symbol = (token.onChainMetadata && token.onChainMetadata.metadata && token.onChainMetadata.metadata.data && token.onChainMetadata.metadata.data.symbol) ||
               (token.legacyMetadata && token.legacyMetadata.symbol) ||
               (token.offChainMetadata && token.offChainMetadata.metadata && token.offChainMetadata.metadata.symbol) ||
               tokenAddress.slice(0, 8);
      name = (token.onChainMetadata && token.onChainMetadata.metadata && token.onChainMetadata.metadata.data && token.onChainMetadata.metadata.data.name) ||
             (token.legacyMetadata && token.legacyMetadata.name) ||
             (token.offChainMetadata && token.offChainMetadata.metadata && token.offChainMetadata.metadata.name) ||
             'Unknown';
    }
  } catch (error) {
    console.error('Error fetching token info from Helius:', error.message);
  }
  
  // If Helius didn't return good data, try DexScreener as fallback
  if (name === 'Unknown' || symbol === tokenAddress.slice(0, 8)) {
    var dexScreenerInfo = await getTokenInfoFromDexScreener(tokenAddress);
    if (dexScreenerInfo) {
      if (dexScreenerInfo.name !== 'Unknown') {
        name = dexScreenerInfo.name;
      }
      if (dexScreenerInfo.symbol !== tokenAddress.slice(0, 8)) {
        symbol = dexScreenerInfo.symbol;
      }
    }
  }
  
  var info = { symbol: symbol, name: name };
  tokenInfoCache.set(tokenAddress, { info: info, timestamp: Date.now() });
  return info;
}

async function getTokenMetrics(tokenAddress) {
  var emptyMetrics = { age: null, marketCap: null, priceChange1h: null, priceChange6h: null, volume1h: null, volume6h: null };
  
  if (KNOWN_OLD_TOKENS.includes(tokenAddress)) {
    return emptyMetrics;
  }
  
  var cached = tokenAgeCache.get(tokenAddress);
  if (cached && Date.now() - cached.timestamp < TOKEN_AGE_CACHE_DURATION) {
    return cached.metrics;
  }
  
  try {
    var url = 'https://api.dexscreener.com/latest/dex/tokens/' + tokenAddress;
    var response = await axios.get(url);
    
    if (response.data && response.data.pairs && response.data.pairs.length > 0) {
      // Find the pair with highest liquidity for best data
      var bestPair = response.data.pairs.reduce(function(best, pair) {
        var bestLiq = (best && best.liquidity && best.liquidity.usd) || 0;
        var pairLiq = (pair.liquidity && pair.liquidity.usd) || 0;
        return pairLiq > bestLiq ? pair : best;
      }, null);
      
      // Find oldest pair for age
      var oldestPair = response.data.pairs.reduce(function(oldest, pair) {
        if (!oldest || (pair.pairCreatedAt && pair.pairCreatedAt < oldest.pairCreatedAt)) {
          return pair;
        }
        return oldest;
      }, null);
      
      var metrics = {
        age: oldestPair && oldestPair.pairCreatedAt ? Date.now() - oldestPair.pairCreatedAt : null,
        marketCap: bestPair && bestPair.marketCap ? bestPair.marketCap : null,
        priceChange1h: bestPair && bestPair.priceChange && bestPair.priceChange.h1 !== undefined ? bestPair.priceChange.h1 : null,
        priceChange6h: bestPair && bestPair.priceChange && bestPair.priceChange.h6 !== undefined ? bestPair.priceChange.h6 : null,
        volume1h: bestPair && bestPair.volume && bestPair.volume.h1 !== undefined ? bestPair.volume.h1 : null,
        volume6h: bestPair && bestPair.volume && bestPair.volume.h6 !== undefined ? bestPair.volume.h6 : null
      };
      
      tokenAgeCache.set(tokenAddress, { metrics: metrics, timestamp: Date.now() });
      return metrics;
    }
    
    tokenAgeCache.set(tokenAddress, { metrics: emptyMetrics, timestamp: Date.now() });
    return emptyMetrics;
  } catch (error) {
    console.error('Error fetching token metrics from DexScreener:', error.message);
    return emptyMetrics;
  }
}

function formatAge(ageMs) {
  if (!ageMs) return null;
  
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

function formatMarketCap(mc) {
  if (!mc && mc !== 0) return null;
  if (mc >= 1000000000) {
    return '$' + (mc / 1000000000).toFixed(2) + 'B';
  } else if (mc >= 1000000) {
    return '$' + (mc / 1000000).toFixed(2) + 'M';
  } else if (mc >= 1000) {
    return '$' + (mc / 1000).toFixed(1) + 'K';
  } else {
    return '$' + mc.toFixed(0);
  }
}

function formatVolume(vol) {
  if (!vol && vol !== 0) return null;
  if (vol >= 1000000) {
    return '$' + (vol / 1000000).toFixed(2) + 'M';
  } else if (vol >= 1000) {
    return '$' + (vol / 1000).toFixed(1) + 'K';
  } else {
    return '$' + vol.toFixed(0);
  }
}

function formatPriceChange(change) {
  if (change === null || change === undefined) return null;
  var sign = change >= 0 ? '+' : '';
  return sign + change.toFixed(1) + '%';
}

async function sendClusterAlert(tokenAddress, tokenSymbol, tokenName, tokenMetrics, cluster) {
  try {
    var ageStr = formatAge(tokenMetrics.age);
    var isNewToken = tokenMetrics.age && tokenMetrics.age < 24 * 60 * 60 * 1000;
    var mcStr = formatMarketCap(tokenMetrics.marketCap);
    var price1h = formatPriceChange(tokenMetrics.priceChange1h);
    var price6h = formatPriceChange(tokenMetrics.priceChange6h);
    var vol1h = formatVolume(tokenMetrics.volume1h);
    var vol6h = formatVolume(tokenMetrics.volume6h);
    
    var message = '\u{1F6A8} <b>CLUSTER ALERT</b> \u{1F6A8}\n';
    message += '\u{1F534} \u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\n\n';
    message += '\u{1FA99} Token: ' + (tokenName !== 'Unknown' ? tokenName + ' (' + tokenSymbol + ')' : tokenSymbol) + '\n';
    message += '\u{1F4CD} Contract: <a href="https://solscan.io/token/' + tokenAddress + '">' + tokenAddress.slice(0, 8) + '...' + tokenAddress.slice(-4) + '</a>\n';
    if (mcStr) {
      message += '\u{1F48E} Market Cap: ' + mcStr + '\n';
    }
    if (ageStr) {
      message += '\u{23F0} Age: ' + (isNewToken ? '\u{1F525} ' : '') + ageStr + '\n';
    }
    message += '\n\u{1F7E1} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n\n';
    message += '\u{1F465} <b>' + cluster.buys.length + ' fresh wallets bought in 10 mins:</b>\n\n';
    
    for (var i = 0; i < cluster.buys.length; i++) {
      var buy = cluster.buys[i];
      var shortWallet = buy.wallet.slice(0, 4) + '...' + buy.wallet.slice(-4);
      var fundingStr = buy.fundingCex ? ' (' + buy.fundingCex + ')' : '';
      message += '\u{1F45B} <a href="https://gmgn.ai/sol/address/' + buy.wallet + '">' + shortWallet + '</a>: ' + buy.solAmount.toFixed(1) + ' SOL' + fundingStr + '\n';
    }
    
    message += '\n\u{1F4B0} Total: ' + cluster.totalSol.toFixed(1) + ' SOL\n';
    message += '\n\u{1F7E2} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n\n';
    if (price1h || price6h) {
      message += '\u{1F4C8} Price: ' + (price1h || 'N/A') + ' (1h) \u{2022} ' + (price6h || 'N/A') + ' (6h)\n';
    }
    if (vol1h || vol6h) {
      message += '\u{1F4CA} Vol: ' + (vol1h || 'N/A') + ' (1h) \u{2022} ' + (vol6h || 'N/A') + ' (6h)\n';
    }
    message += '\n\u{1F517} <a href="https://dexscreener.com/solana/' + tokenAddress + '">Dexscreener</a>';
    message += ' | <a href="https://axiom.trade/t/' + tokenAddress + '">Axiom</a>';
    message += ' | <a href="https://twitter.com/search?q=' + tokenAddress + '">Twitter</a>';

    var telegramUrl = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
    await axios.post(telegramUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    console.log('CLUSTER ALERT sent for ' + tokenSymbol);
  } catch (error) {
    console.error('Error sending cluster alert:', error.message);
  }
}

async function sendAccumulationAlert(wallet, tokenAddress, tokenSymbol, tokenName, tokenMetrics, accumulation) {
  try {
    var mcStr = formatMarketCap(tokenMetrics.marketCap);
    var price1h = formatPriceChange(tokenMetrics.priceChange1h);
    var price6h = formatPriceChange(tokenMetrics.priceChange6h);
    var vol1h = formatVolume(tokenMetrics.volume1h);
    var vol6h = formatVolume(tokenMetrics.volume6h);
    
    var message = '\u{1F4E6} <b>ACCUMULATION ALERT</b>\n';
    message += '\u{1F7E3} \u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\n\n';
    message += '\u{1FA99} Token: ' + (tokenName !== 'Unknown' ? tokenName + ' (' + tokenSymbol + ')' : tokenSymbol) + '\n';
    message += '\u{1F4CD} Contract: <a href="https://solscan.io/token/' + tokenAddress + '">' + tokenAddress.slice(0, 8) + '...' + tokenAddress.slice(-4) + '</a>\n';
    if (mcStr) {
      message += '\u{1F48E} Market Cap: ' + mcStr + '\n';
    }
    message += '\n\u{1F7E1} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n\n';
    message += '\u{1F45B} Wallet: <a href="https://gmgn.ai/sol/address/' + wallet + '">' + wallet.slice(0, 4) + '...' + wallet.slice(-4) + '</a>\n';
    message += '\u{1F504} <b>' + accumulation.buys.length + ' buys in last 2 hours:</b>\n\n';
    
    for (var i = 0; i < accumulation.buys.length; i++) {
      var buy = accumulation.buys[i];
      var timeAgo = Math.floor((Date.now() - buy.timestamp) / 60000);
      message += '\u{1F4B0} ' + buy.amount.toFixed(1) + ' SOL (' + timeAgo + ' min ago)\n';
    }
    
    message += '\n\u{1F4B5} Total: ' + accumulation.totalSol.toFixed(1) + ' SOL\n';
    message += '\n\u{1F7E2} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n\n';
    if (price1h || price6h) {
      message += '\u{1F4C8} Price: ' + (price1h || 'N/A') + ' (1h) \u{2022} ' + (price6h || 'N/A') + ' (6h)\n';
    }
    if (vol1h || vol6h) {
      message += '\u{1F4CA} Vol: ' + (vol1h || 'N/A') + ' (1h) \u{2022} ' + (vol6h || 'N/A') + ' (6h)\n';
    }
    message += '\n\u{1F517} <a href="https://dexscreener.com/solana/' + tokenAddress + '">Dexscreener</a>';
    message += ' | <a href="https://axiom.trade/t/' + tokenAddress + '">Axiom</a>';
    message += ' | <a href="https://twitter.com/search?q=' + tokenAddress + '">Twitter</a>';

    var telegramUrl = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
    await axios.post(telegramUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    console.log('ACCUMULATION ALERT sent for ' + tokenSymbol);
  } catch (error) {
    console.error('Error sending accumulation alert:', error.message);
  }
}

async function sendMultiWalletAlert(tokenAddress, tokenSymbol, tokenName, tokenMetrics, multiWallet) {
  try {
    var shortFunder = multiWallet.funder.slice(0, 4) + '...' + multiWallet.funder.slice(-4);
    var mcStr = formatMarketCap(tokenMetrics.marketCap);
    var price1h = formatPriceChange(tokenMetrics.priceChange1h);
    var price6h = formatPriceChange(tokenMetrics.priceChange6h);
    var vol1h = formatVolume(tokenMetrics.volume1h);
    var vol6h = formatVolume(tokenMetrics.volume6h);
    
    var message = '\u{1F441} <b>MULTI-WALLET ALERT</b>\n';
    message += '\u{1F7E0} \u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\n\n';
    message += '\u{1FA99} Token: ' + (tokenName !== 'Unknown' ? tokenName + ' (' + tokenSymbol + ')' : tokenSymbol) + '\n';
    message += '\u{1F4CD} Contract: <a href="https://solscan.io/token/' + tokenAddress + '">' + tokenAddress.slice(0, 8) + '...' + tokenAddress.slice(-4) + '</a>\n';
    if (mcStr) {
      message += '\u{1F48E} Market Cap: ' + mcStr + '\n';
    }
    message += '\n\u{1F7E1} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n\n';
    message += '\u{1F3E6} Funder: <a href="https://gmgn.ai/sol/address/' + multiWallet.funder + '">' + shortFunder + '</a>\n';
    message += '\u{1F465} <b>' + multiWallet.wallets.length + ' wallets from same source:</b>\n\n';
    
    for (var i = 0; i < multiWallet.wallets.length; i++) {
      var w = multiWallet.wallets[i];
      var shortWallet = w.wallet.slice(0, 4) + '...' + w.wallet.slice(-4);
      message += '\u{1F45B} <a href="https://gmgn.ai/sol/address/' + w.wallet + '">' + shortWallet + '</a>: ' + w.amount.toFixed(1) + ' SOL\n';
    }
    
    message += '\n\u{1F4B0} Total: ' + multiWallet.totalSol.toFixed(1) + ' SOL\n';
    message += '\n\u{1F7E2} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n\n';
    if (price1h || price6h) {
      message += '\u{1F4C8} Price: ' + (price1h || 'N/A') + ' (1h) \u{2022} ' + (price6h || 'N/A') + ' (6h)\n';
    }
    if (vol1h || vol6h) {
      message += '\u{1F4CA} Vol: ' + (vol1h || 'N/A') + ' (1h) \u{2022} ' + (vol6h || 'N/A') + ' (6h)\n';
    }
    message += '\n\u{1F517} <a href="https://dexscreener.com/solana/' + tokenAddress + '">Dexscreener</a>';
    message += ' | <a href="https://axiom.trade/t/' + tokenAddress + '">Axiom</a>';
    message += ' | <a href="https://twitter.com/search?q=' + tokenAddress + '">Twitter</a>';

    var telegramUrl = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
    await axios.post(telegramUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    console.log('MULTI-WALLET ALERT sent for ' + tokenSymbol);
  } catch (error) {
    console.error('Error sending multi-wallet alert:', error.message);
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
    var tokenMetrics = swapData.tokenMetrics || {};

    var freshnessLine;
    if (txCount >= 0) {
      var indicator = getFreshnessIndicator(txCount);
      freshnessLine = indicator.emoji + ' <b>' + indicator.label + '</b> (' + txCount + ' tx)';
    } else {
      freshnessLine = '\u{26AB} <b>UNKNOWN</b> (could not fetch)';
    }

    var fundingLine = '';
    if (fundingCex) {
      fundingLine = '\u{1F3E6} Funded: <b>' + fundingCex + '</b>';
    } else if (fundingSource) {
      var shortSource = fundingSource.slice(0, 4) + '...' + fundingSource.slice(-4);
      fundingLine = '\u{1F3E6} Funded: ' + shortSource;
    }

    var shortWallet = wallet.slice(0, 4) + '...' + wallet.slice(-4);
    
    var tokenDisplay;
    if (tokenName !== 'Unknown' && tokenName !== tokenSymbol) {
      tokenDisplay = tokenName + ' (' + tokenSymbol + ')';
    } else {
      tokenDisplay = tokenSymbol;
    }

    var ageStr = formatAge(tokenMetrics.age);
    var isNewToken = tokenMetrics.age && tokenMetrics.age < 24 * 60 * 60 * 1000;
    var mcStr = formatMarketCap(tokenMetrics.marketCap);
    var price1h = formatPriceChange(tokenMetrics.priceChange1h);
    var price6h = formatPriceChange(tokenMetrics.priceChange6h);
    var vol1h = formatVolume(tokenMetrics.volume1h);
    var vol6h = formatVolume(tokenMetrics.volume6h);

    var message = '\u{1F40B} <b>BIG BUY ALERT</b>\n';
    message += '\u{1F535} \u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\n\n';
    message += '\u{1FA99} Token: ' + tokenDisplay + '\n';
    message += '\u{1F4CD} Contract: <a href="https://solscan.io/token/' + tokenAddress + '">' + tokenAddress.slice(0, 8) + '...' + tokenAddress.slice(-4) + '</a>\n';
    if (mcStr) {
      message += '\u{1F48E} Market Cap: ' + mcStr + '\n';
    }
    if (ageStr) {
      message += '\u{23F0} Age: ' + (isNewToken ? '\u{1F525} ' : '') + ageStr + '\n';
    }
    message += '\n\u{1F7E1} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n\n';
    message += '\u{1F45B} Wallet: <a href="https://gmgn.ai/sol/address/' + wallet + '">' + shortWallet + '</a>\n';
    message += '\u{1F4B0} Amount: ' + solAmount.toFixed(2) + ' SOL\n';
    message += '\u{1F504} DEX: ' + dex + '\n';
    message += freshnessLine + '\n';
    if (fundingLine) {
      message += fundingLine + '\n';
    }
    message += '\n\u{1F7E2} \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n\n';
    if (price1h || price6h) {
      message += '\u{1F4C8} Price: ' + (price1h || 'N/A') + ' (1h) \u{2022} ' + (price6h || 'N/A') + ' (6h)\n';
    }
    if (vol1h || vol6h) {
      message += '\u{1F4CA} Vol: ' + (vol1h || 'N/A') + ' (1h) \u{2022} ' + (vol6h || 'N/A') + ' (6h)\n';
    }
    message += '\n\u{1F517} <a href="https://solscan.io/tx/' + signature + '">TX</a>';
    message += ' | <a href="https://dexscreener.com/solana/' + tokenAddress + '">Dexscreener</a>';
    message += ' | <a href="https://axiom.trade/t/' + tokenAddress + '">Axiom</a>';
    message += ' | <a href="https://twitter.com/search?q=' + tokenAddress + '">Twitter</a>';

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

    // FIX 1: Better SOL calculation
    var solSpent = 0;
    
    // Native SOL transfers
    for (var i = 0; i < nativeTransfers.length; i++) {
      var transfer = nativeTransfers[i];
      if (transfer.fromUserAccount === feePayer) {
        var amount = transfer.amount || 0;
        // Convert lamports to SOL
        solSpent += amount / 1e9;
      }
    }

    // WSOL transfers - FIX: Handle both raw and decimal formats
    for (var w = 0; w < tokenTransfers.length; w++) {
      var tt = tokenTransfers[w];
      if (tt.mint === WSOL_MINT && tt.fromUserAccount === feePayer) {
        var wsolAmount = tt.tokenAmount || 0;
        
        // If amount looks like raw lamports (> 1000), convert
        if (wsolAmount > 1000) {
          wsolAmount = wsolAmount / 1e9;
        }
        
        solSpent += wsolAmount;
      }
    }

    // Sanity check - skip unrealistic amounts
    if (solSpent > 10000) {
      console.log('Warning: Unrealistic SOL amount ' + solSpent + ', skipping');
      return null;
    }

    var tokenSymbol = 'Unknown';
    var tokenAddress = '';
    for (var j = 0; j < tokenTransfers.length; j++) {
      var tkn = tokenTransfers[j];
      if (tkn.toUserAccount === feePayer && tkn.mint !== WSOL_MINT) {
        tokenSymbol = tkn.tokenSymbol || (tkn.mint ? tkn.mint.slice(0, 8) : 'Unknown');
        tokenAddress = tkn.mint || '';
        break;
      }
    }

    if (!tokenAddress) {
      for (var k = 0; k < tokenTransfers.length; k++) {
        var tk = tokenTransfers[k];
        if (tk.mint && tk.mint !== WSOL_MINT) {
          tokenSymbol = tk.tokenSymbol || tk.mint.slice(0, 8);
          tokenAddress = tk.mint;
          break;
        }
      }
    }

    var programIds = [];
    for (var p = 0; p < instructions.length; p++) {
      if (instructions[p].programId) {
        programIds.push(instructions[p].programId);
      }
    }

    if (tx.innerInstructions) {
      for (var m = 0; m < tx.innerInstructions.length; m++) {
        var inner = tx.innerInstructions[m];
        if (inner.instructions) {
          for (var q = 0; q < inner.instructions.length; q++) {
            if (inner.instructions[q].programId) {
              programIds.push(inner.instructions[q].programId);
            }
          }
        }
      }
    }

    if (tx.accountData) {
      for (var a = 0; a < tx.accountData.length; a++) {
        if (tx.accountData[a].account) {
          programIds.push(tx.accountData[a].account);
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
    res.status(200).json({ status: 'ok' });

    for (var i = 0; i < data.length; i++) {
      var tx = data[i];
      
      try {
        if (tx.type !== 'SWAP') continue;
        
        var sig = tx.signature || 'no-sig-' + Date.now() + '-' + i;
        if (isDuplicate(sig)) continue;

        var swapInfo = processSwapTransaction(tx);
        if (!swapInfo) continue;
        if (!swapInfo.tokenAddress) continue;
        
        // Skip stablecoins - not alpha signals
        if (STABLECOINS.includes(swapInfo.tokenAddress)) {
          continue;
        }

        console.log('Swap: ' + swapInfo.solAmount.toFixed(2) + ' SOL for ' + swapInfo.tokenSymbol);

        // Track ALL buys for accumulation (even small ones)
        var tokenInfo = await getTokenInfo(swapInfo.tokenAddress);
        swapInfo.tokenSymbol = tokenInfo.symbol;
        swapInfo.tokenName = tokenInfo.name;

        // Check accumulation for any buy >= 5 SOL
        if (swapInfo.solAmount >= 5) {
          var accumulation = trackAccumulation(swapInfo.wallet, swapInfo.tokenAddress, swapInfo.tokenSymbol, swapInfo.solAmount);
          if (accumulation.isAccumulating) {
            var accumKey = swapInfo.wallet + '-' + swapInfo.tokenAddress;
            var lastAccumAlert = accumulationAlerts.get(accumKey);
            if (!lastAccumAlert || Date.now() - lastAccumAlert > ACCUMULATION_COOLDOWN) {
              var accumMetrics = await getTokenMetrics(swapInfo.tokenAddress);
              await sendAccumulationAlert(swapInfo.wallet, swapInfo.tokenAddress, swapInfo.tokenSymbol, swapInfo.tokenName, accumMetrics, accumulation);
              accumulationAlerts.set(accumKey, Date.now());
            }
          }
        }

        // Skip small buys for main alert
        if (swapInfo.solAmount < THRESHOLD_FRESH) continue;

        var txCount = await getWalletTxCount(swapInfo.wallet);
        swapInfo.txCount = txCount;

        var freshnessInfo = getFreshnessIndicator(txCount >= 0 ? txCount : 100);
        if (swapInfo.solAmount < freshnessInfo.threshold) {
          console.log('Below dynamic threshold: ' + swapInfo.solAmount.toFixed(2) + ' < ' + freshnessInfo.threshold);
          continue;
        }

        console.log('ALERT: ' + swapInfo.solAmount.toFixed(2) + ' SOL for ' + swapInfo.tokenSymbol);

        swapInfo.tokenMetrics = await getTokenMetrics(swapInfo.tokenAddress);

        // Get funding source for fresh/new wallets
        if (txCount >= 0 && txCount < 50) {
          var funding = await getFundingSource(swapInfo.wallet);
          swapInfo.fundingSource = funding.wallet;
          swapInfo.fundingCex = funding.cex;
          
          // Track multi-wallet from same funder
          if (funding.wallet) {
            var multiWallet = trackMultiWallet(funding.wallet, swapInfo.wallet, swapInfo.tokenAddress, swapInfo.tokenSymbol, swapInfo.solAmount);
            if (multiWallet.isMultiWallet) {
              var multiKey = funding.wallet + '-' + swapInfo.tokenAddress;
              var lastMultiAlert = multiWalletAlerts.get(multiKey);
              if (!lastMultiAlert || Date.now() - lastMultiAlert > MULTI_WALLET_COOLDOWN) {
                await sendMultiWalletAlert(swapInfo.tokenAddress, swapInfo.tokenSymbol, swapInfo.tokenName, swapInfo.tokenMetrics, multiWallet);
                multiWalletAlerts.set(multiKey, Date.now());
              }
            }
          }
        } else {
          swapInfo.fundingSource = null;
          swapInfo.fundingCex = null;
        }

        await sendTelegramAlert(swapInfo);

        if (txCount >= 0 && txCount < 50 && swapInfo.tokenAddress) {
          trackBuy(swapInfo.tokenAddress, swapInfo);
          var cluster = checkForCluster(swapInfo.tokenAddress);
          if (cluster.isCluster) {
            var lastAlert = alertedClusters.get(swapInfo.tokenAddress);
            if (!lastAlert || Date.now() - lastAlert > CLUSTER_ALERT_COOLDOWN) {
              await sendClusterAlert(swapInfo.tokenAddress, swapInfo.tokenSymbol, swapInfo.tokenName, swapInfo.tokenMetrics, cluster);
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
    accumulationTracking: walletAccumulation.size,
    funderTracking: funderTracking.size,
    thresholds: {
      fresh: THRESHOLD_FRESH,
      newish: THRESHOLD_NEWISH,
      established: THRESHOLD_ESTABLISHED
    }
  });
});

app.get('/', function(req, res) {
  res.json({
    name: 'Solana Whale Alert Bot v3',
    status: 'running',
    features: ['cluster_detection', 'dynamic_thresholds', 'token_age', 'extended_dex', 'accumulation_tracking', 'multi_wallet_detection', 'stablecoin_filter', 'dexscreener_fallback'],
    thresholds: {
      fresh_wallets: THRESHOLD_FRESH + ' SOL',
      newish_wallets: THRESHOLD_NEWISH + ' SOL',
      established_wallets: THRESHOLD_ESTABLISHED + ' SOL'
    }
  });
});

app.listen(PORT, function() {
  console.log('Solana Whale Alert Bot v3 running on port ' + PORT);
  console.log('Thresholds - Fresh: ' + THRESHOLD_FRESH + ' SOL, New-ish: ' + THRESHOLD_NEWISH + ' SOL, Established: ' + THRESHOLD_ESTABLISHED + ' SOL');
});
