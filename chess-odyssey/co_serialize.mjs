// 序列化校验：以 autoRun 同款决策逻辑跑完整战役，每步都做一次 JSON round-trip
// （即服务端 broadcastState 的 sanitize），记录访问到的阶段并捕获任何序列化失败。
import {
  createRun, legalKingMoves, currentChapter, moveKing, aiChooseAction,
  battleAction, chooseLoot, choosePromote, promoteOptions,
  chooseRest, chooseEvent, advanceChapter,
} from './public/js/campaign.js';
import { livingUnits } from './public/js/engine.js';

const seen = new Set();
let fail = null;
function serialize(state, label) {
  seen.add(state.phase);
  try {
    const clone = JSON.parse(JSON.stringify(state));
    if (typeof clone.phase !== 'string') throw new Error('phase lost');
  } catch (e) {
    if (!fail) fail = { label, phase: state.phase, err: e.message };
  }
}

function run(seed) {
  const st = createRun({ seed, coop: true, chapterIndex: 0 });
  serialize(st, 'init');
  let guard = 0;
  while (!st.over && guard++ < 600) {
    if (st.phase === 'map') {
      const moves = legalKingMoves(st);
      const [tf, tr] = currentChapter(st).throne;
      const distNow = Math.max(Math.abs(st.pos[0] - tf), Math.abs(st.pos[1] - tr));
      const mustRush = st.candles <= distNow + 4;
      const scored = moves.map((m) => {
        const t = st.tiles[key(m[0], m[1])];
        const d = Math.max(Math.abs(m[0] - tf), Math.abs(m[1] - tr));
        if (mustRush) return { m, s: -10 * d };
        let s = -d * 2.5;
        if (t.cleared) s -= 5;
        else if (t.kind === 'battle') s += st.roster.length >= 5 ? 0 : 4;
        else if (t.kind === 'elite') s += st.roster.length >= 5 ? 3 : -8;
        else if (t.kind === 'promote') s += 4;
        else if (t.kind === 'rest') s += st.fallen.length ? 5 : 1;
        else if (t.kind === 'event') s += 2;
        else if (t.kind === 'boss') s += st.roster.length >= 4 ? 8 : -8;
        return { m, s };
      });
      scored.sort((a, b) => b.s - a.s);
      moveKing(st, scored[0].m);
    } else if (st.phase === 'battle') {
      const actors = livingUnits(st.battle, 'player').filter((u) => !u.hasActed);
      if (!actors.length) { battleAction(st, { type: 'endTurn', who: 'p1' }); }
      else { battleAction(st, aiChooseAction(st.battle, actors[0])); }
    } else if (st.phase === 'loot') chooseLoot(st, 0);
    else if (st.phase === 'promote') {
      const { pawns } = promoteOptions(st);
      choosePromote(st, { unitId: pawns[0]?.id, type: 'queen' });
    } else if (st.phase === 'rest') chooseRest(st, st.fallen.length ? { kind: 'revive' } : { kind: 'train' });
    else if (st.phase === 'event') chooseEvent(st, 0);
    else if (st.phase === 'chapterEnd') advanceChapter(st);
    else break;
    serialize(st, st.phase);
  }
  return st.over ? st.over.result : 'loop-timeout';
}

function key(f, r) { return f + ',' + r; }

let clears = 0, deaths = 0;
for (let s = 1; s <= 40; s++) {
  const r = run(s * 7919);
  if (r === 'allClear') clears++; else deaths++;
}
console.log('phases visited (serialized OK):', [...seen].join(', '));
console.log('serialize failures:', fail ? JSON.stringify(fail) : 'NONE');
console.log(`40 runs: clears=${clears} deaths=${deaths}`);
console.log('SERIALIZE-CHECK DONE');
