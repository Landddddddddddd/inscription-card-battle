// Authoritative, dependency-free game engine.
// Imported by BOTH the Node server (for LAN) and the browser (for single-player / tutorial).
// Pure logic only — no DOM, no network. Mutates the `state` object passed in.

import { CONFIG, CARDS, DECKS, GEMS, normalizeRules } from './constants.js';

// Per-game rule accessors (fall back to CONFIG for legacy states without rules).
const lanesOf = (state) => (state.rules && state.rules.lanes) || CONFIG.LANES;
const winScaleOf = (state) => (state.rules && state.rules.winScale) || CONFIG.WIN_SCALE;
const drawsOf = (state) => (state.rules && state.rules.drawPerTurn) || CONFIG.DRAW_PER_TURN;

let _uid = 0;
const uid = () => 'c' + (++_uid);
export const other = (p) => (p === 'A' ? 'B' : 'A');

export function instantiate(cardId) {
  const d = CARDS[cardId];
  if (!d) throw new Error('unknown card ' + cardId);
  return {
    iid: uid(),
    cardId,
    name: d.name,
    atk: d.atk,
    hp: d.hp,
    maxHp: d.hp,
    cost: d.cost,
    costType: d.costType,
    gemCost: (d.gemCost || []).slice(),
    mox: d.mox ?? null,
    sigils: d.sigils.slice(),
    bloodValue: d.bloodValue ?? 1,
    color: d.color,
    glyph: d.glyph,
    hasAttacked: false,
    undyingUsed: false,
  };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function initResources(pl) {
  // blood / bone / energy are refilled by beginTurn on each turn.
  // mox uses board-presence gems (computed from Mox creatures on the board),
  // so it needs no stored pool — nothing to initialize here.
}

export function createGame(opts = {}) {
  const rules = normalizeRules(opts.rules);
  const deckA = (opts.deckA || DECKS.blood).slice();
  const deckB = (opts.deckB || DECKS.blood).slice();
  const resA = opts.resA || 'blood';
  const resB = opts.resB || 'blood';
  const mkPly = (deck, name, res, key) => {
    const pl = { name, res, avatar: opts['avatar' + key] || '🜁', deck: shuffle(deck), hand: [], blood: 0, bloodCap: 0, bones: 0, energy: 0, energyMax: 0, energyRamp: 0, mox: 0, discard: [] };
    initResources(pl);
    return pl;
  };
  const state = {
    rules,
    players: {
      A: mkPly(deckA, opts.nameA || '玩家A', resA, 'A'),
      B: mkPly(deckB, opts.nameB || '玩家B', resB, 'B'),
    },
    board: { A: Array(rules.lanes).fill(null), B: Array(rules.lanes).fill(null) },
    // FIRST_HANDICAP: the first player (A) opens 1 point behind on the scale,
    // offsetting the inherent first-move advantage. Weights only change via
    // resolveAttacks, so this is the only place the opening handicap is set.
    weights: { A: -CONFIG.FIRST_HANDICAP, B: 0 },
    currentPlayer: 'A',
    turn: 0,
    winner: null,
    over: false,
    log: [],
    // Transient combat log for the renderer: each resolved attack pushes an
    // entry here, and combatSeq bumps so the UI shows damage numbers once.
    combatSeq: 0,
    lastCombat: [],
  };
  for (const p of ['A', 'B']) {
    for (let i = 0; i < CONFIG.HAND_START; i++) drawCard(state, p);
    // Every faction opens with 0-cost cards making up half the hand, so nobody
    // is resource-starved on turn 1 (see ensureZeroCostRatioInHand).
    ensureZeroCostRatioInHand(state, p);
    if (state.players[p].res === 'mox') ensureMoxGemInHand(state, p);
  }
  beginTurn(state, 'A');
  state.log.push('对局开始！目标是把对方的天平压到顶端。');
  return state;
}

function reshuffle(state, p) {
  const pl = state.players[p];
  if (pl.deck.length === 0 && pl.discard.length > 0) {
    pl.deck = shuffle(pl.discard.slice());
    pl.discard = [];
    state.log.push(`${pl.name} 洗牌（弃牌堆重新洗回牌库）`);
  }
}

function drawCard(state, p) {
  const pl = state.players[p];
  if (pl.hand.length >= CONFIG.HAND_LIMIT) return false;
  if (pl.deck.length === 0) reshuffle(state, p);
  if (pl.deck.length === 0) return false;
  pl.hand.push(instantiate(pl.deck.pop()));
  return true;
}

// For Mox players, make sure the opening hand contains at least one Mox gem
// creature, so they can start generating gems on turn 1 (otherwise they could
// be unable to cast anything until they draw one).
function ensureMoxGemInHand(state, p) {
  const pl = state.players[p];
  if (pl.hand.some((c) => c.mox)) return;
  const di = pl.deck.findIndex((id) => CARDS[id] && CARDS[id].mox);
  if (di < 0) return;
  const moxId = pl.deck.splice(di, 1)[0];
  const hi = pl.hand.findIndex((c) => !c.mox);
  if (hi >= 0) pl.deck.push(pl.hand.splice(hi, 1)[0].cardId);
  pl.hand.push(instantiate(moxId));
}

// Guarantee the opening hand contains 0-cost cards making up (about) HALF of it,
// so every faction can seed the board on turn 1 without being resource-starved.
// Works by swapping non-zero-cost cards in hand for 0-cost cards pulled from the
// deck, until the target count is met (or the deck runs out of 0-cost cards).
export function ensureZeroCostRatioInHand(state, p, ratio = 0.5) {
  const pl = state.players[p];
  const target = Math.floor(pl.hand.length * ratio); // HAND_START(4) * 0.5 = 2
  let have = pl.hand.filter((c) => c.cost === 0).length;
  let guard = 0;
  while (have < target && guard++ < 50) {
    const di = pl.deck.findIndex((id) => CARDS[id] && CARDS[id].cost === 0);
    if (di < 0) break;                                  // no 0-cost cards left in deck
    const zeroId = pl.deck.splice(di, 1)[0];
    const hi = pl.hand.findIndex((c) => c.cost > 0);    // a non-zero card to swap out
    if (hi < 0) { pl.deck.push(zeroId); break; }        // hand already all 0-cost
    pl.deck.push(pl.hand.splice(hi, 1)[0].cardId);
    pl.hand.push(instantiate(zeroId));
    have++;
  }
}

export function getAttack(state, side, lane) {
  const c = state.board[side][lane];
  if (!c) return 0;
  let a = c.atk;
  for (const n of [lane - 1, lane + 1]) {
    if (n < 0 || n >= lanesOf(state)) continue;
    const nb = state.board[side][n];
    if (nb && nb.sigils.includes('pack')) a += 1;
  }
  return a;
}

function poolOf(card) {
  if (card.costType === 'blood') return 'blood';
  if (card.costType === 'bone') return 'bones';
  if (card.costType === 'energy') return 'energy';
  if (card.costType === 'gem') return 'gem';
  return 'free';
}

// Gems available to a player = the colors of Mox creatures currently on their board.
// This is a *presence* resource (faithful to Inscryption): a gem exists while its
// Mox creature is alive on the board, and is lost when that creature dies.
export function availableGems(state, p) {
  const set = new Set();
  for (const c of state.board[p]) if (c && c.mox) set.add(c.mox);
  return set;
}
export function gemName(g) { return GEMS[g] ? GEMS[g].name : g; }

export function playCard(state, player, iid, lane, opts = {}) {
  if (state.over) return { ok: false, reason: '对局已结束' };
  if (state.currentPlayer !== player) return { ok: false, reason: '还没轮到你' };
  if (lane < 0 || lane >= lanesOf(state)) return { ok: false, reason: '无效列' };
  const pl = state.players[player];
  const idx = pl.hand.findIndex((c) => c.iid === iid);
  if (idx < 0) return { ok: false, reason: '手牌中没有这张牌' };
  const card = pl.hand[idx];
  if (state.board[player][lane]) return { ok: false, reason: '该列已有单位' };
  const pool = poolOf(card);
  if (pool === 'gem') {
    // Gem cost = required gem colors must be *present on the board* (not consumed).
    const have = availableGems(state, player);
    const missing = (card.gemCost || []).filter((g) => !have.has(g));
    if (missing.length) {
      return { ok: false, reason: '需要魔石：' + missing.map(gemName).join('、') };
    }
  } else if (pool === 'free') {
    // no resource cost
  } else if (pool === 'blood') {
    // Blood: a blood-cost card is paid from the per-turn blood allowance
    // (pl.blood, non-banked) first, then by sacrificing *already-summoned*
    // creatures on your board for any remainder — all at the moment you play
    // the card. Sacrificed flesh is consumed immediately (over-sacrifice is
    // allowed but wasted) and nothing carries to later turns.
    const need = card.cost;
    if (need > 0) {
      const sacs = opts.sacrifices || [];
      let sacVal = 0; const lanesToClear = [];
      for (const siid of sacs) {
        const l = state.board[player].findIndex((c) => c && c.iid === siid);
        if (l < 0) return { ok: false, reason: '只能献祭场上已召唤的单位' };
        if (siid === iid) return { ok: false, reason: '不能献祭正在打出的牌' };
        sacVal += state.board[player][l].bloodValue;
        lanesToClear.push(l);
      }
      const poolAvail = pl.blood || 0;
      if (poolAvail + sacVal < need) {
        return { ok: false, reason: '需要 ' + need + ' 血肉（当前血肉 ' + poolAvail + ' + 献祭 ' + sacVal + '），不足' };
      }
      // 本回合内「献祭溢出的血肉」保留在血肉池中：献祭一只 bloodValue:2 的单位
      // 来打 1 费牌，剩下的 1 点血肉本回合还能再打一张 1 费牌 —— 这样血肉阵营才能
      // 滚雪球铺满 4 列。仍遵守用户硬约束：血肉来自真实献祭、无无偿发放、且 pool 每
      // 回合初重置为 0（不跨回合累计、不会无故增长），只在本回合内累积可用。
      pl.blood = Math.max(0, poolAvail + sacVal - need);  // 本回合内保留献祭溢出
      for (const l of lanesToClear) {
        const sc = state.board[player][l];
        state.board[player][l] = null;          // consumed, not banked
        state.log.push(`${pl.name} 献祭了 ${sc.name}（血肉+${sc.bloodValue}）`);
      }
    }
  } else {
    if (pl[pool] < card.cost) return { ok: false, reason: '资源不足（需' + card.cost + (card.costType === 'bone' ? '骸骨' : '能量') + '）' };
    pl[pool] -= card.cost;
  }
  pl.hand.splice(idx, 1);
  card.hasAttacked = false;
  state.board[player][lane] = card;
  state.log.push(`${pl.name} 召唤了 ${card.name}（第${lane + 1}列）`);
  return { ok: true };
}

// One-directional combat (faithful to Inscryption): ONLY the attacker deals
// damage. The defender does NOT counterattack — it strikes back on its own
// turn instead. The only retaliation is the defender's sharp_quills (尖刺).
function fight(state, atkSide, atkLane, defSide, defLane) {
  const c = state.board[atkSide][atkLane];
  const d = state.board[defSide][defLane];
  if (!c || !d) return;
  const cDbl = c.sigils.includes('double_strike');
  const cAtk = getAttack(state, atkSide, atkLane) * (cDbl ? 2 : 1);
  let dmg = cAtk + (c.sigils.includes('poison_touch') ? 1 : 0); // 毒触：额外+1
  if (d.sigils.includes('armored')) dmg = Math.max(0, dmg - 1); // 厚甲：受击 -1
  d.hp -= dmg;
  if (c.sigils.includes('death_touch') && dmg > 0) d.hp = 0;    // 致死：任何伤害即死
  if (state.lastCombat) state.lastCombat.push({ side: defSide, lane: defLane, dmg, by: atkSide });
  if (d.sigils.includes('sharp_quills')) {            // 尖刺：被攻击时反伤1点（攻击方同样享受厚甲减免）
    let q = 1;
    if (c.sigils.includes('armored')) q = Math.max(0, q - 1);
    c.hp -= q;
    if (state.lastCombat) state.lastCombat.push({ side: atkSide, lane: atkLane, dmg: q, by: defSide, quill: true });
  }
}

function resolveAttacks(state, attacker) {
  const enemy = other(attacker);
  if (state.lastCombat) state.lastCombat = [];   // fresh combat log for this turn
  state.combatSeq = (state.combatSeq || 0) + 1;
  for (let lane = 0; lane < lanesOf(state); lane++) {
    const c = state.board[attacker][lane];
    if (!c || c.hasAttacked) continue;
    const d = state.board[enemy][lane];
    const cAir = c.sigils.includes('airborne');
    const dAir = d && d.sigils.includes('airborne');
    const pw = getAttack(state, attacker, lane) * (c.sigils.includes('double_strike') ? 2 : 1);
    // 0 攻击且无毒触的单位不发动攻击：不扑击、不向天平加 0、也不在 UI 飘 “-0” / “天平 +0”。
    // （pack 邻位 +1 已在 getAttack 内计入，真正的 0 攻击才会被跳过。）
    if (pw === 0 && !c.sigils.includes('poison_touch')) continue;
    let didAttack = false;
    if (d) {
      if ((cAir && dAir) || (!cAir && !dAir)) {
        fight(state, attacker, lane, enemy, lane);
        didAttack = true;
      } else if (cAir && !dAir) {
        state.weights[attacker] += pw;
        if (state.lastCombat) state.lastCombat.push({ scale: true, dmg: pw, by: attacker, lane });
        state.log.push(`${c.name} 飞越攻击，天平 +${pw}`);
        didAttack = true;
      } else if (!cAir && dAir) {
        // 地面单位被敌方飞行单位拦截：不发动攻击（天平与防守方都不变）。
        // 记录进 lastCombat，让 UI 在结算时飘「被飞行单位拦截」提示，
        // 避免玩家误以为「攻击没触发 / 卡住了」。
        if (state.lastCombat) state.lastCombat.push({ blocked: true, atkSide: attacker, blkSide: enemy, lane });
        state.log.push(`${c.name} 被 ${d.name}（飞行）拦截，无法攻击`);
      }
    } else {
      state.weights[attacker] += pw;
      if (state.lastCombat) state.lastCombat.push({ scale: true, dmg: pw, by: attacker, lane });
      state.log.push(`${c.name} 攻击天平 +${pw}`);
      didAttack = true;
    }
    c.hasAttacked = true;
    // Brittle (易碎) creatures crumble to dust the moment they attack. Only cards
    // that carry the sigil are affected (e.g. the 0-cost 枯骨幼犬) — everything
    // else survives. A bone creature dying this way still feeds +1 骸骨 to its owner.
    if (didAttack && c.sigils.includes('brittle')) {
      c.hp = 0;
      state.log.push(`${c.name} 出击后碎裂`);
    }
  }
  processDeaths(state);
}

function processDeaths(state) {
  for (const side of ['A', 'B']) {
    for (let lane = 0; lane < lanesOf(state); lane++) {
      const c = state.board[side][lane];
      if (c && c.hp <= 0) {
        state.board[side][lane] = null;
        const pl = state.players[side];
        // Bones are only generated for the Bone faction (the "Bone Lord" mechanic);
        // other factions' creatures dying simply go to the discard pile.
        if (pl.res === 'bone' && CONFIG.BONE_DEATH_GAIN > 0) {
          pl.bones += CONFIG.BONE_DEATH_GAIN;
          state.log.push(`${c.name} 死亡（获得${CONFIG.BONE_DEATH_GAIN}骸骨）`);
        } else {
          state.log.push(`${c.name} 死亡`);
        }
        if (c.sigils.includes('undying') && !c.undyingUsed) {
          c.undyingUsed = true; c.hp = c.maxHp; c.hasAttacked = false;
          if (pl.hand.length < CONFIG.HAND_LIMIT) pl.hand.push(c);
          state.log.push(`${c.name} 不死，返回手牌`);
        } else {
          if (c.sigils.includes('loose_tail') && pl.hand.length < CONFIG.HAND_LIMIT) {
            pl.hand.push(instantiate('squirrel'));
            state.log.push(`${c.name} 断尾，获得一只松鼠`);
          }
          pl.discard.push(c.cardId);
        }
      }
    }
  }
}

function checkWin(state) {
  const W = winScaleOf(state);
  const mode = (state.rules && state.rules.winMode) || 'difference';
  const a = state.weights.A, b = state.weights.B;
  let aWins, bWins;
  if (mode === 'absolute') {
    // 累计分数：双方各自累计“未阻挡攻击”分数，先达到目标分者胜。
    aWins = a >= W; bWins = b >= W;
  } else {
    // 分数差（默认）：比拼双方分数差，先拉开到目标分差者胜。
    aWins = (a - b) >= W; bWins = (b - a) >= W;
  }
  if (aWins) { state.winner = 'A'; state.over = true; }
  else if (bWins) { state.winner = 'B'; state.over = true; }
  if (state.over) state.log.push(`对局结束，胜者：${state.players[state.winner].name}`);
}

function beginTurn(state, p) {
  const pl = state.players[p];
  if (pl.res === 'energy') {
    // Energy ramps 1→2→3→4→5 and caps at 5, but grows by +1 only on
    // every ENERGY_RAMP_EVERY-th of THIS player's own turns (slows the
    // late-game board flood). Leftover energy does NOT carry between turns.
    pl.energyRamp = (pl.energyRamp || 0) + 1;
    if (pl.energyRamp % CONFIG.ENERGY_RAMP_EVERY === 0) {
      pl.energyMax = Math.min(CONFIG.ENERGY_CAP, pl.energyMax + 1);
    }
    pl.energy = pl.energyMax;
  } else if (pl.res === 'bone') {
    // Bone: a small passive graveyard drip each turn, ON TOP of the
    // +1 gained whenever one of your creatures dies.
    pl.bones = Math.min(CONFIG.BONE_CAP_MAX, pl.bones + CONFIG.BONE_PER_TURN);
  } else if (pl.res === 'blood') {
    // Blood: a NON-banked per-turn allowance (resets every turn, never carries
    // over — honors "不攒"). It lets blood develop tempo without sacrificing a
    // board unit every single turn; higher-cost blood cards still require
    // sacrificing already-summoned creatures on top of this allowance.
    pl.blood = CONFIG.BLOOD_PER_TURN;
  }
  // mox: board-presence gems from Mox creatures — no per-turn regen.
  // 狂热(frenzy)：每回合开始攻击力 +1（封顶 6）；回复(regen)：每回合开始恢复 1 点生命（不超过上限）。
  for (let l = 0; l < lanesOf(state); l++) {
    const u = state.board[p][l];
    if (!u) continue;
    if (u.sigils.includes('frenzy')) u.atk = Math.min(6, u.atk + 1);
    if (u.sigils.includes('regen')) u.hp = Math.min(u.maxHp, u.hp + 1);
  }
  for (let l = 0; l < lanesOf(state); l++) if (state.board[p][l]) state.board[p][l].hasAttacked = false;
  for (let i = 0; i < drawsOf(state); i++) drawCard(state, p);
  state.currentPlayer = p; state.turn++;
  state.log.push(`—— 轮到 ${pl.name} ——`);
}

export function endTurn(state, player) {
  if (state.over) return { ok: false, reason: '对局已结束' };
  if (state.currentPlayer !== player) return { ok: false, reason: '还没轮到你' };
  resolveAttacks(state, player);
  processDeaths(state);
  checkWin(state);
  if (state.over) return { ok: true };
  beginTurn(state, other(player));
  return { ok: true };
}

export function applyAction(state, action) {
  switch (action.type) {
    case 'play': return playCard(state, action.player, action.iid, action.lane, { sacrifices: action.sacrifices });
    case 'endTurn': return endTurn(state, action.player);
    default: return { ok: false, reason: '未知操作' };
  }
}
