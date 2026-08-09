// Pairwise win-rate matrix for the current balance state.
import { createGame } from './public/js/engine.js';
import { runAITurn } from './public/js/ai.js';
import { DECKS, DEFAULT_RULES } from './public/js/constants.js';

const FACTIONS = ['blood', 'bone', 'energy', 'mox'];
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
const f = (x, n) => ((x / n) * 100).toFixed(1).padStart(5);
console.log(`Level=${LEVEL} perMatchup=${PER}`);
console.log('row = A faction, col = B faction, cell = A win% (out of ${PER} each)');
let header = 'A\\\\B '.padEnd(8); for (const b of FACTIONS) header += b.padStart(8); console.log(header);
for (const a of FACTIONS) {
  let row = a.padEnd(8);
  for (const b of FACTIONS) { const c = M[a][b]; const n = PER - c.d; const pct = n ? c.a / n * 100 : 50; row += pct.toFixed(1).padStart(8); }
  console.log(row);
}
