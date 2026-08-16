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
    const pl = { name, res, avatar: opts['avatar' + key] || '🜁', deck: shuffle(deck), hand: [], blood: 0, bloodCap: 0, bones: 0, energy: 0, energyMax: 0, energyRamp: 0, mox: 0, seconds: 0, sandBudget: 0, sandRamp: 0, discard: [] };
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
    draw: false,            // 平局标记（双方同意求和 / 牌库抽干且场面冻结）
    peaceUsed: { A: false, B: false }, // 每方一局仅可申请求和 1 次
    peacePending: null,     // 当前待回应的求和申请方（'A'/'B'/null）
    peaceAccepted: false,   // 因双方同意求和而平局
    surrendered: null,      // 投降方
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

// 注意：本作「卡牌出完了就是出完了，不会再摸」——牌库抽干即止，弃牌堆不洗回。
// （此前的 reshuffle 循环抽牌逻辑已移除。）
function drawCard(state, p) {
  const pl = state.players[p];
  if (pl.hand.length >= CONFIG.HAND_LIMIT) return false;
  if (pl.deck.length === 0) return false;   // 牌库已空 → 不再摸牌（无循环、无疲劳 buff/debuff）
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
  if (card.costType === 'sand') return 'sand';
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
  const pool = poolOf(card);
  // 血肉牌：被献祭的单位所在列在结算时会被清空，因此允许把新召唤的单位
  // 直接放在「刚被献祭的格子」上（与其他阵营统一：可放置在刚腾出的那一列）。
  const laneIsSacrificed = pool === 'blood' && Array.isArray(opts.sacrifices)
    && opts.sacrifices.some((siid) => {
      const l = state.board[player].findIndex((c) => c && c.iid === siid);
      return l === lane;
    });
  if (state.board[player][lane] && !laneIsSacrificed) return { ok: false, reason: '该列已有单位' };
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
  } else if (pool === 'sand') {
    // 时砂：消耗「剩余秒数」(pl.seconds) 召唤，不可透支；每回合开始 pl.seconds 重置为当前秒能预算(budget)。
    if (pl.seconds < card.cost) {
      return { ok: false, reason: '剩余秒数不足（需 ' + card.cost + ' 秒，当前 ' + Math.floor(pl.seconds) + ' 秒）' };
    }
    pl.seconds -= card.cost;
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
  if (state.lastCombat) state.lastCombat.push({ side: defSide, lane: defLane, dmg, by: atkSide, dbl: cDbl, death: (c.sigils.includes('death_touch') && dmg > 0) });
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
        if (state.lastCombat) state.lastCombat.push({ scale: true, dmg: pw, by: attacker, lane, dbl: c.sigils.includes('double_strike') });
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
      if (state.lastCombat) state.lastCombat.push({ scale: true, dmg: pw, by: attacker, lane, dbl: c.sigils.includes('double_strike') });
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
        // 骸骨阵营：己方单位「以任何方式死亡」（交战阵亡 / 0 费易碎生物攻击后碎裂 /
        // 各类致死）都掉落骸骨——死 1 只 +1。事件写入 lastCombat 供 UI 播放「💀 +1🦴」特效。
        if (pl.res === 'bone' && CONFIG.BONE_DEATH_GAIN > 0) {
          pl.bones += CONFIG.BONE_DEATH_GAIN;
          state.log.push(`${c.name} 死亡（获得${CONFIG.BONE_DEATH_GAIN}骸骨）`);
          if (state.lastCombat) state.lastCombat.push({ boneGain: true, side, lane, amount: CONFIG.BONE_DEATH_GAIN });
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

// ---------- 牌库抽干 / 平局判定 ----------
// 双方都「出完牌」（手牌与牌库皆空）且场上均无可改变天平的攻击单位时，判平局。
function deckedOut(state, p) {
  const pl = state.players[p];
  return pl.hand.length === 0 && pl.deck.length === 0;
}
function boardCanAttack(state, side) {
  // 判断「该方下一回合是否仍能改变天平」——忽略 hasAttacked（每回合开始会重置），
  // 只看单位是否具备有效攻击力（或毒触）。用于平局/僵局判定，避免「刚攻击过的单位
  // 被误判为不能再攻击」而误判平局。
  for (let l = 0; l < lanesOf(state); l++) {
    const c = state.board[side][l];
    if (!c) continue;
    const pw = getAttack(state, side, l) * (c.sigils.includes('double_strike') ? 2 : 1);
    if (pw > 0 || c.sigils.includes('poison_touch')) return true;
  }
  return false;
}
function boardCount(state) {
  let n = 0;
  for (const s of ['A', 'B']) for (const c of state.board[s]) if (c) n++;
  return n;
}
function maybeDraw(state) {
  if (state.over) return;
  if (deckedOut(state, 'A') && deckedOut(state, 'B') && !boardCanAttack(state, 'A') && !boardCanAttack(state, 'B')) {
    state.over = true; state.winner = null; state.draw = true;
    state.log.push('双方均已用尽手牌，且场上无可改变天平的单位 —— 平局！');
  }
}
// 胜负相关指标（用于僵局侦测）：分数差模式只看「分数差」；累计模式看双方各自分数。
function winMetric(state) {
  const mode = (state.rules && state.rules.winMode) || 'difference';
  if (mode === 'absolute') return state.weights.A + ':' + state.weights.B;
  return String(state.weights.A - state.weights.B);
}
// 更稳健的「僵局」侦测：双方抽干牌库后，若连续一整轮（A 的回合开始）天平指标与场上单位数
// 都未变化（例如双方单位都只向天平平推、互相对消，分数差永远拉不开），则胜负无法再分 → 平局。
function detectStalemate(state) {
  if (state.over) return;
  if (!deckedOut(state, 'A') || !deckedOut(state, 'B')) return;
  const snap = winMetric(state);
  if (state._snap != null && state._bcnt != null && snap === state._snap && state._bcnt === boardCount(state)) {
    state.over = true; state.winner = null; state.draw = true;
    state.log.push('双方均已用尽手牌，且天平与场面连续一轮无变化 —— 平局！');
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
  // 僵局侦测快照：仅在 A 的回合开始记录/比对（代表“一整轮”的跨度）。
  if (p === 'A') {
    if (state._snap != null && state._bcnt != null) detectStalemate(state);
    if (state.over) return;                       // 已判平局，不再开始回合
    state._snap = winMetric(state);
    state._bcnt = boardCount(state);
  }
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
    // 骸骨经济以「死亡掉落」为主（见 BONE_DEATH_GAIN）。再补一个小数兜底滴流：
    // 每回合累加 BONE_PER_TURN，满 1 才 +1 骸骨——仅防前期断档，不叠加成洪流。
    pl.boneAcc = (pl.boneAcc || 0) + CONFIG.BONE_PER_TURN;
    while (pl.boneAcc >= 1) { pl.bones = Math.min(CONFIG.BONE_CAP_MAX, pl.bones + 1); pl.boneAcc -= 1; }
  } else if (pl.res === 'blood') {
    // Blood: a NON-banked per-turn allowance (resets every turn, never carries
    // over — honors "不攒"). It lets blood develop tempo without sacrificing a
    // board unit every single turn; higher-cost blood cards still require
    // sacrificing already-summoned creatures on top of this allowance.
    pl.blood = CONFIG.BLOOD_PER_TURN;
  } else if (pl.res === 'sand') {
    // 时砂：秒能预算与能量阵营「同构」地爬升——首回合 0，之后每 SAND_RAMP_EVERY 个己方回合
    // +1，封顶 SAND_CAP（与 ENERGY_RAMP_EVERY / ENERGY_CAP 完全一致）。单位数值曲线也照搬能量
    // 阵营，因此时砂整体胜率与能量对齐（~45-50%），不会破坏五阵营平衡。卡牌以「秒」为费，不可透支。
    pl.sandRamp = (pl.sandRamp || 0) + 1;
    if (pl.sandRamp % CONFIG.SAND_RAMP_EVERY === 0) {
      pl.sandBudget = Math.min(CONFIG.SAND_CAP, pl.sandBudget + 1);
    }
    pl.seconds = pl.sandBudget;
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
  if (!state.over) maybeDraw(state);   // 牌库抽干且场面冻结 → 平局
  if (state.over) return { ok: true };
  beginTurn(state, other(player));
  return { ok: true };
}

// ---------- 投降 / 求和（平局）----------
// 投降：认输，对方直接获胜（仅自己回合可发起）。
export function surrender(state, player) {
  if (state.over) return { ok: false, reason: '对局已结束' };
  state.winner = other(player);
  state.over = true;
  state.surrendered = player;
  state.log.push(`${state.players[player].name} 投降，认输！`);
  return { ok: true };
}

// 求和：申请平局。每方一局仅可申请 1 次；已有待处理申请时不可重复申请。
export function requestPeace(state, player) {
  if (state.over) return { ok: false, reason: '对局已结束' };
  if (state.peaceUsed[player]) return { ok: false, reason: '你本局已申请过求和（每局仅 1 次）' };
  if (state.peacePending) return { ok: false, reason: '已有一方申请求和，等待回应' };
  state.peaceUsed[player] = true;
  state.peacePending = player;
  state.log.push(`${state.players[player].name} 申请求和（平局）`);
  return { ok: true, by: player };
}

// 回应求和：仅「非申请方」可回应。接受 → 平局；拒绝 → 清空待处理，对局继续。
export function respondPeace(state, player, accept) {
  if (state.over) return { ok: false, reason: '对局已结束' };
  if (!state.peacePending) return { ok: false, reason: '当前没有待处理的求和' };
  if (state.peacePending === player) return { ok: false, reason: '不能回应自己的求和' };
  if (accept) {
    state.over = true; state.winner = null; state.draw = true; state.peaceAccepted = true;
    state.log.push('双方同意求和 —— 平局！');
  } else {
    state.log.push(`${state.players[player].name} 拒绝了求和`);
  }
  state.peacePending = null;
  return { ok: true };
}

export function applyAction(state, action) {
  switch (action.type) {
    case 'play': return playCard(state, action.player, action.iid, action.lane, { sacrifices: action.sacrifices });
    case 'endTurn': return endTurn(state, action.player);
    case 'surrender': return surrender(state, action.player);
    case 'requestPeace': return requestPeace(state, action.player);
    case 'respondPeace': return respondPeace(state, action.player, action.accept);
    default: return { ok: false, reason: '未知操作' };
  }
}
