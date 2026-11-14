// Pairwise win-rate matrix for the current balance state.
// 原始矩阵 = A(先手) 对 B 的胜率，含座位偏差；对称矩阵 = 双向平均，消除先手偏差。
// Usage: node balance_pairwise.mjs [perMatchup=40] [level=normal]
// Env overrides (时砂 O2 原型): SAND_BUDGET_MODE=board|turn, SAND_BOARD_BONUS_MAX, SAND_BUDGET_FLOOR
import { createGame } from './public/js/engine.js';
import { runAITurn } from './public/js/ai.js';
import { DECKS, DEFAULT_RULES, CONFIG } from './public/js/constants.js';

if (process.env.SAND_BUDGET_MODE) {
  CONFIG.SAND_BUDGET_MODE = process.env.SAND_BUDGET_MODE;
  console.log(`(override SAND_BUDGET_MODE=${CONFIG.SAND_BUDGET_MODE})`);
}
if (process.env.SAND_BOARD_BONUS_MAX) {
  const v = parseInt(process.env.SAND_BOARD_BONUS_MAX, 10);
  if (!Number.isNaN(v)) { CONFIG.SAND_BOARD_BONUS_MAX = v; console.log(`(override SAND_BOARD_BONUS_MAX=${v})`); }
}
if (process.env.SAND_BUDGET_FLOOR) {
  const v = parseInt(process.env.SAND_BUDGET_FLOOR, 10);
  if (!Number.isNaN(v)) { CONFIG.SAND_BUDGET_FLOOR = v; console.log(`(override SAND_BUDGET_FLOOR=${v})`); }
}
if (process.env.BONE_PER_TURN) {
  const v = parseFloat(process.env.BONE_PER_TURN);
  if (!Number.isNaN(v)) { CONFIG.BONE_PER_TURN = v; console.log(`(override BONE_PER_TURN=${v})`); }
}
if (process.env.MORALE_SCALE_RATE) {
  const v = parseFloat(process.env.MORALE_SCALE_RATE);
  if (!Number.isNaN(v)) { CONFIG.MORALE_SCALE_RATE = v; console.log(`(override MORALE_SCALE_RATE=${v})`); }
}

const FACTIONS = ['blood', 'bone', 'energy', 'mox', 'sand', 'morale'];
const PER = parseInt(process.argv[2] || '40', 10);
const LEVEL = process.argv[3] || 'normal';

function simulate(fa, fb) {
  const state = createGame({ deckA: DECKS[fa], resA: fa, deckB: DECKS[fb], resB: fb, rules: DEFAULT_RULES });
  let turn = 0; const MAX = 300;
  while (!state.over && turn < MAX) { runAITurn(state, state.currentPlayer, LEVEL); turn++; }
  let w = state.winner;
  if (!w && turn >= MAX) { const wa = state.weights.A, wb = state.weights.B; w = wa === wb ? 'draw' : (wa > wb ? 'A' : 'B'); }
  return w;
}
const M = {};
for (const a of FACTIONS) { M[a] = {}; for (const b of FACTIONS) M[a][b] = { a: 0, b: 0, d: 0 }; }
for (const a of FACTIONS) for (const b of FACTIONS) {
  for (let i = 0; i < PER; i++) { const w = simulate(a, b); if (w === 'A') M[a][b].a++; else if (w === 'B') M[a][b].b++; else M[a][b].d++; }
}

const pct = (a, b) => { const c = M[a][b]; const n = PER - c.d; return n ? (c.a / n) * 100 : 50; };
const header = (s) => { let h = s.padEnd(8); for (const b of FACTIONS) h += b.padStart(8); return h; };

console.log(`Level=${LEVEL} perMatchup=${PER}`);
console.log('=== 原始矩阵：row = A(先手) faction, col = B faction, cell = A 胜率% ===');
console.log(header('A\\\\B'));
for (const a of FACTIONS) {
  let row = a.padEnd(8);
  for (const b of FACTIONS) row += pct(a, b).toFixed(1).padStart(8);
  console.log(row);
}

console.log('\n=== 对称矩阵：双向平均（消除先手座位偏差），A 对 B 胜率% ===');
console.log(header('A\\\\B'));
for (const a of FACTIONS) {
  let row = a.padEnd(8);
  for (const b of FACTIONS) row += ((pct(a, b) + (100 - pct(b, a))) / 2).toFixed(1).padStart(8);
  console.log(row);
}

console.log('\n镜像偏离（先手偏差探针，理想 ≈ 0pt）:');
for (const a of FACTIONS) console.log(`  ${a.padEnd(8)} ${(pct(a, a) - 50).toFixed(1).padStart(6)}pt`);

let maxDev = 0, maxPair = '';
for (const a of FACTIONS) for (const b of FACTIONS) {
  if (a === b) continue;
  const v = (pct(a, b) + (100 - pct(b, a))) / 2;
  const d = Math.abs(v - 50);
  if (d > maxDev) { maxDev = d; maxPair = `${a} vs ${b} = ${v.toFixed(1)}%`; }
}
console.log(`\n最大单对阵偏离: ${maxDev.toFixed(1)}pt  (${maxPair})`);

// 阵营汇总：均胜率 = 对其它 5 阵营的对称胜率均值（与 balance_sim 的 spread 同口径）
const means = {};
for (const a of FACTIONS) {
  let s = 0, n = 0;
  for (const b of FACTIONS) { if (a === b) continue; s += (pct(a, b) + (100 - pct(b, a))) / 2; n++; }
  means[a] = s / n;
}
const sorted = FACTIONS.slice().sort((x, y) => means[y] - means[x]);
console.log('\n阵营均胜率（对其它 5 阵营的对称均值）:');
for (const a of sorted) console.log(`  ${a.padEnd(8)} ${means[a].toFixed(1).padStart(5)}%`);
console.log(`极差 spread: ${(means[sorted[0]] - means[sorted[sorted.length - 1]]).toFixed(1)}pt  (${sorted[0]} ${means[sorted[0]].toFixed(1)} / ${sorted[sorted.length - 1]} ${means[sorted[sorted.length - 1]].toFixed(1)})`);

console.log('注：对称矩阵中 A vs B 与 B vs A 互补（和为 100），只需读上三角。');
