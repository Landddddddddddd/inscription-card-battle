// Headless balance simulator — cross-faction win rates.
// Both sides are auto-played by the existing AI. We run every ordered
// (A,B) faction pair so first-mover bias cancels out in the aggregate.
//
// Usage: node balance_sim.mjs [perMatchup=60] [level=normal]
import { createGame } from './public/js/engine.js';
import { runAITurn } from './public/js/ai.js';
import { DECKS, DEFAULT_RULES, CONFIG, CARDS } from './public/js/constants.js';

const FACTIONS = ['blood', 'bone', 'energy', 'mox', 'sand', 'morale'];
const PER = parseInt(process.argv[2] || '60', 10);
const LEVEL = process.argv[3] || 'normal';
// Optional overrides (sand ramp tuning):
//   node balance_sim.mjs 40 normal 6      -> SAND_BUDGET_CAP=6 (BASE 2 / STEP 1)
//   node balance_sim.mjs 40 normal 5 1 2  -> CAP=5 STEP=1 BASE=2
//   SAND_COST_MUL=1.5 node balance_sim.mjs 40 normal 6  -> sand card costs ×1.5 (cap 20)
if (process.argv[4]) {
  const v = parseInt(process.argv[4], 10);
  if (!Number.isNaN(v) && v >= 0) {
    CONFIG.SAND_BUDGET_CAP = v;
    console.log(`(override SAND_BUDGET_CAP=${v})`);
  }
}
if (process.argv[5]) {
  const v = parseInt(process.argv[5], 10);
  if (!Number.isNaN(v)) { CONFIG.SAND_BUDGET_STEP = v; console.log(`(override SAND_BUDGET_STEP=${v})`); }
}
if (process.argv[6]) {
  const v = parseInt(process.argv[6], 10);
  if (!Number.isNaN(v)) { CONFIG.SAND_BUDGET_BASE = v; console.log(`(override SAND_BUDGET_BASE=${v})`); }
}
if (process.env.SAND_COST_MUL) {
  const mul = parseFloat(process.env.SAND_COST_MUL);
  if (!Number.isNaN(mul) && mul > 0) {
    let n = 0;
    for (const c of Object.values(CARDS)) {
      if (c.costType === 'sand') { c.cost = Math.min(20, Math.max(1, Math.round(c.cost * mul))); n++; }
    }
    console.log(`(sand cost ×${mul} applied to ${n} cards)`);
  }
}
// 爬升「小数滴流」扫描（连续旋钮，替代只能整档跳的整数取模）：
//   ENERGY_RAMP_FRAC=0.6  -> 能量每回合累加 0.6，满 1 才 +1 上限（0.5 = 旧「每 2 回合 +1」）
//   SAND_RAMP_FRAC=0.8    -> 时砂预算每秒滴流 0.8（1.0 = 旧「每回合 +1」）
//   BONE_PER_TURN=0.9     -> 骸骨兜底滴流
if (process.env.ENERGY_RAMP_FRAC) {
  const v = parseFloat(process.env.ENERGY_RAMP_FRAC);
  if (!Number.isNaN(v) && v > 0) { CONFIG.ENERGY_RAMP_FRAC = v; console.log(`(override ENERGY_RAMP_FRAC=${v})`); }
}
if (process.env.SAND_RAMP_FRAC) {
  const v = parseFloat(process.env.SAND_RAMP_FRAC);
  if (!Number.isNaN(v) && v > 0) { CONFIG.SAND_RAMP_FRAC = v; console.log(`(override SAND_RAMP_FRAC=${v})`); }
}
if (process.env.BONE_PER_TURN) {
  const v = parseFloat(process.env.BONE_PER_TURN);
  if (!Number.isNaN(v) && v >= 0) { CONFIG.BONE_PER_TURN = v; console.log(`(override BONE_PER_TURN=${v})`); }
}
// 军威天平士气折减系数扫描：MSR=0.1 形式（env 覆盖，避免污染 constants.js）
if (process.env.MSR) {
  const v = parseFloat(process.env.MSR);
  if (!Number.isNaN(v) && v >= 0) {
    CONFIG.MORALE_SCALE_RATE = v;
    console.log(`(override MORALE_SCALE_RATE=${v})`);
  }
}

function simulate(fa, fb) {
  const state = createGame({
    deckA: DECKS[fa], resA: fa,
    deckB: DECKS[fb], resB: fb,
    rules: DEFAULT_RULES,
    turnTime: 20, // 时砂「出牌时间」= 真实回合时限（默认 20s）；仿真按最优出牌建模
  });
  let turn = 0;
  const MAX = 300;
  while (!state.over && turn < MAX) {
    runAITurn(state, state.currentPlayer, LEVEL);
    turn++;
  }
  let winner = state.winner;
  if (!winner && turn >= MAX) {
    const wa = state.weights.A, wb = state.weights.B;
    winner = wa === wb ? 'draw' : (wa > wb ? 'A' : 'B');
  }
  return winner; // 'A' | 'B' | 'draw'
}

const factionWins = Object.create(null);
const factionGames = Object.create(null);
for (const f of FACTIONS) { factionWins[f] = 0; factionGames[f] = 0; }

const matrix = {};
for (const fa of FACTIONS) for (const fb of FACTIONS) matrix[fa + '>' + fb] = { w: 0, g: 0 };

let games = 0;
for (const fa of FACTIONS) {
  for (const fb of FACTIONS) {
    for (let i = 0; i < PER; i++) {
      const w = simulate(fa, fb); // fa is A, fb is B
      games++;
      factionGames[fa]++; factionGames[fb]++;
      if (w === 'A') { factionWins[fa]++; matrix[fa + '>' + fb].w++; }
      else if (w === 'B') { factionWins[fb]++; matrix[fb + '>' + fa].w++; }
      matrix[fa + '>' + fb].g++;
    }
  }
}

console.log(`Level=${LEVEL}  perMatchup=${PER}  totalGames=${games}`);
console.log('--- Faction win rates (participation denominator) ---');
let best = 0, worst = 1;
const wr = {};
for (const f of FACTIONS) {
  const r = factionWins[f] / factionGames[f];
  wr[f] = r;
  if (r > best) best = r;
  if (r < worst) worst = r;
  console.log(`${f.padEnd(7)} ${(r * 100).toFixed(1)}%  (${factionWins[f]}/${factionGames[f]})`);
}
console.log(`spread: ${((best - worst) * 100).toFixed(1)} pts (target ≤ ~10)`);
console.log('--- Pairwise (row beats col, as A) ---');
for (const fa of FACTIONS) {
  let row = fa.padEnd(7);
  for (const fb of FACTIONS) {
    const m = matrix[fa + '>' + fb];
    const r = m.g ? (m.w / m.g * 100).toFixed(0) : '-';
    row += ' ' + r.padStart(4) + '%';
  }
  console.log(row);
}
console.log('cols = opponent-as-B; diagonal meaningless');
