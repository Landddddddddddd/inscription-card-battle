// 联机整局驱动测试：双客户端并发，host 驱动地图/抉择，双方各自驱动战斗单位；跑到终局或步数上限。
import {
  legalKingMoves, currentChapter, aiChooseAction,
} from './public/js/campaign.js';
import {
  optionsFor, livingUnits,
} from './public/js/engine.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8090;
const URL = `ws://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    ws.buf = [];
    ws.onopen = () => res(ws);
    ws.onerror = (e) => rej(e);
    ws.onmessage = (ev) => ws.buf.push(JSON.parse(ev.data));
  });
}
const send = (ws, o) => ws.send(JSON.stringify(o));

function decide(state, me, isHost) {
  const ch = currentChapter(state);
  if (state.phase === 'battle') {
    const b = state.battle;
    const mine = livingUnits(b, 'player').filter((u) => u.owner === me && !u.hasActed);
    if (mine.length) {
      const u = mine[0];
      const a = aiChooseAction(b, u);
      if (a) return { type: 'battle', action: a };
      return { type: 'battle', action: { type: 'wait', unitId: u.id } };
    }
    return { type: 'battle', action: { type: 'endTurn', who: me } };
  }
  if (!isHost) return null; // 非战斗阶段只由房主驱动，避免双方重复操作
  switch (state.phase) {
    case 'map': {
      const legal = legalKingMoves(state);
      const [tf, tr] = ch.throne;
      legal.sort((a, b) => (Math.max(Math.abs(a[0] - tf), Math.abs(a[1] - tr))) - (Math.max(Math.abs(b[0] - tf), Math.abs(b[1] - tr))));
      return { type: 'king', to: legal[0] };
    }
    case 'loot': return { type: 'loot', idx: 0 };
    case 'promote': {
      const p = state.roster.find((u) => u.type === 'pawn');
      return { type: 'promote', unitId: p ? p.id : null, piece: 'queen' };
    }
    case 'rest': return { type: 'rest', kind: 'train' };
    case 'event': return { type: 'event', idx: 0 };
    case 'chapterEnd': return { type: 'advance' };
    default: return null;
  }
}

async function drive(ws, me, isHost, shared, initState, MAX) {
  const waitFor = (ms = 8000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + me + ' phase=' + (shared.lastPhase || '?'))), ms);
    const tick = () => {
      const m = ws.buf.shift();
      if (m && m.type === 'state') { clearTimeout(t); return res(m); }
      setTimeout(tick, 4);
    };
    tick();
  });
  let st = initState; // host 的首个 state 已在 start 后拿到，无需再等
  while (shared.acts++ < MAX) {
    if (!st) st = (await waitFor()).state;
    shared.lastPhase = st.phase;
    if (st.phase === 'over') { shared.result = st.over; return; }
    const a = decide(st, me, isHost);
    if (a) {
      if (st.phase !== (shared.prevPhase || st.phase)) console.log(`[${me}] -> ${st.phase}`);
      shared.prevPhase = st.phase;
      console.log(`[${me}] act ${st.phase} ${JSON.stringify(a).slice(0, 70)}`);
      send(ws, { type: 'action', action: a });
    }
    st = null; // 下一步必须等服务端广播的新状态
    await sleep(3);
  }
}

(async () => {
  const host = await open();
  const join = await open();
  send(host, { type: 'host' });
  const created = await new Promise((res) => { const t = setInterval(() => { const m = host.buf.shift(); if (m && m.type === 'roomCreated') { clearInterval(t); res(m); } }, 4); });
  send(join, { type: 'join', code: created.code });
  await new Promise((res) => { const t = setInterval(() => { const m = join.buf.shift(); if (m && m.type === 'joined') { clearInterval(t); res(m); } }, 4); });
  send(host, { type: 'start' });
  const init = await new Promise((res) => { const t = setInterval(() => { const m = host.buf.shift(); if (m && m.type === 'state') { clearInterval(t); res(m); } }, 4); });

  const shared = { acts: 0, result: null };
  await Promise.all([
    drive(host, 'p1', true, shared, init.state, 2000),
    drive(join, 'p2', false, shared, null, 2000),
  ]);
  console.log(`coop run ended: result=${shared.result ? shared.result.result : 'timeout'} reason=${shared.result ? shared.result.reason : '-'} acts=${shared.acts}`);
  console.log('SMOKE-OK');
  process.exit(0);
})().catch((e) => { console.error('SMOKE-FAIL', e); process.exit(1); });
