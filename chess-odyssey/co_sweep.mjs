import { TUNING } from 'file:///C:/Users/xiaol/WorkBuddy/2026-07-22-20-23-09/chess-odyssey/public/js/constants.js';
import { createRun, autoRun, currentChapter } from 'file:///C:/Users/xiaol/WorkBuddy/2026-07-22-20-23-09/chess-odyssey/public/js/campaign.js';

const N = 300;
for (const bonus of [0, 3, 6, 9, 12]) {
  TUNING.candleBonus = bonus;
  const reasons = {};
  const reached = {};
  let battles = 0, steps = 0;
  for (let s = 1; s <= N; s++) {
    const st = createRun({ seed: s });
    const over = autoRun(st);
    const r = over.reason || over.result;
    reasons[r] = (reasons[r] || 0) + 1;
    const cid = currentChapter(st).id;
    reached[cid] = (reached[cid] || 0) + 1;
    battles += st.stats.battles;
    steps += st.steps;
  }
  const pct = (v) => ((v / N) * 100).toFixed(0) + '%';
  console.log(
    'bonus +' + String(bonus).padStart(2),
    '| clear ' + pct(reasons.allClear || 0).padStart(4),
    '| candleDeath ' + pct(reasons.candles || 0).padStart(4),
    '| battleDeath ' + pct(reasons.battle || 0).padStart(4),
    '| avgBattles ' + (battles / N).toFixed(1),
    '| avgSteps ' + (steps / N).toFixed(1),
    '| reached ' + JSON.stringify(reached)
  );
}
