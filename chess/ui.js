// UI 渲染层：把 campaign 状态画成地图 / 战斗 / 各种抉择界面。
// 不持有状态，只接收 ctx = { state, me, selected, onSelect, dispatch, mode }，
// 并把玩家意图通过 dispatch(action) 上报（solo 时 main.js 直接调用引擎，
// coop 时 main.js 转发给 WebSocket）。
import { PIECES, SIGILS, RELICS, CHAPTERS } from './js/constants.js';
import { optionsFor, unitAt, livingUnits } from './js/engine.js';
import {
  currentChapter, legalKingMoves, promoteOptions, restOptions,
} from './js/campaign.js';

const TILE_GLYPH = {
  start: '⌂', boss: '♚', battle: '⚔', elite: '☗', promote: '⬆', rest: '✚', event: '✦', empty: '·',
};

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}

function tileKey(f, r) { return `${f},${r}`; }

// ----------------------------------------------------------------- 顶栏
function topbar(state, me, mode) {
  const ch = currentChapter(state);
  const bar = el('div', { class: 'topbar' }, [
    el('div', { class: 'chapter', text: ch.title }),
    el('div', { class: 'pill' }, [el('span', { text: '🕯 蜡烛 ' }), el('b', { text: String(state.candles) })]),
    el('div', { class: 'pill' }, [el('span', { text: '⚔ 战斗 ' }), el('b', { text: String(state.stats.battles) })]),
    el('div', { class: 'spacer' }),
    mode === 'coop'
      ? el('div', { class: 'pill' }, [el('span', { text: '联机 · 你是 ' }), el('b', { text: me === 'p1' ? '玩家一' : '玩家二' })])
      : el('div', { class: 'pill', text: '单人' }),
  ]);
  return bar;
}

// ----------------------------------------------------------------- 通用网格
function buildBoard(size, cellFn) {
  const board = el('div', { class: 'board' });
  board.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  for (let r = size - 1; r >= 0; r--) {
    for (let f = 0; f < size; f++) {
      board.appendChild(cellFn(f, r));
    }
  }
  return board;
}

// ----------------------------------------------------------------- 地图
function renderMap(stage, side, ctx) {
  const { state, dispatch } = ctx;
  const ch = currentChapter(state);
  const size = ch.board;
  const legal = new Set(legalKingMoves(state).map(([f, r]) => tileKey(f, r)));
  const [kf, kr] = state.pos;

  const board = buildBoard(size, (f, r) => {
    const k = tileKey(f, r);
    const isKing = f === kf && r === kr;
    const tile = state.tiles[k];
    const cls = ['cell', (f + r) % 2 ? 'alt' : '', isKing ? 'king' : (tile.kind || '')];
    let glyph = isKing ? '♚' : (TILE_GLYPH[tile.kind] || '·');
    const clickable = legal.has(k);
    if (clickable) cls.push('clickable', 'legal');
    const cell = el('div', { class: cls.join(' '), text: glyph });
    if (clickable) cell.addEventListener('click', () => dispatch({ type: 'king', to: [f, r] }));
    return cell;
  });
  stage.appendChild(el('div', { class: 'board-wrap' }, [board]));

  // 侧栏：名册 + 说明 + 日志
  side.appendChild(rosterPanel(state));
  side.appendChild(narrativePanel(ch));
  side.appendChild(logPanel(state));
}

// ----------------------------------------------------------------- 战斗
function renderBattle(stage, side, ctx) {
  const { state, me, selected, onSelect, dispatch, mode } = ctx;
  const b = state.battle;
  const size = 6;
  const sel = selected ? b.units.find((u) => u.id === selected) : null;
  let moveSet = new Set();
  let atkSet = new Set();
  if (sel && sel.side === 'player' && !sel.hasActed && b.turn === 'player') {
    const { moves, attacks } = optionsFor(b, sel.id);
    for (const m of moves) moveSet.add(tileKey(m.f, m.r));
    for (const a of attacks) atkSet.add(a);
  }

  const board = buildBoard(size, (f, r) => {
    const u = unitAt(b, f, r);
    if (!u) {
      const cls = ['cell', (f + r) % 2 ? 'alt' : ''];
      if (moveSet.has(tileKey(f, r))) cls.push('hl-move');
      const cell = el('div', { class: cls.join(' ') });
      if (moveSet.has(tileKey(f, r))) cell.addEventListener('click', () => dispatch({ type: 'battle', action: { type: 'move', unitId: selected, to: { f, r } } }));
      return cell;
    }
    const ownable = mode === 'coop' ? (u.owner === me) : (u.side === 'player');
    const cls = ['cell', (f + r) % 2 ? 'alt' : '', 'unit', u.side === 'enemy' ? 'enemy' : ''];
    if (mode === 'coop' && u.side === 'player') cls.push(u.owner === 'p1' ? 'p1' : 'p2');
    if (u.id === selected) cls.push('sel');
    if (u.hasActed && u.side === 'player') cls.push('acted');
    const clickable = ownable && !u.hasActed && b.turn === 'player';
    if (clickable) cls.push('clickable');
    const node = el('div', { class: cls.join(' ') });
    node.appendChild(el('div', { class: 'g', text: u.glyph }));
    node.appendChild(el('div', { class: 'stat', html: `<span class="atk">${u.atk}</span>/<span class="hp">${u.hp}</span>` }));
    if (u.sigils.length) node.appendChild(el('div', { class: 'sig', text: u.sigils.map((s) => SIGILS[s]?.name || s).join('·') }));
    if (mode === 'coop' && u.side === 'player') node.appendChild(el('div', { class: 'ownertag', text: u.owner === 'p1' ? '①' : '②' }));
    if (atkSet.has(u.id)) node.classList.add('sel'), node.style.boxShadow = '0 0 14px rgba(201,102,90,0.7)';
    if (clickable) node.addEventListener('click', () => {
      if (sel && atkSet.has(u.id)) dispatch({ type: 'battle', action: { type: 'attack', unitId: selected, targetId: u.id } });
      else if (ownable) onSelect(u.id);
    });
    else if (sel && atkSet.has(u.id)) node.addEventListener('click', () => dispatch({ type: 'battle', action: { type: 'attack', unitId: selected, targetId: u.id } }));
    return node;
  });
  stage.appendChild(el('div', { class: 'board-wrap' }, [board]));
  stage.appendChild(scaleBar(b));

  // 行动栏
  const turnInfo = b.turn === 'player'
    ? '我方行动'
    : '敌方行动…';
  const endBtn = el('button', {
    class: 'primary', text: mode === 'coop' ? '结束我的行动' : '结束回合',
    onclick: () => dispatch({ type: 'battle', action: { type: 'endTurn', who: me || 'p1' } }),
  });
  const hint = sel
    ? el('div', { class: 'muted', text: `已选 ${sel.glyph}${sel.name}：点高亮格移动，点红框敌子攻击。` })
    : el('div', { class: 'muted', text: '点选你的棋子查看可行动范围。' });
  stage.appendChild(el('div', { class: 'panel', style: 'margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap' }, [
    el('div', { class: 'pill', text: turnInfo }), hint, el('div', { class: 'spacer' }), endBtn,
  ]));

  side.appendChild(rosterPanel(state));
  if (mode === 'coop') side.appendChild(coopPanel(b, me));
  side.appendChild(logPanel(state, true));
}

function scaleBar(b) {
  const p = b.scale.player, e = b.scale.enemy;
  const max = Math.max(p, e, 10);
  const pw = Math.min(50, (p / (max * 2)) * 100);
  const ew = Math.min(50, (e / (max * 2)) * 100);
  return el('div', { class: 'scale' }, [
    el('div', { class: 'num p', text: String(p) }),
    el('div', { class: 'bar' }, [
      el('div', { class: 'mid' }),
      el('div', { class: 'fill-p', style: `width:${pw}%` }),
      el('div', { class: 'fill-e', style: `width:${ew}%` }),
    ]),
    el('div', { class: 'num e', text: String(e) }),
    el('div', { class: 'muted', text: `天平差 ${p - e >= 0 ? '+' : ''}${p - e} / 需 ${b.winScale}` }),
  ]);
}

function coopPanel(b, me) {
  const mine = livingUnits(b, 'player').filter((u) => u.owner === me && !u.hasActed).length;
  const p1done = b.playersDone.p1, p2done = b.playersDone.p2;
  return el('div', { class: 'panel' }, [
    el('h4', { text: '合作状态' }),
    el('div', { class: 'muted', text: `你的可用单位：${mine}` }),
    el('div', { class: 'muted' }, [
      el('span', { class: 'status-dot ' + (p1done ? 'on' : '') }), el('span', { text: ' 玩家一已行动 ' }),
      el('span', { class: 'status-dot ' + (p2done ? 'on' : '') }), el('span', { text: ' 玩家二已行动' }),
    ]),
  ]);
}

// ----------------------------------------------------------------- 战利品
function renderLoot(stage, side, ctx) {
  const { state, dispatch } = ctx;
  const opts = state.pending?.options || [];
  const panel = el('div', { class: 'panel' }, [el('h4', { text: '战利品 · 三选一' })]);
  const wrap = el('div', { class: 'choices' });
  opts.forEach((o, i) => {
    wrap.appendChild(el('button', { class: 'choice', onclick: () => dispatch({ type: 'loot', idx: i }) }, [
      el('div', { class: 'ct', text: o.name }),
      el('div', { class: 'cd', text: o.desc + (o.type ? `（${PIECES[o.type]?.glyph || ''} ${PIECES[o.type]?.name || ''}）` : '') }),
    ]));
  });
  panel.appendChild(wrap);
  stage.appendChild(panel);
  side.appendChild(rosterPanel(state));
  side.appendChild(logPanel(state));
}

// ----------------------------------------------------------------- 升变
function renderPromote(stage, side, ctx) {
  const { state, dispatch } = ctx;
  const { pawns, choices } = promoteOptions(state);
  const panel = el('div', { class: 'panel' }, [el('h4', { text: '升变之所' })]);
  if (!pawns.length) {
    panel.appendChild(el('div', { class: 'muted', text: '队伍中没有兵可以升变。' }));
  } else {
    panel.appendChild(el('div', { class: 'muted', text: '选择一名兵，以及它要成为的形态：' }));
    for (const p of pawns) {
      const row = el('div', { class: 'choices' });
      for (const c of choices) {
        const base = PIECES[c];
        row.appendChild(el('button', { class: 'choice', onclick: () => dispatch({ type: 'promote', unitId: p.id, piece: c }) }, [
          el('div', { class: 'ct', text: `${base.glyph} ${base.name}` }),
          el('div', { class: 'cd', text: `${base.atk}/${base.hp} · ${base.desc}` }),
        ]));
      }
      panel.appendChild(el('div', { style: 'margin:8px 0' }, [el('div', { class: 'muted', text: `兵 ${p.name}：` }), row]));
    }
  }
  stage.appendChild(panel);
  side.appendChild(rosterPanel(state));
}

// ----------------------------------------------------------------- 休整
function renderRest(stage, side, ctx) {
  const { state, dispatch } = ctx;
  const info = restOptions(state);
  const panel = el('div', { class: 'panel' }, [el('h4', { text: '休整之所' })]);
  const wrap = el('div', { class: 'choices' });
  if (info.canRevive) {
    const sub = el('div', { class: 'choices' });
    info.fallen.forEach((u) => sub.appendChild(el('button', { class: 'choice', onclick: () => dispatch({ type: 'rest', kind: 'revive', unitId: u.id }) }, [
      el('div', { class: 'ct', text: `${u.glyph} ${u.name} 归队` }), el('div', { class: 'cd', text: '唤回一名阵亡的棋子（满血）。' }),
    ])));
    wrap.appendChild(el('div', {}, [el('div', { class: 'muted', text: '唤回：' }), sub]));
  }
  wrap.appendChild(el('button', { class: 'choice', onclick: () => dispatch({ type: 'rest', kind: 'train' }) }, [
    el('div', { class: 'ct', text: '整训' }), el('div', { class: 'cd', text: '一名棋子攻击 +1。' }),
  ]));
  wrap.appendChild(el('button', { class: 'choice', onclick: () => dispatch({ type: 'rest', kind: 'supply' }) }, [
    el('div', { class: 'ct', text: '补给' }), el('div', { class: 'cd', text: '蜡烛 +3。' }),
  ]));
  panel.appendChild(wrap);
  stage.appendChild(panel);
  side.appendChild(rosterPanel(state));
}

// ----------------------------------------------------------------- 异象
function renderEvent(stage, side, ctx) {
  const { state, dispatch } = ctx;
  const ev = state.pending?.event;
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h4', { text: `异象 · ${ev?.title || ''}` }));
  if (ev?.text) panel.appendChild(el('div', { class: 'narrative', style: 'margin-bottom:10px', text: ev.text }));
  const wrap = el('div', { class: 'choices' });
  (ev?.choices || []).forEach((c, i) => wrap.appendChild(el('button', { class: 'choice', onclick: () => dispatch({ type: 'event', idx: i }) }, [
    el('div', { class: 'ct', text: c.label }), el('div', { class: 'cd', text: c.result || '' }),
  ])));
  panel.appendChild(wrap);
  stage.appendChild(panel);
  side.appendChild(rosterPanel(state));
}

// ----------------------------------------------------------------- 章节结算
function renderChapterEnd(stage, side, ctx) {
  const { state, dispatch } = ctx;
  const ch = currentChapter(state);
  const last = state.chapterIndex + 1 >= CHAPTERS.length;
  const banner = el('div', { class: 'banner win' }, [
    el('h2', { text: '本章通关' }),
    el('p', { text: ch.winText || '' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', text: last ? '见证结局' : '进入下一章', onclick: () => dispatch({ type: 'advance' }) }),
    ]),
  ]);
  stage.appendChild(banner);
  side.appendChild(rosterPanel(state));
}

// ----------------------------------------------------------------- 终局
function renderOver(stage, side, ctx) {
  const { state } = ctx;
  const win = state.over.result === 'win';
  const reasonText = {
    allClear: '你走完了所有章节。', candles: '蜡烛燃尽。', battle: '你的棋子全数倒下。', wiped: '队伍已无一人。',
  };
  const banner = el('div', { class: 'banner ' + (win ? 'win' : 'lose') }, [
    el('h2', { text: win ? '通关 · 执局者收子' : '败局 · 归入棋匣' }),
    el('p', { text: state.over.text || reasonText[state.over.reason] || '' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', text: '重新开局', onclick: () => ctx.onRestart && ctx.onRestart() }),
    ]),
  ]);
  stage.appendChild(banner);
}

// ----------------------------------------------------------------- 侧栏组件
function rosterPanel(state) {
  const ch = currentChapter(state);
  const panel = el('div', { class: 'panel' }, [el('h4', { text: `队伍（${state.roster.length}）` })]);
  const row = el('div', { class: 'roster' });
  for (const u of state.roster) {
    row.appendChild(el('div', { class: 'chip' }, [
      el('span', { class: 'g', text: PIECES[u.type]?.glyph || '·' }),
      el('span', { text: u.name }),
      el('span', { class: 'st', text: `${u.atk}/${u.hp}` }),
      ...(u.sigils.length ? [el('span', { class: 'sig', text: u.sigils.map((s) => SIGILS[s]?.name || s).join('·') })] : []),
    ]));
  }
  for (const u of state.fallen) {
    row.appendChild(el('div', { class: 'chip dead' }, [
      el('span', { class: 'g', text: PIECES[u.type]?.glyph || '·' }), el('span', { text: u.name }),
    ]));
  }
  panel.appendChild(row);
  if (state.relics.length) {
    panel.appendChild(el('div', { style: 'margin-top:10px' }, [
      el('div', { class: 'muted', text: '遗物：' }),
      ...state.relics.map((r) => el('div', { class: 'muted', text: `${RELICS[r]?.glyph || ''} ${RELICS[r]?.name || r} — ${RELICS[r]?.desc || ''}` })),
    ]));
  }
  return panel;
}

function narrativePanel(ch) {
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('div', { class: 'narrative' }, [
    el('span', { class: 'who', text: '执局者：' }),
    el('span', { text: (ch.intro && ch.intro[0]) || '' }),
  ]));
  return panel;
}

function logPanel(state, battle = false) {
  const panel = el('div', { class: 'panel' }, [el('h4', { text: battle ? '战斗记录' : '旅程记录' })]);
  const log = el('div', { class: 'log' });
  const src = battle && state.battle ? state.battle.log : state.log;
  for (const line of src.slice(-40)) log.appendChild(el('div', { text: line }));
  panel.appendChild(log);
  return panel;
}

// ----------------------------------------------------------------- 入口
export function renderGame(root, ctx) {
  root.innerHTML = '';
  if (!ctx.state) return;
  root.appendChild(topbar(ctx.state, ctx.me, ctx.mode));
  const layout = el('div', { class: 'layout' });
  const stage = el('div', { class: 'stage' });
  const side = el('div', { class: 'side' });
  layout.append(stage, side);
  root.appendChild(layout);
  switch (ctx.state.phase) {
    case 'map': renderMap(stage, side, ctx); break;
    case 'battle': renderBattle(stage, side, ctx); break;
    case 'loot': renderLoot(stage, side, ctx); break;
    case 'promote': renderPromote(stage, side, ctx); break;
    case 'rest': renderRest(stage, side, ctx); break;
    case 'event': renderEvent(stage, side, ctx); break;
    case 'chapterEnd': renderChapterEnd(stage, side, ctx); break;
    case 'over': renderOver(stage, side, ctx); break;
    default: stage.appendChild(el('div', { class: 'panel', text: '…' }));
  }
}
