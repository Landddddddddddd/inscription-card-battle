// Headless balance simulator — cross-faction win rates.
// Both sides are auto-played by the existing AI. We run every ordered
// (A,B) faction pair so first-mover bias cancels out in the aggregate.
//
// Usage: node balance_sim.mjs [perMatchup=60] [level=normal]
import { createGame } from './public/js/engine.js';
import { runAITurn } from './public/js/ai.js';
import { DECKS, DEFAULT_RULES, CONFIG } from './public/js/constants.js';

const FACTIONS = ['blood', 'bone', 'energy', 'mox', 'sand'];
const PER = parseInt(process.argv[2] || '60', 10);
const LEVEL = process.argv[3] || 'normal';
// Optional overrides:
//   node balance_sim.mjs 40 normal 5      -> SAND_CAP=5
//   node balance_sim.mjs 40 normal 5 1    -> SAND_CAP=5, SAND_RAMP_EVERY=1
if (process.argv[4]) {
  const v = parseInt(process.argv[4], 10);
  if (!Number.isNaN(v) && v >= 0) {
    CONFIG.SAND_CAP = v;
    console.log(`(override SAND_CAP=${v})`);
  }
}
if (process.argv[5]) {
  const v = parseInt(process.argv[5], 10);
  if (!Number.isNaN(v) && v >= 0) {
    CONFIG.SAND_RAMP_EVERY = v;
    console.log(`(override SAND_RAMP_EVERY=${v})`);
  }
}

function simulate(fa, fb) {
  const state = createGame({
    deckA: DECKS[fa], resA: fa,
    deckB: DECKS[fb], resB: fb,
    rules: DEFAULT_RULES,
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
