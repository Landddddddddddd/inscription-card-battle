// Single-player AI. Runs client-side; operates as player 'B'.
// Supports three difficulty levels: 'easy' | 'normal' | 'hard'.
import { playCard, endTurn, availableGems, other } from './engine.js';
import { CONFIG } from './constants.js';

const lanesOf = (state) => (state.rules && state.rules.lanes) || CONFIG.LANES;

// Affordability — mirrors engine.playCard's cost rules. Blood has NO banked
// pool: a blood-cost card is affordable only if the board holds enough total
// bloodValue to sacrifice for it.
function canAfford(state, me, c) {
  if (c.costType === 'free') return true;
  if (c.costType === 'gem') {
    const have = availableGems(state, me);
    return (c.gemCost || []).every((g) => have.has(g));
  }
  if (c.costType === 'blood') {
    if (c.cost === 0) return true;
    let avail = state.players[me].blood || 0;   // per-turn non-banked allowance
    for (const u of state.board[me]) if (u) avail += u.bloodValue;
    return avail >= c.cost;
  }
  if (c.costType === 'sand') return (state.players[me].seconds || 0) >= c.cost;
  const pool = c.costType === 'bone' ? 'bones' : 'energy';
  return state.players[me][pool] >= c.cost;
}

// Effective damage a candidate `card` would deal in combat this turn (mirrors
// engine.fight + getAttack: double_strike doubles, poison_touch +1). For AI
// lane-scoring we approximate with the card's own attack (board pack-bonus is
// ignored — a safe, slightly conservative estimate).
function strikePower(card) {
  const dbl = card.sigils.includes('double_strike');
  let dmg = card.atk * (dbl ? 2 : 1);
  if (card.sigils.includes('poison_touch')) dmg += 1;
  return dmg;
}

// How good is playing `card` into `lane`? Returns a score (higher = better).
function scoreLane(state, me, lane, level, card) {
  const enemy = other(me);
  if (state.board[me][lane]) return -1;            // already occupied
  const ec = state.board[enemy][lane];
  if (!ec) return 3;                               // free hit on the scale
  if (level !== 'hard') return 1;                  // normal/easy: any trade is acceptable
  // Hard: evaluate the trade. We kill it if our damage >= its (armored-adjusted)
  // hp; we survive if its quills won't finish us and our hp holds.
  let dmg = strikePower(card);
  if (ec.sigils.includes('armored')) dmg = Math.max(0, dmg - 1);
  const kills = dmg >= ec.hp;
  const quill = ec.sigils.includes('sharp_quills') ? 1 : 0;
  const survives = card.hp - quill > 0;
  if (kills && survives) return 4;                 // clean win
  if (kills && !survives) return 2;                // trade (we both die)
  if (!kills && survives) return 1;                // chip damage, we live
  return 0;                                        // bad trade: we die, they live — avoid
}

// Pick the cheapest board units to cover the blood shortfall beyond the
// per-turn pool. Prefer sacrificing NON-undying creatures (keep undying ones
// around) when possible.
function pickSacrifices(state, me, need, level) {
  const pool = state.players[me].blood || 0;
  const gap = Math.max(0, need - pool);   // pool pays first; only sacrifice the gap
  if (gap <= 0) return [];
  const units = state.board[me].filter((c) => c);
  const weight = (c) => {
    let w = (c.atk + c.hp);
    if (c.sigils.includes('undying')) w += (level === 'hard' ? 5 : 1); // hard protects undying
    return w;
  };
  units.sort((a, b) => weight(a) - weight(b));
  const chosen = []; let have = 0;
  for (const u of units) { if (have >= gap) break; chosen.push(u.iid); have += u.bloodValue; }
  return chosen;
}

function emptyLanes(state, me) {
  const out = [];
  for (let l = 0; l < lanesOf(state); l++) if (!state.board[me][l]) out.push(l);
  return out;
}

// Generator: yields one AI action at a time (decision/execution separated) so
// the UI can animate each play step-by-step instead of snapping the whole turn
// at once. Each yielded action is `{type:'play', iid, lane, sacrifices?}` or
// `{type:'endTurn'}`. The driver applies it externally (playCard / endTurn) and
// the generator resumes with the *updated* state, so later decisions correctly
// depend on earlier plays (resources, board, hand all change between steps).
export function* aiTurnPlan(state, me, level = 'normal') {
  const pl = state.players[me];
  if (state.over || state.currentPlayer !== me) return;

  // ---------- EASY: plays only 1–2 cards, random picks, weak positioning.
  if (level === 'easy') {
    const maxPlays = Math.random() < 0.55 ? 1 : 2;
    let n = 0;
    while (n++ < maxPlays) {
      const empty = emptyLanes(state, me);
      if (!empty.length) break;
      const playable = pl.hand.filter((c) => canAfford(state, me, c));
      if (!playable.length) break;
      const card = playable[Math.floor(Math.random() * playable.length)];
      const lane = empty[Math.floor(Math.random() * empty.length)];
      const action = { type: 'play', iid: card.iid, lane };
      if (card.costType === 'blood' && card.cost > 0) action.sacrifices = pickSacrifices(state, me, card.cost, level);
      yield action;
    }
    yield { type: 'endTurn' };
    return;
  }

  // ---------- NORMAL / HARD: play as much as possible each turn.
  let safety = 0;
  while (safety++ < 40) {
    const empty = emptyLanes(state, me);
    if (empty.length === 0) break;

    const playable = pl.hand.filter((c) => canAfford(state, me, c));
    if (playable.length === 0) break;

    // Order cards by descending board value (hard is a bit greedier on threats).
    playable.sort((a, b) => {
      const ga = a.mox ? 1 : 0, gb = b.mox ? 1 : 0;
      if (ga !== gb) return gb - ga;                       // Mox generators first
      const va = a.atk + a.hp + (a.cost || 0);
      const vb = b.atk + b.hp + (b.cost || 0);
      if (level === 'hard') return vb - va;                // hard prefers the biggest threat
      return vb - va;
    });

    // Try each playable card; if one can't be played, skip it and try the next
    // (do NOT break out — a single unplayable card must not stall the whole turn).
    let played = false;
    for (const card of playable) {
      // Hard: rank empty lanes by trade quality, skip only truly bad trades when
      // a better lane exists. Normal: free-hit (3) beats trade (1).
      const slots = emptyLanes(state, me)
        .filter((l) => scoreLane(state, me, l, level, card) >= 0)
        .sort((l1, l2) => scoreLane(state, me, l2, level, card) - scoreLane(state, me, l1, level, card));
      if (slots.length === 0) {
        // only bad-trade lanes left for this card; hard skips, normal still takes one
        if (level === 'hard') continue;
        slots.push(emptyLanes(state, me)[0]);
      }
      const action = { type: 'play', iid: card.iid, lane: slots[0] };
      if (card.costType === 'blood' && card.cost > 0) action.sacrifices = pickSacrifices(state, me, card.cost, level);
      yield action;
      played = true;
      break;
    }
    if (!played) break;
  }

  yield { type: 'endTurn' };
}

function applyAIAction(state, me, a) {
  if (a.type === 'play') {
    const opts = {};
    if (a.sacrifices) opts.sacrifices = a.sacrifices;
    playCard(state, me, a.iid, a.lane, opts);
  } else if (a.type === 'endTurn') {
    endTurn(state, me);
  }
}

// One-shot complete turn (used by headless balance sims). Replays the plan
// generator and applies every action immediately.
export function aiTakeTurn(state, level = 'normal') {
  for (const a of aiTurnPlan(state, 'B', level)) applyAIAction(state, 'B', a);
}

// Generic AI turn for an arbitrary player (used by headless balance sims).
// `me` is 'A' or 'B'.
export function runAITurn(state, me, level = 'normal') {
  for (const a of aiTurnPlan(state, me, level)) applyAIAction(state, me, a);
}
