// Headless balance simulator — cross-faction win rates.
// Both sides are auto-played by the existing AI. We run every ordered
// (A,B) faction pair so first-mover bias cancels out in the aggregate.
//
// Usage: node balance_sim.mjs [perMatchup=60] [level=normal]
import { createGame } from './public/js/engine.js';
import { runAITurn } from './public/js/ai.js';
import { DECKS, DEFAULT_RULES } from './public/js/constants.js';

const FACTIONS = ['blood', 'bone', 'energy', 'mox'];
const PER = parseInt(process.argv[2] || '60', 10);
const LEVEL = process.argv[3] || 'normal';

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

let games = 0;
for (const fa of FACTIONS) {
  for (const fb of FACTIONS) {
    for (let i = 0; i < PER; i++) {
      const w = simulate(fa, fb); // fa is A, fb is B
      games++;
      factionGames[fa]++; factionGames[fb]++;
      if (w === 'A') factionWins[fa]++;
      else if (w === 'B') factionWins[fb]++;
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
