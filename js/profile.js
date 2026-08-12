// Local player profile: name, coins, unlocked-card collection, stats.
// Persisted in localStorage (no server auth — this is a local "login").
import { starterUnlocked, allCardIds, rarityOf, RARITY, PACK, GEM_PACK, CARD_SHOP_PRICES, GEM_EXCHANGE, RANK, isTopRank } from './constants.js';

const KEY = 'inscryption_profile_v1';

// Curated Emoji avatar set (mystical / creature theme). Players pick one for
// their profile; it is stored locally and shared with opponents in-match.
export const AVATARS = [
  '🦇', '🔥', '💀', '🐺', '🌿', '⚡', '🐍', '🦅',
  '🐉', '👁️', '🌑', '🔮', '🩸', '🦂', '🌟', '🐈‍⬛',
  '🦊', '🐻', '🦌', '🕯️', '🪦', '⚔️', '🛡️', '👹',
  '🧙', '🐲', '🦴', '🌋', '🍄', '🦗', '🌙', '🪞',
];
export function randomAvatar() { return AVATARS[Math.floor(Math.random() * AVATARS.length)]; }

function normalize(p) {
  p.name = p.name || '玩家';
  p.avatar = (typeof p.avatar === 'string' && p.avatar) ? p.avatar : randomAvatar();
  p.coins = Number.isFinite(p.coins) ? p.coins : 0;
  p.gems = Number.isFinite(p.gems) ? p.gems : 0;
  p.muted = !!p.muted;
  p.aiLevel = ['easy', 'normal', 'hard'].includes(p.aiLevel) ? p.aiLevel : 'normal';
  p.unlocked = Array.from(new Set(p.unlocked || []));
  // 排位赛段位：默认 一阶·下，0 晋级分。
  p.rank = p.rank || { tier: 1, div: 0, points: 0 };
  p.rank.tier = Math.min(RANK.TIERS, Math.max(1, p.rank.tier || 1));
  p.rank.div = Math.min(RANK.DIVS - 1, Math.max(0, p.rank.div || 0));
  p.rank.points = Math.max(0, p.rank.points || 0);
  p.stats = p.stats || {};
  p.stats.wins = p.stats.wins || 0;
  p.stats.losses = p.stats.losses || 0;
  p.stats.packs = p.stats.packs || 0;
  p.stats.rankedWins = p.stats.rankedWins || 0;
  p.stats.rankedLosses = p.stats.rankedLosses || 0;
  // Last-used deck (persisted so the deck builder reopens with the previous setup).
  if (p.deck && Array.isArray(p.deck.cards)) {
    p.deck = { res: p.deck.res || 'blood', cards: p.deck.cards.slice() };
  } else {
    p.deck = null;
  }
  return p;
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && p.name) return normalize(p);
  } catch (_) {}
  return null;
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) {}
}

export function createProfile(name) {
  const p = normalize({
    name: (name || '玩家').slice(0, 12),
    avatar: randomAvatar(),
    coins: PACK.startCoins,
    gems: 0,
    unlocked: starterUnlocked(),
    rank: { tier: 1, div: 0, points: 0 },
    stats: { wins: 0, losses: 0, packs: 0, rankedWins: 0, rankedLosses: 0 },
  });
  saveProfile(p);
  return p;
}

export function isUnlocked(p, id) { return p.unlocked.includes(id); }

// Persist the player's last-configured deck so the builder reopens with it next time.
export function saveDeck(p, deck) {
  p.deck = (deck && Array.isArray(deck.cards) && deck.cards.length)
    ? { res: deck.res || 'blood', cards: deck.cards.slice() }
    : null;
  saveProfile(p);
}

export function addCoins(p, n) { p.coins = Math.max(0, p.coins + n); saveProfile(p); }

// ---------- 魂晶 (premium currency) ----------
export function addGems(p, n) { p.gems = Math.max(0, p.gems + n); saveProfile(p); }

export function spendGems(p, n) {
  if (p.gems < n) return false;
  p.gems -= n; saveProfile(p); return true;
}

// 充值：模拟支付，直接到账魂晶（含首充奖励等可在此扩展）
export function recharge(p, pkg) {
  p.gems += pkg.gems + (pkg.bonus || 0);
  saveProfile(p);
  return { ok: true, gems: pkg.gems + (pkg.bonus || 0), total: p.gems };
}

// 魂晶兑换金币
export function exchangeGemsForCoins(p, gems) {
  if (!Number.isFinite(gems) || gems < GEM_EXCHANGE.minGems) return { ok: false, reason: `最少兑换 ${GEM_EXCHANGE.minGems} 魂晶` };
  if (p.gems < gems) return { ok: false, reason: '魂晶不足' };
  p.gems -= gems;
  const coins = gems * GEM_EXCHANGE.rate;
  p.coins += coins;
  saveProfile(p);
  return { ok: true, coins, gems };
}

// 暗夜卡包：魂晶购买，使用 GEM_PACK 权重，保底 rare+
function weightedRandomCardGem(exclude) {
  const ids = allCardIds();
  const w = ids.map((id) => {
    if (exclude && exclude.has(id)) return 0;
    const rk = rarityOf(id);
    // 保底 rare+：common 权重归零
    if (rk === 'common') return 0;
    return GEM_PACK.weights[rk] || 0;
  });
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // 安全兜底：从 rare+ 中随机（含 mythic）
    const pool = ids.filter((id) => ['rare', 'epic', 'legend', 'mythic'].includes(rarityOf(id)));
    return pool[Math.floor(Math.random() * pool.length)] || ids[0];
  }
  let r = Math.random() * total;
  for (let i = 0; i < ids.length; i++) { r -= w[i]; if (r <= 0) return ids[i]; }
  return ids[ids.length - 1];
}

export function drawGemPack(p) {
  if (p.gems < GEM_PACK.cost) return { ok: false, reason: `魂晶不足，需要 ${GEM_PACK.cost} 💎` };
  p.gems -= GEM_PACK.cost;
  p.stats.packs++;

  const owned = new Set(p.unlocked.filter((id) => allCardIds().includes(id)));
  const collectionFull = owned.size >= allCardIds().length;

  let id;
  if (collectionFull) {
    id = weightedRandomCardGem(null);
  } else if (Math.random() < (GEM_PACK.residualDupChance || 0)) {
    id = weightedRandomCardGem(null);
  } else {
    id = weightedRandomCardGem(owned);
  }

  const rarity = rarityOf(id);
  let dup = false, dust = 0;
  if (owned.has(id)) {
    dup = true; dust = RARITY[rarity].dust; p.coins += dust;   // 重复 → 返还金币（同普通包）
  } else {
    p.unlocked.push(id);
  }
  saveProfile(p);
  return { ok: true, id, rarity, dup, dust, premium: true };
}

// 直购：用魂晶直接购买指定卡牌（跳过随机）
export function buyCardDirect(p, id) {
  if (!allCardIds().includes(id)) return { ok: false, reason: '卡牌不存在' };
  if (p.unlocked.includes(id)) return { ok: false, reason: '已拥有该卡牌' };
  const rk = rarityOf(id);
  const price = CARD_SHOP_PRICES[rk];
  if (p.gems < price) return { ok: false, reason: `魂晶不足，需要 ${price} 💎`, price };
  p.gems -= price;
  p.unlocked.push(id);
  saveProfile(p);
  return { ok: true, id, rarity: rk, price };
}

export function recordResult(p, won) {
  if (won) { p.stats.wins++; p.coins += PACK.winReward; }
  else { p.stats.losses++; p.coins += PACK.loseReward; }
  saveProfile(p);
  return won ? PACK.winReward : PACK.loseReward;
}

// 排位赛结算：仅限 PVP。玩家1（账户持有者）胜 → 升晋级分；负 → 降晋级分。
// 满 DIV_PROMOTE 晋升上一小阶（下→中→上→下一阶），归零则降下一小阶；
// 封顶 六阶·上（不可再升），封底 一阶·下（不可再降）。
export function recordRanked(p, won) {
  const r = p.rank;
  let promoted = false, demoted = false;
  if (won) {
    p.stats.rankedWins++;
    r.points += RANK.POINTS_WIN;
    while (r.points >= RANK.DIV_PROMOTE && !(r.tier >= RANK.TIERS && r.div >= RANK.DIVS - 1)) {
      r.points -= RANK.DIV_PROMOTE;
      if (r.div < RANK.DIVS - 1) r.div++;
      else { r.div = 0; r.tier++; }
      promoted = true;
    }
    // 已登顶（六阶·上）时，晋级分不再累加，封顶在阈值。
    if (r.tier >= RANK.TIERS && r.div >= RANK.DIVS - 1) r.points = Math.min(r.points, RANK.DIV_PROMOTE);
  } else {
    p.stats.rankedLosses++;
    r.points -= RANK.POINTS_LOSE;
    if (r.points < 0) {
      if (r.tier <= 1 && r.div <= 0) {
        r.points = 0;                       // 已是最低阶，不可再降
      } else {
        if (r.div > 0) r.div--;
        else { r.div = RANK.DIVS - 1; r.tier--; }
        r.points = 0;
        demoted = true;
      }
    }
  }
  saveProfile(p);
  return { ok: true, won, promoted, demoted, rank: { ...r }, points: r.points, top: isTopRank(r) };
}

// Weighted random card by rarity weight. Pass `exclude` (a Set of owned ids)
// to zero out already-owned cards — this lets us draw from the "not-yet-owned"
// pool while STILL respecting the rarity weights (quality unchanged), so the
// distribution of acquired cards stays faithful to RARITY.
function weightedRandomCard(exclude) {
  const ids = allCardIds();
  const w = ids.map((id) => (exclude && exclude.has(id)) ? 0 : RARITY[rarityOf(id)].weight);
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return ids[Math.floor(Math.random() * ids.length)]; // safety fallback
  let r = Math.random() * total;
  for (let i = 0; i < ids.length; i++) { r -= w[i]; if (r <= 0) return ids[i]; }
  return ids[ids.length - 1];
}

// Open one pack: spend coins, roll a card.
// 在不改变品质（稀有度权重）的前提下：
//   · 图鉴未集齐时，始终从「尚未拥有」的卡池按稀有度抽取（residualDupChance=0 → 绝不重复）；
//   · 图鉴集齐后，只能抽到已拥有的卡（必然重复），一律按稀有度返还金币（dust）。
export function drawPack(p) {
  if (p.coins < PACK.cost) return { ok: false, reason: '金币不足，先去对战赢取金币吧' };
  p.coins -= PACK.cost;
  p.stats.packs++;

  const owned = new Set(p.unlocked.filter((id) => allCardIds().includes(id)));
  const collectionFull = owned.size >= allCardIds().length;

  let id;
  if (collectionFull) {
    id = weightedRandomCard(null);                 // 已集齐：只能重复（返还金币）
  } else if (Math.random() < (PACK.residualDupChance || 0)) {
    id = weightedRandomCard(null);                 // 少量情况仍可能抽到重复
  } else {
    id = weightedRandomCard(owned);                // 主要从“未拥有”卡池抽取，降低重复
  }

  const rarity = rarityOf(id);
  let dup = false, dust = 0;
  if (owned.has(id)) {
    dup = true; dust = RARITY[rarity].dust; p.coins += dust;   // 重复 → 返还金币
  } else {
    p.unlocked.push(id);
  }
  saveProfile(p);
  return { ok: true, id, rarity, dup, dust };
}

export function collectionProgress(p) {
  const all = allCardIds();
  return { have: p.unlocked.filter((id) => all.includes(id)).length, total: all.length };
}
