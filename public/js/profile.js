// Local player profile: name, coins, unlocked-card collection, stats.
// Persisted in localStorage (no server auth — this is a local "login").
import { starterUnlocked, allCardIds, rarityOf, RARITY, PACK } from './constants.js';

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
  p.muted = !!p.muted;
  p.aiLevel = ['easy', 'normal', 'hard'].includes(p.aiLevel) ? p.aiLevel : 'normal';
  p.unlocked = Array.from(new Set(p.unlocked || []));
  p.stats = p.stats || {};
  p.stats.wins = p.stats.wins || 0;
  p.stats.losses = p.stats.losses || 0;
  p.stats.packs = p.stats.packs || 0;
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
    unlocked: starterUnlocked(),
    stats: { wins: 0, losses: 0, packs: 0 },
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

export function recordResult(p, won) {
  if (won) { p.stats.wins++; p.coins += PACK.winReward; }
  else { p.stats.losses++; p.coins += PACK.loseReward; }
  saveProfile(p);
  return won ? PACK.winReward : PACK.loseReward;
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
