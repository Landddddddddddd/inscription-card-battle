// Pure rendering + visual effects. Reads `ctx` and paints the DOM.
// Interaction is handled by main.js via event delegation on data-* attributes.
import { CONFIG, SIGILS, CARDS, FACTIONS, GEMS, RARITY, RARITY_ORDER, rarityOf, allCardIds, PACK, GEM_PACK, CARD_SHOP_PRICES, RECHARGE_PACKAGES, GEM_EXCHANGE, RULE_OPTIONS, SCOPE_NAMES, normalizeRules, rulesSummary, winModeName, winModeDesc, winScaleOptions, WIN_SCALE_CAP, isCostedCard, CHANGELOG, RANK, rankLabel, rankColor, isTopRank } from './constants.js';
import { getAttack, availableGems } from './engine.js';
import { cardArt } from './art.js';
import { playSfx } from './audio.js';
import { getBinds, fmtBind } from './keybinds.js';

// Render a card's illustration. Accepts an instance (has .cardId) or a raw id.
function portraitHTML(cardOrId, glyph) {
  const card = typeof cardOrId === 'string' ? { ...CARDS[cardOrId], cardId: cardOrId } : cardOrId;
  const g = glyph != null ? glyph : (card && card.glyph) || '';
  return `<div class="portrait">${cardArt(card)}<span class="glyph-badge">${g}</span></div>`;
}

function el(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---- animation diff state (survives innerHTML rebuilds by comparing iids) ----
const _prev = {
  board: { A: new Set(), B: new Set() }, hand: new Set(),
  hp: {}, res: {}, weights: { A: 0, B: 0 }, laneOf: {}, first: true,
};
export function resetGameView() {
  _prev.board.A = new Set(); _prev.board.B = new Set();
  _prev.hand = new Set(); _prev.hp = {}; _prev.res = {};
  _prev.weights = { A: 0, B: 0 }; _prev.laneOf = {}; _prev.first = true;
}

// ============================================================================
// VISUAL EFFECTS  (particles, damage numbers, slashes, resource bursts)
// ============================================================================
function fx() { return el('fx'); }

function particle(x, y, o = {}) {
  const p = document.createElement('div');
  p.className = 'fx-p';
  const size = o.size || 6;
  if (o.glyph) { p.textContent = o.glyph; p.style.fontSize = size + 'px'; p.style.color = o.color || '#fff'; }
  else { p.style.width = size + 'px'; p.style.height = size + 'px'; p.style.background = o.color || '#fff'; p.style.borderRadius = o.square ? '2px' : '50%'; }
  if (o.glow) p.style.boxShadow = `0 0 ${o.glow}px ${o.color || '#fff'}`;
  p.style.left = x + 'px'; p.style.top = y + 'px';
  p.style.transitionDuration = (o.life || 650) + 'ms';
  fx().appendChild(p);
  requestAnimationFrame(() => {
    p.style.transform = `translate(${o.dx || 0}px, ${o.dy || 0}px) rotate(${o.rot || 0}deg) scale(${o.scale ?? 1})`;
    p.style.opacity = '0';
  });
  setTimeout(() => p.remove(), (o.life || 650) + 60);
}

function burst(x, y, o = {}) {
  const n = o.count || 10;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const dist = (o.spread || 46) * (0.5 + Math.random() * 0.7);
    particle(x, y, {
      color: Array.isArray(o.color) ? o.color[i % o.color.length] : o.color,
      size: o.size || (4 + Math.random() * 5),
      glyph: o.glyph, square: o.square, glow: o.glow,
      dx: Math.cos(a) * dist, dy: Math.sin(a) * dist + (o.grav || 0),
      rot: (Math.random() - 0.5) * 360, life: o.life || 650,
    });
  }
}

function floatText(x, y, text, color) {
  const t = document.createElement('div');
  t.className = 'fx-txt'; t.textContent = text; t.style.color = color || '#fff';
  t.style.left = x + 'px'; t.style.top = y + 'px';
  fx().appendChild(t);
  requestAnimationFrame(() => { t.style.transform = 'translate(-50%, -42px)'; t.style.opacity = '0'; });
  setTimeout(() => t.remove(), 900);
}

// 表情浮层：在发送方一侧（A=下方 / B=上方）弹出一个上浮淡出的 emoji。
export function showEmote(side, icon) {
  const layer = fx(); if (!layer || !icon) return;
  const d = document.createElement('div');
  d.className = 'fx-emote';
  d.textContent = icon;
  d.style.left = '50%';
  d.style.top = (side === 'B') ? '16%' : '80%';
  layer.appendChild(d);
  requestAnimationFrame(() => { d.style.transform = 'translate(-50%, -64px) scale(1.5)'; d.style.opacity = '0'; });
  setTimeout(() => d.remove(), 1200);
}

function slash(x, y) {
  const s = document.createElement('div');
  s.className = 'fx-slash';
  s.style.left = x + 'px'; s.style.top = y + 'px';
  s.style.transform = `translate(-50%,-50%) rotate(${-35 + Math.random() * 20}deg) scaleX(0)`;
  fx().appendChild(s);
  requestAnimationFrame(() => { s.style.transform = s.style.transform.replace('scaleX(0)', 'scaleX(1)'); s.style.opacity = '1'; });
  setTimeout(() => { s.style.opacity = '0'; }, 120);
  setTimeout(() => s.remove(), 360);
}

function cellCenter(side, lane) {
  const c = document.querySelector(`[data-cell="${side}-${lane}"]`);
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function ring(x, y, color) {
  const r = document.createElement('div');
  r.className = 'fx-ring';
  if (color) { r.style.borderColor = color; r.style.boxShadow = `0 0 16px ${color}, 0 0 26px ${color}`; }
  r.style.left = x + 'px'; r.style.top = y + 'px';
  fx().appendChild(r);
  requestAnimationFrame(() => { r.style.transform = 'translate(-50%,-50%) scale(3.4)'; r.style.opacity = '0'; });
  setTimeout(() => r.remove(), 460);
}

// Briefly shudder the board on impactful hits.
let _shakeT = 0;
function boardShake() {
  const b = el('board'); if (!b) return;
  clearTimeout(_shakeT); b.classList.remove('shake-sm');
  void b.offsetWidth; b.classList.add('shake-sm');
  _shakeT = setTimeout(() => b.classList.remove('shake-sm'), 320);
}
// Stronger shake for critical hits (double_strike / 致死 / heavy scale damage).
let _shakeLgT = 0;
function boardShakeLg() {
  const b = el('board'); if (!b) return;
  clearTimeout(_shakeLgT); b.classList.remove('shake-lg');
  void b.offsetWidth; b.classList.add('shake-lg');
  _shakeLgT = setTimeout(() => b.classList.remove('shake-lg'), 440);
}
// 召唤光柱：从列中心向上冲出的光能柱。
function beam(x, y, color) {
  const b = document.createElement('div');
  b.className = 'fx-beam';
  b.style.left = x + 'px'; b.style.top = y + 'px';
  if (color) b.style.background = `linear-gradient(to top, ${color}, transparent)`;
  fx().appendChild(b);
  requestAnimationFrame(() => b.classList.add('go'));
  setTimeout(() => b.remove(), 720);
}
// 死亡碎裂：碎片四散 + 暗烟。
function shatter(x, y) {
  for (let i = 0; i < 9; i++) {
    const a = (Math.PI * 2 * i) / 9 + Math.random() * 0.5;
    particle(x, y, { color: ['#9a9a9a', '#6a6a6a', '#bdbdbd'][i % 3], size: 6 + Math.random() * 5, square: true, dx: Math.cos(a) * 40, dy: Math.sin(a) * 40 - 8, rot: Math.random() * 360, life: 640 });
  }
  burst(x, y, { count: 9, color: ['#2a2a2a', '#464646'], size: 6, spread: 30, grav: 12, life: 520 });
}
// 献祭血祭：红色血光上涌（献祭场上单位支付血肉时播放）。
function bloodRitual(x, y) {
  const b = document.createElement('div');
  b.className = 'fx-blood';
  b.style.left = x + 'px'; b.style.top = y + 'px';
  fx().appendChild(b);
  requestAnimationFrame(() => b.classList.add('go'));
  setTimeout(() => b.remove(), 760);
  burst(x, y, { count: 18, color: ['#e0402f', '#b5241f', '#7a1a12', '#ff7a5a'], size: 6, spread: 48, grav: -22, life: 740, glow: 6 });
  floatText(x, y - 8, '献祭', '#e0655a');
}
// 暴击/双击金色爆点。
function critBurst(x, y) {
  burst(x, y, { count: 16, color: ['#ffd15a', '#e0b03a', '#fff2c0'], glyph: '✦', size: 13, spread: 52, life: 620, glow: 10 });
}

// 待播的献祭特效：main.js 在 act() 献祭分支调用 markSacrifice(iids)，
// 下次 render 后 runGameFX 据此把被献祭单位渲染成血祭而非普通死亡碎裂。
let _pendingSac = [];
export function markSacrifice(iids) { _pendingSac = Array.isArray(iids) ? iids.slice() : []; }

// Make the attacker card lunge toward the lane it just struck.
function lungeAttacker(defSide, lane, me) {
  const atkSide = defSide === 'A' ? 'B' : 'A';
  const cell = document.querySelector(`[data-cell="${atkSide}-${lane}"]`);
  const card = cell && cell.querySelector('.card');
  if (!card) return;
  // In the vertical board the attacker (on one side) lunges toward the
  // defender on the opposite side: my unit is at the bottom → lunges up;
  // the enemy unit is at the top → lunges down.
  const dir = atkSide === me ? 'lunge-up' : 'lunge-down';
  card.classList.remove('lunge-up', 'lunge-down'); void card.offsetWidth;
  card.classList.add(dir);
  setTimeout(() => card.classList.remove(dir), 360);
}

// Resource-collection effects, themed per faction resource.
function resourceBurst(kind, amount, gemColor) {
  const anchor = el('resources');
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const reps = Math.min(4, Math.max(1, amount));
  if (kind === 'blood') {
    burst(x, y, { count: 8 * reps, color: ['#e0402f', '#b5241f', '#7a1a12'], size: 6, grav: 40, glow: 6, life: 700 });
    floatText(x, y, '＋血肉', '#e0655a');
  } else if (kind === 'bone') {
    burst(x, y, { count: 8 * reps, color: ['#efe9d6', '#cfc7ac'], square: true, size: 6, grav: 34, life: 700, glyph: '' });
    floatText(x, y, '＋骸骨', '#efe9d6');
  } else if (kind === 'energy') {
    burst(x, y, { count: 10 * reps, color: ['#5fd0ff', '#8ae6ff', '#ffffff'], glyph: '✦', size: 12, glow: 8, life: 620 });
    floatText(x, y, '⚡能量', '#7fdcff');
  } else if (kind === 'gem') {
    const col = (GEMS[gemColor] && GEMS[gemColor].color) || '#c9a0ff';
    burst(x, y, { count: 12, color: [col, '#ffffff'], glyph: '◆', size: 13, glow: 10, life: 700 });
    floatText(x, y, '◆魔石', col);
  }
}

function runGameFX(ev, me, state) {
  if (_prev.first) return; // no FX on the very first paint
  const sacSet = new Set(_pendingSac); _pendingSac = [];
  // ---- Combat damage numbers (BOTH sides) ----
  // Driven by the engine's lastCombat log: every creature hit (mine OR enemy,
  // including LETHAL hits where the card is already gone) and every scale
  // (airborne / unblocked) attack shows a floating number. This replaces the
  // old HP-diff detection, which silently missed deaths and scale strikes.
  if (ev.combat && ev.combat.length) {
    const realHit = ev.combat.some((e) => e.scale || e.dmg != null || e.blocked || e.quill || e.dbl || e.death);
    if (realHit) { boardShake(); playSfx('attack'); }
  }
  // 骸骨掉落特效：己方单位「以任何方式死亡」掉骸骨时，在死亡处迸发骨片并飘「💀 +N🦴」。
  for (const e of (ev.combat || [])) {
    if (!e.boneGain) continue;
    const c = cellCenter(e.side, e.lane);
    if (c) {
      burst(c.x, c.y, { count: 12, color: ['#efe9d6', '#cfc7ac', '#fff7e0'], square: true, size: 7, spread: 46, grav: 30, life: 760, glow: 4 });
      floatText(c.x, c.y - 12, '💀 +' + (e.amount || 1) + '🦴', '#efe9d6');
      ring(c.x, c.y, '#cfc7ac');
    }
    playSfx('bone');
  }
  for (const e of (ev.combat || [])) {
    if (e.scale) {
      // airborne / unblocked attack landed on the scale, not a creature.
      const scale = el('scaleWrap');
      if (scale) {
        const r = scale.getBoundingClientRect();
        const mine = e.by === me;
        const x = mine ? r.left + r.width * 0.72 : r.left + r.width * 0.28;
        floatText(x, r.top + 6, '天平 +' + e.dmg + (e.dbl ? ' ×2' : ''), mine ? '#e0b03a' : '#c0392b');
        if (e.dbl) critBurst(x, r.top + 14);
        playSfx('scale');
      }
      continue;
    }
    if (e.blocked) {
      // 地面攻击方被同列敌方飞行单位拦截：让它做出扑击动作，并在拦截者身上
      // 飘出蓝色「被飞行单位拦截」提示，说明为什么这一下没造成伤害。
      const atk = cellCenter(e.atkSide, e.lane);
      const blk = cellCenter(e.blkSide, e.lane);
      if (atk) lungeAttacker(e.atkSide, e.lane, me);
      if (blk) {
        ring(blk.x, blk.y, '#7fd0ff');
        floatText(blk.x, blk.y - 10, '被飞行单位拦截', '#7fd0ff');
      }
      playSfx('scale');
      continue;
    }
    playSfx('hit');
    const c = cellCenter(e.side, e.lane);   // works even if the unit died this turn
    if (!c) continue;
    const mine = e.side === me;                 // the unit that TOOK the damage
    lungeAttacker(e.side, e.lane, me);          // lunge its attacker (opposite side, same lane)
    slash(c.x, c.y);
    ring(c.x, c.y, mine ? '#ff6a4a' : '#ffcf5a');
    burst(c.x, c.y, { count: 12, color: mine ? ['#ff7a5a', '#c0392b', '#ffd0b0'] : ['#ffd15a', '#e0b03a', '#fff2c0'], size: 5, spread: 42, life: 520, glow: 5, grav: 8 });
    floatText(c.x, c.y - 10, '-' + e.dmg, '#ff5a4a');
    if (e.quill) floatText(c.x + 22, c.y - 6, '反伤', '#7fd0ff');
    if (e.dbl) { critBurst(c.x, c.y); floatText(c.x, c.y - 30, '双击!', '#ffd15a'); boardShakeLg(); }
    if (e.death) { floatText(c.x, c.y - 44, '即死!', '#c77dff'); critBurst(c.x, c.y); }
  }
  // summons: sparkle
  for (const s of ev.summons) {
    const c = cellCenter(s.side, s.lane);
    if (c) { beam(c.x, c.y, s.side === me ? 'rgba(255,224,138,1)' : 'rgba(205,234,254,1)'); burst(c.x, c.y, { count: 12, color: ['#ffe08a', '#d9a441', '#ffffff'], glyph: '✦', size: 11, spread: 44, life: 600, glow: 6 }); }
    if (s.side === me) playSfx('summon');
  }
  // deaths: dark puff at last known cell
  for (const d of ev.deaths) {
    const c = cellCenter(d.side, d.lane);
    if (c) { if (sacSet.has(d.iid)) bloodRitual(c.x, c.y); else shatter(c.x, c.y); }
  }
  // (scale "+N" floats are now emitted per-attack from ev.combat above)
}

// ============================================================================
// CARD RENDERING
// ============================================================================
function gemCounts(state, p) {
  const c = {};
  for (const lane of state.board[p]) if (lane && lane.mox) c[lane.mox] = (c[lane.mox] || 0) + 1;
  return c;
}

export function canPlayCard(state, me, card) {
  const pl = state.players[me];
  if (card.costType === 'free') return true;
  if (card.costType === 'gem') {
    const have = availableGems(state, me);
    return (card.gemCost || []).every((g) => have.has(g));
  }
  if (card.costType === 'blood') {
    // 血肉：每回合无偿血肉 = 0（不攒、回合开始重置为 0），完全靠献祭场上已召唤单位获得血肉来支付。
    // 能否召唤 = 场上可献祭总血肉。
    if (card.cost === 0) return true;
    let avail = pl.blood || 0;
    for (const c of state.board[me]) if (c) avail += c.bloodValue;
    return avail >= card.cost;
  }
  if (card.costType === 'sand') return (pl.seconds || 0) >= card.cost;
  const pool = card.costType === 'bone' ? 'bones' : 'energy';
  return pl[pool] >= card.cost;
}

function gemPips(gems) {
  if (!gems || !gems.length) return '';
  return gems.map((g) => `<span class="gpip" style="background:${GEMS[g] ? GEMS[g].color : '#888'}"></span>`).join('');
}

function costBadgeHTML(card) {
  if (card.costType === 'gem') {
    if (card.gemCost && card.gemCost.length) {
      return `<div class="cost gem" title="需要场上魔石：${card.gemCost.map((g) => (GEMS[g] ? GEMS[g].name : g)).join('、')}">${gemPips(card.gemCost)}</div>`;
    }
    const col = GEMS[card.mox] ? GEMS[card.mox].color : '#aaa';
    return `<div class="cost gem" title="魔石生物"><span class="gpip" style="background:${col}"></span></div>`;
  }
  const label = card.costType === 'blood' ? '血' : card.costType === 'bone' ? '骨' : card.costType === 'sand' ? '秒' : '能';
  return `<div class="cost ${card.costType}">${card.cost}${label}</div>`;
}

function cardHTML(card, opts = {}) {
  const inHand = !!opts.inHand;
  const rk = rarityOf(card.cardId);
  const cls = ['card', 'rar-' + rk];
  if (inHand) cls.push('in-hand');
  if (opts.selected) cls.push('selected');
  if (opts.sacTarget) cls.push('sac-target');
  if (opts.sacChosen) cls.push('sac-chosen');
  if (opts.dim) cls.push('unaffordable');
  if (opts.anim) cls.push(opts.anim);
  if (opts.kbCursor) cls.push('kb-cursor');

  const sig = card.sigils
    .map((s) => `<span class="sig" title="${SIGILS[s] ? SIGILS[s].desc : ''}">${SIGILS[s] ? SIGILS[s].name : s}</span>`)
    .join('');
  const atk = (opts.side != null && opts.lane != null)
    ? getAttack(opts.boardRef || { board: { A: [], B: [] } }, opts.side, opts.lane)
    : card.atk;
  const ds = opts.dataAttr || '';
  return `
    <div class="${cls.join(' ')}" data-rarity="${rk}" data-cardiid="${card.iid}" ${ds}>
      ${opts.kbIndex != null ? `<span class="kb-idx">${opts.kbIndex}</span>` : ''}
      ${costBadgeHTML(card)}
      ${portraitHTML(card)}
      <div class="cname">${card.name}</div>
      <div class="stats"><span class="atk">⚔${atk}</span><span class="hp">♥${card.hp}</span></div>
      <div class="sigils">${sig}</div>
      ${opts.sacChosen ? '<div class="sac-mark">献</div>' : ''}
    </div>`;
}

// ============================================================================
// GAME SCREEN
// ============================================================================
export function renderGame(ctx) {
  const { state, me, isMyTurn, ui } = ctx;
  const R = state.rules || {};
  const LANES = R.lanes || CONFIG.LANES;
  const W = R.winScale || CONFIG.WIN_SCALE;
  const enemy = me === 'A' ? 'B' : 'A';

  // Mode label + a compact rules summary when the match uses non-default rules.
  const nonDefault = state.rules && rulesSummary(state.rules) !== rulesSummary(null);
  el('modeLabel').textContent = (ctx.modeLabel || '') + (nonDefault ? ` 〔${rulesSummary(state.rules)}〕` : '');
  const cur = state.players[state.currentPlayer];
  let turnTxt = `轮到：${cur.name}`;
  if (state.over) turnTxt = `对局结束`;
  else if (!isMyTurn) turnTxt = `等待 ${cur.name}…`;
  el('turnLabel').textContent = turnTxt;
  // 轮到玩家时给回合标签加呼吸高亮（"该你出牌了"）
  el('turnLabel').classList.toggle('my-turn', isMyTurn && !state.over);

  // ---- Scale ----
  const meAdv = state.weights[me] - state.weights[enemy];
  const pct = 50 + Math.max(-50, Math.min(50, (meAdv / W) * 50));
  el('scaleNeedle').style.left = pct + '%';
  const fill = el('scaleWrap').querySelector('.scale-fill');
  if (fill) {
    if (meAdv >= 0) {
      fill.style.left = '50%'; fill.style.width = Math.max(0, pct - 50) + '%';
      fill.style.background = 'linear-gradient(90deg, rgba(224,176,58,.05), rgba(224,176,58,.65))';
    } else {
      fill.style.left = pct + '%'; fill.style.width = Math.max(0, 50 - pct) + '%';
      fill.style.background = 'linear-gradient(90deg, rgba(192,57,43,.65), rgba(192,57,43,.05))';
    }
  }
  const wMe = el('wMe'), wEn = el('wEnemy');
  if (wMe) wMe.textContent = state.weights[me];
  if (wEn) wEn.textContent = state.weights[enemy];

  // ---- Resources (for "me") + detect gains for FX ----
  const pl = state.players[me];
  let resHTML = '';
  const counts = gemCounts(state, me);
  if (pl.res === 'blood') {
    let sac = 0; for (const c of state.board[me]) if (c) sac += c.bloodValue;
    resHTML = `<div class="res blood"><span class="dot"></span>可献祭血肉 <span class="val">${sac}</span></div>`;
  } else if (pl.res === 'bone') {
    resHTML = `<div class="res bone"><span class="dot"></span>骸骨 <span class="val">${pl.bones}</span></div>`;
  } else if (pl.res === 'energy') {
    resHTML = `<div class="res energy"><span class="dot"></span>能量 <span class="val">${pl.energy}</span><span class="cap">/${CONFIG.ENERGY_CAP}</span></div>`;
  } else if (pl.res === 'mox') {
    const pips = Object.keys(GEMS).map((g) => {
      const n = counts[g] || 0;
      return `<span class="gpip lg ${n ? 'on' : ''}" style="background:${GEMS[g].color}">${n > 1 ? n : ''}</span>`;
    }).join('');
    resHTML = `<div class="res mox"><span class="dot" style="background:#9a4ad0"></span>魔石 ${pips}</div>`;
  } else if (pl.res === 'sand') {
    const secs = Math.floor(pl.seconds || 0);
    resHTML = `<div class="res sand"><span class="dot"></span>剩余秒数 <span class="val">${secs}</span><span class="cap">s</span></div>`;
  }
  const curRes = {};
  if (pl.res === 'bone') curRes.bone = pl.bones;
  else if (pl.res === 'energy') curRes.energy = pl.energy;
  else if (pl.res === 'mox') curRes.gemTotal = Object.values(counts).reduce((a, b) => a + b, 0);
  else if (pl.res === 'sand') curRes.seconds = Math.floor(pl.seconds || 0);
  const prevRes = _prev.res[me] || {};
  let resFlash = false, resGain = null, gemColor = null;
  for (const k in curRes) {
    if (prevRes[k] === undefined) continue;
    if (curRes[k] > prevRes[k]) { resFlash = true; resGain = { kind: k, amount: curRes[k] - prevRes[k] }; }
    else if (curRes[k] !== prevRes[k]) resFlash = true;
  }
  if (pl.res === 'mox' && resGain) {
    const pc = _prev.res[me] && _prev.res[me].gemColors ? _prev.res[me].gemColors : {};
    for (const g of Object.keys(GEMS)) if ((counts[g] || 0) > (pc[g] || 0)) gemColor = g;
    curRes.gemColors = { ...counts };
  }
  if (resFlash) resHTML = resHTML.replace('class="res ', 'class="res flash ');
  _prev.res[me] = curRes;
  el('resources').innerHTML = resHTML;

  // ---- Selected card + 献祭状态 ----
  const selCard = ui.selectedIid ? pl.hand.find((c) => c.iid === ui.selectedIid) : null;
  // "need sacrifice" highlights board units as sacrifice targets whenever a
  // blood card needs any cost paid (pool is always 0 now).
  const needSac = !!(selCard && selCard.costType === 'blood' && selCard.cost > 0);
  let sacTotal = 0;
  if (needSac) {
    for (const iid of (ui.sacList || [])) {
      const u = state.board[me].find((c) => c && c.iid === iid);
      if (u) sacTotal += u.bloodValue;
    }
  }
  // 血肉：无偿血肉恒为 0，费用完全由场上献祭支付 → 可召唤判据 = 已选献祭 >= cost
  const sacReady = needSac ? (sacTotal >= selCard.cost) : true;
  const canPlaySel = selCard ? (canPlayCard(state, me, selCard) || (needSac && sacReady)) : false;

  // ---- Board + collect FX events ----
  // Combat events come from the engine's `lastCombat` (recorded each turn in
  // resolveAttacks). We only animate them once per resolve by comparing combatSeq
  // against the previously seen value — so re-renders (selecting a card, etc.)
  // don't replay the same damage numbers.
  const showCombat = (state.combatSeq || 0) !== (_prev.combatSeq || 0);
  const fxEv = { hits: [], summons: [], deaths: [], combat: showCombat ? (state.lastCombat || []) : [], weightDelta: { me: 0, enemy: 0 } };
  // 非战斗的生命变化（regen / 各类加血）：收集起来，渲染后飘绿色 +N♥。
  const hpUps = [];
  // ---- Board (vertical stack): enemy army on TOP, yours on BOTTOM. ----
  //      Each army is a horizontal row of lanes; the field stacks vertically. ----
  const laneRow = (side, isMine) => {
    let cells = '';
    for (let l = 0; l < LANES; l++) {
      const c = state.board[side][l];
      let inner = '';
      let cls = 'lane' + (isMine ? ' mine' : '');
      let ds = `data-cell="${side}-${l}"`;
      if (c) {
        const isNew = !_prev.board[side].has(c.iid);
        const wasHp = _prev.hp[c.iid];
        const isHit = wasHp !== undefined && c.hp < wasHp;
        if (isNew) fxEv.summons.push({ side, lane: l });
        // 非战斗加血（regen 等）：旧 HP 已知且本回合变高 → 飘绿字。
        if (!isNew && wasHp !== undefined && c.hp > wasHp) hpUps.push({ side, lane: l, delta: c.hp - wasHp });
        const isSacMode = isMine && needSac && isMyTurn && !state.over;
        const sacChosen = isSacMode && (ui.sacList || []).includes(c.iid);
        // 刚被献祭的格子（已选为祭品且血肉已凑够）→ 变成「放置新城」的目标列：
        // 可把刚打出的血肉生物直接放在这一列（与其它阵营统一：放在刚腾出的格子）。
        const sacPlace = isSacMode && sacChosen && sacReady;
        inner = cardHTML(c, {
          inHand: false, side, lane: l, boardRef: state,
          sacTarget: isSacMode && !sacPlace, sacChosen: sacChosen && !sacPlace,
          anim: isNew ? 'appear' : (isHit ? 'hit' : ''),
          dataAttr: sacPlace ? `data-playlane="${l}"` : (isSacMode ? `data-saccard="${c.iid}"` : ''),
        });
        if (sacPlace) cls += ' playable sac-place';
        if (ui.aiLastIid === c.iid) cls += ' ai-just';
      } else if (isMine && isMyTurn && canPlaySel && !state.over) {
        cls += ' playable';
        ds += ` data-playlane="${l}"`;
      }
      // 键盘目标提示：选牌后高亮可出牌（空列）/ 可献祭（己方单位列）的列号，以及当前列光标。
      if (isMine && ctx.kbArmed) {
        if (!c && cls.indexOf('playable') >= 0) cls += ' kb-lane';
        else if (c && needSac && isMyTurn && !state.over) cls += ' kb-sac';
      }
      if (isMine && ctx.kb && ctx.kb.laneIdx === l && ui.selectedIid) cls += ' kb-cursor';
      cells += `<div class="${cls}" ${ds}><span class="lane-no">${l + 1}</span>${inner}</div>`;
    }
    return `<div class="lanes" data-n="${LANES}">${cells}</div>`;
  };
  el('board').innerHTML = `
    <div class="row-label"><span class="pl-avatar">${state.players[enemy].avatar || '🜁'}</span>▲ ${state.players[enemy].name} 的场地</div>
    ${laneRow(enemy, false)}
    <div class="mid-divider"></div>
    <div class="row-label"><span class="pl-avatar">${state.players[me].avatar || '🜁'}</span>▼ 你的场地（${state.players[me].name}）</div>
    ${laneRow(me, true)}`;

  // ---- 非战斗加血飘字（regen 等）：DOM 已就位，直接定位每列中心 ----
  for (const u of hpUps) {
    const ctr = cellCenter(u.side, u.lane);
    if (ctr) floatText(ctr.x, ctr.y - 6, '+' + u.delta + '♥', '#8ad98a');
  }

  // ---- deaths: iids that were on board and are gone now ----
  const nowSet = { A: new Set(state.board.A.filter(Boolean).map((c) => c.iid)), B: new Set(state.board.B.filter(Boolean).map((c) => c.iid)) };
  for (const side of ['A', 'B']) {
    for (const iid of _prev.board[side]) {
      if (!nowSet[side].has(iid) && _prev.laneOf[iid]) fxEv.deaths.push({ ..._prev.laneOf[iid], iid });
    }
  }
  fxEv.weightDelta.me = state.weights[me] - _prev.weights[me];
  fxEv.weightDelta.enemy = state.weights[enemy] - _prev.weights[enemy];

  // ---- Hand ----
  let handHTML = '';
  const handArr = state.players[me].hand;
  for (let hi = 0; hi < handArr.length; hi++) {
    const c = handArr[hi];
    const isNew = !_prev.hand.has(c.iid);
    const dim = !canPlayCard(state, me, c);
    const kbCursor = !!(ctx.kb && ctx.kb.handIdx === hi && !ui.selectedIid);
    handHTML += cardHTML(c, { inHand: true, selected: ui.selectedIid === c.iid, dim, anim: isNew ? 'appear' : '', dataAttr: `data-hand="${c.iid}"`, kbIndex: hi + 1, kbCursor });
  }
  el('hand').innerHTML = handHTML || '<span style="color:var(--text-dim)">（手牌为空）</span>';

  // ---- run FX (after DOM in place) ----
  requestAnimationFrame(() => runGameFX(fxEv, me, state));
  if (resGain) requestAnimationFrame(() => resourceBurst(resGain.kind, resGain.amount, gemColor));

  // ---- update diff sets ----
  _prev.laneOf = {};
  for (const side of ['A', 'B']) for (let l = 0; l < LANES; l++) { const c = state.board[side][l]; if (c) _prev.laneOf[c.iid] = { side, lane: l }; }
  _prev.board.A = nowSet.A; _prev.board.B = nowSet.B;
  _prev.hand = new Set(state.players[me].hand.map((c) => c.iid));
  _prev.hp = {};
  for (const side of ['A', 'B']) for (const c of state.board[side]) if (c) _prev.hp[c.iid] = c.hp;
  _prev.weights = { A: state.weights.A, B: state.weights.B };
  _prev.combatSeq = state.combatSeq || 0;
  _prev.first = false;

  // ---- Controls ----
  const endBtn = document.querySelector('[data-act="endTurn"]');
  if (endBtn) endBtn.disabled = !isMyTurn || state.over;

  el('statusMsg').textContent = ctx.statusMsg || '';
  renderLog(state);
}

function renderLog(state) {
  const log = state.log.slice(-30);
  el('log').innerHTML = log.map((l, i) => `<div class="${i >= log.length - 3 ? 'me' : ''}">${l}</div>`).join('');
  const box = el('log'); box.scrollTop = box.scrollHeight;
}

// 新手引导动画指针：动态箭头指向教程要求操作的目标元素 + 脉冲高亮。
let _tutArrow = null, _tutPulseEl = null;
function clearTutPointer() {
  if (_tutArrow) { _tutArrow.remove(); _tutArrow = null; }
  if (_tutPulseEl) { _tutPulseEl.classList.remove('tut-pulse'); _tutPulseEl = null; }
}
export function showOverlay(text, showNext, step) {
  clearTutPointer();
  el('overlayText').textContent = text;
  el('overlayNext').classList.toggle('hidden', !showNext);
  const c = el('overlayContinue'); if (c) c.classList.add('hidden');
  const ov = el('overlay');
  ov.classList.remove('hidden');
  const useTut = !!(step && step.target);
  ov.classList.toggle('tut-mode', useTut);
  if (useTut) {
    const tgt = document.querySelector(step.target);
    if (tgt) {
      _tutPulseEl = tgt; tgt.classList.add('tut-pulse');
      requestAnimationFrame(() => {
        if (_tutPulseEl !== tgt) return;
        const r = tgt.getBoundingClientRect();
        const dir = step.arrowDir || 'above';
        const a = document.createElement('div');
        a.className = 'tut-arrow ' + dir;
        let x = r.left + r.width / 2, y = r.top - 16;
        if (dir === 'below') { x = r.left + r.width / 2; y = r.bottom + 16; }
        else if (dir === 'left') { x = r.left - 16; y = r.top + r.height / 2; }
        else if (dir === 'right') { x = r.right + 16; y = r.top + r.height / 2; }
        a.style.left = x + 'px'; a.style.top = y + 'px';
        document.body.appendChild(a);
        _tutArrow = a;
      });
    }
  }
}
export function hideOverlay() { clearTutPointer(); el('overlay').classList.remove('tut-mode'); el('overlay').classList.add('hidden'); const c = el('overlayContinue'); if (c) c.classList.add('hidden'); }
// Handoff screen for local hotseat: hide the tutorial "next" button, show "continue".
export function showHandoff(text) {
  clearTutPointer(); el('overlay').classList.remove('tut-mode');
  el('overlayText').textContent = text;
  const next = el('overlayNext'); if (next) next.classList.add('hidden');
  const cont = el('overlayContinue');
  if (cont) { cont.textContent = '继续 ▶'; cont.classList.remove('hidden'); }
  el('overlay').classList.remove('hidden');
}
export function showGameOver(text, reward) {
  el('gameoverText').textContent = text;
  const r = el('gameoverReward'); if (r) r.textContent = reward || '';
  el('gameover').classList.remove('hidden');
  // celebratory / somber / neutral burst
  const box = el('gameover').querySelector('.overlay-box');
  if (box) {
    const rect = box.getBoundingClientRect();
    const win = /赢|胜|🏆/.test(text);
    const draw = /平局/.test(text);
    const col = win ? ['#ffe08a', '#d9a441', '#fff'] : draw ? ['#9fb4d8', '#5a6b8c', '#fff'] : ['#c0392b', '#6a1a12'];
    const glyph = win ? '✦' : draw ? '🤝' : '';
    setTimeout(() => burst(rect.left + rect.width / 2, rect.top + rect.height / 2, {
      count: 24, color: col, glyph, size: 12, spread: 120, grav: 30, life: 1100, glow: 8,
    }), 120);
  }
}
export function hideGameOver() { el('gameover').classList.add('hidden'); }

// 求和 / 投降 控件：根据对局状态显示「求和」按钮、投降按钮，以及待处理求和的接受/拒绝条。
export function renderPeace(state, me, isMyTurn) {
  const reqBtn = document.querySelector('[data-act="requestPeace"]');
  const surBtn = document.querySelector('[data-act="surrender"]');
  const peaceBar = document.getElementById('peaceBar');
  const peaceText = document.getElementById('peaceText');
  const acceptBtn = document.querySelector('[data-act="peaceAccept"]');
  const declineBtn = document.querySelector('[data-act="peaceDecline"]');
  if (!reqBtn && !surBtn && !peaceBar) return; // 非对局界面
  const over = !!state.over;
  const used = state.peaceUsed && state.peaceUsed[me];
  const pending = state.peacePending;
  // 求和按钮：仅自己回合、未结束、无待处理、本局未申请过
  if (reqBtn) {
    reqBtn.classList.toggle('hidden', over);
    reqBtn.disabled = !(isMyTurn && !over && !pending && !used);
    reqBtn.textContent = used ? '🤝 求和(已用)' : '🤝 求和';
  }
  if (surBtn) {
    surBtn.classList.toggle('hidden', over);
    surBtn.disabled = !(isMyTurn && !over);
  }
  // 待处理求和条
  if (!peaceBar) return;
  if (!over && pending) {
    const reqName = state.players[pending].name;
    if (pending !== me) {
      // 我是回应方 → 显示接受/拒绝
      if (peaceText) peaceText.textContent = `${reqName} 申请求和（平局），是否接受？`;
      peaceBar.classList.remove('hidden');
      if (acceptBtn) acceptBtn.classList.remove('hidden');
      if (declineBtn) declineBtn.classList.remove('hidden');
    } else {
      // 我是申请方 → 仅提示等待
      if (peaceText) peaceText.textContent = `你已向 ${state.players[me === 'A' ? 'B' : 'A'].name} 申请求和，等待回应…`;
      peaceBar.classList.remove('hidden');
      if (acceptBtn) acceptBtn.classList.add('hidden');
      if (declineBtn) declineBtn.classList.add('hidden');
    }
  } else {
    peaceBar.classList.add('hidden');
  }
}

// ============================================================================
// DECK BUILDER  (locked cards are shown but not addable)
// ============================================================================
const FACTION_ORDER = ['blood', 'bone', 'energy', 'mox', 'sand'];
const costLabel = (t) => (t === 'blood' ? '血' : t === 'bone' ? '骨' : '能');

function miniCostHTML(c) {
  if (c.costType === 'gem') {
    return c.gemCost && c.gemCost.length
      ? `<div class="bcost gem">${gemPips(c.gemCost)}</div>`
      : `<div class="bcost gem"><span class="gpip" style="background:${GEMS[c.mox] ? GEMS[c.mox].color : '#aaa'}"></span></div>`;
  }
  return `<div class="bcost ${c.costType}">${c.cost}${costLabel(c.costType)}</div>`;
}

export function renderDeckBuilder(ctx) {
  const { faction, counts, min, max, total, unlocked, who, decks, currentDeckId, currentDeckName, focusIdx } = ctx;
  // 渲染「我的卡组」下拉
  const sel = el('deckSelect');
  if (sel) {
    sel.innerHTML = `<option value="">＋ 新建 / 未保存</option>` + (decks || []).map((d) =>
      `<option value="${d.id}" ${d.id === currentDeckId ? 'selected' : ''}>${esc(d.name)}（${FACTIONS[d.res] ? FACTIONS[d.res].name : d.res} · ${d.cards.length}）</option>`
    ).join('');
  }
  const nm = el('deckName');
  if (nm) nm.value = currentDeckName || '';
  el('builderFactionName').textContent = (who ? who + ' · ' : '') + faction.name;
  el('builderDesc').textContent = faction.desc;
  el('factionTabs').innerHTML = FACTION_ORDER.map((k) => {
    const f = FACTIONS[k];
    return `<button class="ftab ${k === faction.key ? 'active' : ''}" data-btab="${k}" style="--fc:${f.color}">${f.name}</button>`;
  }).join('');
  // 战斗前选卡组：只展示「已解锁」的卡牌；未解锁的卡仅在「我的收藏」中显示。
  const visibleCards = (unlocked ? faction.cards.filter((id) => unlocked.has(id)) : faction.cards);
  el('builderGrid').innerHTML = visibleCards.map((id, idx) => {
    const c = CARDS[id];
    const n = counts[id] || 0;
    // 有费卡（含需特定魔石才能召唤的魔石法术卡）每张最多 1 张；真正的 0 费免费卡（含魔石生物）可重复。
    const capped = isCostedCard(id);
    const cap = capped ? 1 : CONFIG.ZERO_COST_MAX;
    const rk = rarityOf(id);
    const sig = (c.sigils || []).map((s) => `<span class="sig" title="${SIGILS[s] ? SIGILS[s].desc : ''}">${SIGILS[s] ? SIGILS[s].name : s}</span>`).join(' ');
    const focusCls = (idx === focusIdx) ? ' kb-focus' : '';
    return `
      <div class="bcard rar-${rk}${focusCls}" data-rarity="${rk}" data-bidx="${idx}">
        ${portraitHTML(id)}
        <div class="cname">${c.name}</div>
        ${miniCostHTML(c)}
        <div class="sigils">${sig}</div>
        <div class="bctrl">
          <button class="bstep" data-bcard="${id}" data-bdelta="-1" ${(n <= 0) ? 'disabled' : ''}>−</button>
          <span class="bcount">${n}</span>
          <button class="bstep" data-bcard="${id}" data-bdelta="1" ${n >= cap ? 'disabled' : ''} title="${capped ? '有费卡（含需特定魔石召唤的魔石卡）每张最多 1 张' : '0 费免费卡每张最多 ' + CONFIG.ZERO_COST_MAX + ' 张'}">＋</button>
          ${capped ? '<span class="blimit" title="有费卡（含需特定魔石召唤的魔石卡）每张最多 1 张">限1</span>' : '<span class="blimit" title="0 费免费卡每张最多 ' + CONFIG.ZERO_COST_MAX + ' 张">最多' + CONFIG.ZERO_COST_MAX + '</span>'}
        </div>
      </div>`;
  }).join('');
  const hiddenLocked = faction.cards.length - visibleCards.length;
  const ok = total >= min && total <= max;
  el('builderCount').innerHTML = `卡组数量：<b class="${ok ? 'ok' : 'bad'}">${total}</b> （最少 ${min}，最多 ${max}）`
    + `<div class="brule-note">⚠ 规则：有费卡（含需特定魔石才能召唤的魔石法术卡）每张最多 1 张；0 费免费卡（含魔石生物）每张最多 ${CONFIG.ZERO_COST_MAX} 张。${hiddenLocked > 0 ? `（本阵营有 ${hiddenLocked} 张未解锁卡，仅在「我的收藏」中显示）` : ''}</div>`;
  const confirm = document.querySelector('[data-bact="builderConfirm"]');
  if (confirm) confirm.disabled = !ok;
}

// ============================================================================
// COLLECTION
// ============================================================================
export function renderCollection(ctx) {
  const { profile, faction } = ctx;
  const unlocked = new Set(profile.unlocked);
  const have = allCardIds().filter((id) => unlocked.has(id)).length;
  el('collProgress').innerHTML = `已解锁 ${have} / ${allCardIds().length} · <span class="cur-coins">✦ ${profile.coins}</span> <span class="cur-gems">💎 ${profile.gems || 0}</span>`;
  el('collTabs').innerHTML = FACTION_ORDER.map((k) => {
    const f = FACTIONS[k];
    return `<button class="ftab ${k === faction ? 'active' : ''}" data-ctab="${k}" style="--fc:${f.color}">${f.name}</button>`;
  }).join('');
  const f = FACTIONS[faction];
  el('collGrid').innerHTML = f.cards.map((id) => {
    const c = CARDS[id];
    const rk = rarityOf(id);
    const locked = !unlocked.has(id);
    const sig = (c.sigils || []).map((s) => `<span class="sig" title="${SIGILS[s] ? SIGILS[s].desc : ''}">${SIGILS[s] ? SIGILS[s].name : s}</span>`).join(' ');
    return `
      <div class="bcard coll rar-${rk} ${locked ? 'locked' : ''}" data-rarity="${rk}">
        <div class="rar-tag" style="--rc:${RARITY[rk].color}">${RARITY[rk].name}</div>
        ${locked ? '<div class="lock">🔒</div>' : ''}
        ${portraitHTML(id)}
        <div class="cname">${c.name}</div>
        ${miniCostHTML(c)}
        <div class="stats mini"><span class="atk">⚔${c.atk}</span><span class="hp">♥${c.hp}</span></div>
        <div class="sigils">${sig}</div>
      </div>`;
  }).join('');
  el('rarityLegend').innerHTML = RARITY_ORDER.map((k) => `<span class="rl" style="--rc:${RARITY[k].color}"><i></i>${RARITY[k].name}</span>`).join('');
}

// ============================================================================
// SHOP / GACHA — 三标签页：卡牌包 / 直购 / 充值
// ============================================================================
export function renderShop(ctx) {
  const { profile, tab } = ctx;
  // 更新货币显示
  el('shopCoins').innerHTML = `<span class="cur-coins">✦ ${profile.coins}</span> <span class="cur-gems">💎 ${profile.gems || 0}</span>`;

  // 标签高亮
  document.querySelectorAll('#collGachaView .shop-tab').forEach((b) => {
    b.classList.toggle('on', b.dataset.stab === (tab || 'packs'));
  });

  // 切换面板
  el('shopPacksPanel').classList.toggle('hidden', (tab || 'packs') !== 'packs');
  el('shopDirectPanel').classList.toggle('hidden', tab !== 'direct');
  el('shopRechargePanel').classList.toggle('hidden', tab !== 'recharge');

  if (!tab || tab === 'packs') renderShopPacks(profile);
  else if (tab === 'direct') renderShopDirect(profile);
  else if (tab === 'recharge') renderShopRecharge(profile);

  el('packResult')?.classList.add('hidden');
}

// --- 标签 1: 卡牌包（普通包 + 暗夜包） ---
function renderShopPacks(profile) {
  // 普通包
  el('packCost').textContent = `✦ ${PACK.cost}`;
  const drawBtn = el('drawBtn');
  if (drawBtn) { drawBtn.disabled = profile.coins < PACK.cost; drawBtn.textContent = profile.coins < PACK.cost ? '金币不足' : `✦ 开一包（-${PACK.cost}）`; }
  el('odds').innerHTML = '<div class="pack-title-row"><span class="ptag gold">普通包</span></div>掉率：' + RARITY_ORDER.filter((k) => RARITY[k].weight > 0).map((k) => `<span class="rl" style="--rc:${RARITY[k].color}"><i></i>${RARITY[k].name} ${RARITY[k].weight}%</span>`).join(' ')
    + '<div class="shop-hint">图鉴未集齐前抽取的必定是新卡；集齐后重复将按稀有度返还金币。神话卡仅限暗夜包/直购获取。</div>';

  // 暗夜包
  el('gemPackCost').textContent = `💎 ${GEM_PACK.cost}`;
  const gemDrawBtn = el('gemDrawBtn');
  if (gemDrawBtn) { gemDrawBtn.disabled = (profile.gems || 0) < GEM_PACK.cost; gemDrawBtn.textContent = (profile.gems || 0) < GEM_PACK.cost ? '魂晶不足' : `💎 开暗夜包（-${GEM_PACK.cost}）`; }
  el('gemOdds').innerHTML = '<div class="pack-title-row"><span class="ptag purple">暗夜包</span></div>掉率：' + RARITY_ORDER.map((k) => {
    const w = GEM_PACK.weights[k] || 0;
    if (w === 0) return '';
    return `<span class="rl" style="--rc:${RARITY[k].color}"><i></i>${RARITY[k].name} ${w}%</span>`;
  }).filter(Boolean).join(' ')
    + '<div class="shop-hint">保底稀有以上！史诗/传说概率大幅提升，更有 4% 概率掉落神话卡。图鉴未集齐前不重复。</div>';
}

// --- 标签 2: 直购商店 ---
function renderShopDirect(profile) {
  const owned = new Set(profile.unlocked);
  el('shopDirectInfo').innerHTML = `用 💎 魂晶直接购买指定卡牌（跳过随机）。<span class="cur-gems">当前 💎 ${profile.gems || 0}</span>`;
  el('shopDirectGrid').innerHTML = allCardIds().map((id) => {
    const c = CARDS[id];
    const rk = rarityOf(id);
    const price = CARD_SHOP_PRICES[rk];
    const isOwned = owned.has(id);
    const canBuy = !isOwned && (profile.gems || 0) >= price;
    const sig = (c.sigils || []).map((s) => `<span class="sig" title="${SIGILS[s] ? SIGILS[s].desc : ''}">${SIGILS[s] ? SIGILS[s].name : s}</span>`).join(' ');
    return `
      <div class="bcard coll rar-${rk} ${isOwned ? 'owned' : ''}" data-rarity="${rk}">
        <div class="rar-tag" style="--rc:${RARITY[rk].color}">${RARITY[rk].name}</div>
        ${isOwned ? '<div class="lock owned-mark">✓</div>' : ''}
        ${portraitHTML(id)}
        <div class="cname">${c.name}</div>
        ${miniCostHTML(c)}
        <div class="stats mini"><span class="atk">⚔${c.atk}</span><span class="hp">♥${c.hp}</span></div>
        <div class="sigils">${sig}</div>
        ${isOwned ? '' : `<button class="btn small ${canBuy ? 'primary' : 'disabled'} buy-card-btn" data-buy="${id}" data-price="${price}" ${canBuy ? '' : 'disabled'}>💎 ${price}</button>`}
      </div>`;
  }).join('');
}

// --- 标签 3: 充值 ---
function renderShopRecharge(profile) {
  el('shopRechargeInfo').innerHTML = `魂晶是充值获得的付费货币，可用于暗夜卡包、直购卡牌、兑换金币。<br><span class="cur-gems">当前 💎 ${profile.gems || 0}</span>`;

  el('rechargeGrid').innerHTML = RECHARGE_PACKAGES.map((pkg) => {
    const total = pkg.gems + (pkg.bonus || 0);
    const bonusTag = pkg.bonus > 0 ? `<span class="rc-bonus">+${pkg.bonus} 赠送</span>` : '';
    return `
      <div class="rc-card" data-rc="${pkg.id}">
        <div class="rc-label">${pkg.label}</div>
        <div class="rc-amount">💎 ${total}</div>
        ${bonusTag}
        <div class="rc-price">¥${pkg.price}</div>
        <button class="btn small primary rc-btn" data-recharge="${pkg.id}">充值</button>
      </div>`;
  }).join('');

  // 兑换区
  el('exchangeArea').innerHTML = `
    <div class="exchange-box">
      <div class="ex-title">魂晶 → 金币</div>
      <div class="ex-rate">汇率：1 💎 = ${GEM_EXCHANGE.rate} ✦</div>
      <div class="ex-input-row">
        <input type="number" id="exAmount" min="${GEM_EXCHANGE.minGems}" value="1" class="ex-input" />
        <span class="ex-arrow">→</span>
        <span class="ex-result" id="exResult">${GEM_EXCHANGE.rate} ✦</span>
      </div>
      <button class="btn small" data-act="exchange">兑换</button>
    </div>`;
}

// Play the pack-open animation and reveal a card.
export function playPackOpen(result, onDone) {
  const isGem = !!result.premium;
  const pack = isGem ? el('gemPack') : el('pack');
  const res = el('packResult');
  if (pack) pack.classList.add('shake');
  setTimeout(() => {
    if (pack) pack.classList.remove('shake');
    const c = CARDS[result.id];
    const rk = result.rarity;
    const sig = (c.sigils || []).map((s) => `<span class="sig">${SIGILS[s] ? SIGILS[s].name : s}</span>`).join(' ');
    res.className = `pack-result reveal rar-${rk} ${isGem ? 'gem-reveal' : ''}`;
    res.innerHTML = `
      <div class="reveal-rarity" style="color:${RARITY[rk].color}">${isGem ? '💎 ' : ''}${RARITY[rk].name}${result.dup ? ' · 重复' : ' · 新卡!'}</div>
      <div class="bcard big rar-${rk}" data-rarity="${rk}">
        ${portraitHTML(result.id)}
        <div class="cname">${c.name}</div>
        ${miniCostHTML(c)}
        <div class="stats mini"><span class="atk">⚔${c.atk}</span><span class="hp">♥${c.hp}</span></div>
        <div class="sigils">${sig}</div>
      </div>
      <div class="reveal-note">${result.dup ? `已拥有，转化为 +${result.dust} 金币` : '已加入你的收藏！'}</div>`;
    res.classList.remove('hidden');
    // celebratory burst colored by rarity
    const r = res.getBoundingClientRect();
    const burstCount = rk === 'mythic' ? 44 : rk === 'legend' ? 34 : rk === 'epic' ? 24 : 16;
    const burstColors = rk === 'mythic' ? ['#ff3366', '#ffd15a', '#ffffff', '#a95ad0'] : [RARITY[rk].color, '#ffffff'];
    burst(r.left + r.width / 2, r.top + r.height / 2, {
      count: burstCount, color: burstColors, glyph: '✦', size: 13, spread: 130, grav: 20, life: 1100, glow: 12,
    });
    if (onDone) onDone();
  }, 620);
}

// ============================================================================
// CUSTOM RULES PANEL (shown in the deck builder for single / host modes)
// ============================================================================
const RULE_LABELS = { winMode: '🎯 胜利方式', winScale: '🏁 胜利目标', lanes: '🃞 场地大小', drawPerTurn: '🂠 抽卡数/轮', deckScope: '🗃 卡组限定' };
function ruleOptionLabel(key, v) {
  if (key === 'winMode') return v === 'absolute' ? '累计分数' : '分数差';
  if (key === 'lanes') return `${v} 列`;
  if (key === 'winScale') return `${v} 分`;
  if (key === 'drawPerTurn') return `${v} 张`;
  return SCOPE_NAMES[v] || v;
}

export function renderRulesPanel(rules) {
  const panel = el('rulesPanel'); if (!panel) return;
  const r = normalizeRules(rules);
  panel.innerHTML =
    '<div class="rules-title">⚙ 房间规则（房主设定，双方生效）</div>' +
    Object.keys(RULE_LABELS).map((key) => {
      let opts;
      if (key === 'winScale') {
        // 累计分数模式提供更高的预设目标，并额外允许自由输入任意整数。
        const list = winScaleOptions(r.winMode);
        const presetBtns = list.map((v) =>
          `<button type="button" class="rbtn ${String(r.winScale) === String(v) ? 'on' : ''}" data-rule="winScale" data-rval="${v}">${v} 分</button>`
        ).join('');
        const isCustom = !list.includes(r.winScale);
        const custom = `<input type="number" min="1" max="${WIN_SCALE_CAP}" step="1" class="rinput ${isCustom ? 'on' : ''}" data-rinput="winScale" value="${r.winScale}" title="自定义胜利目标（累计分数模式可设为很高，如 30 / 50 / 100）" />`;
        opts = presetBtns + '<span class="rule-divider">或</span>' + custom;
      } else {
        opts = RULE_OPTIONS[key].map((v) =>
          `<button type="button" class="rbtn ${String(r[key]) === String(v) ? 'on' : ''}" data-rule="${key}" data-rval="${v}">${ruleOptionLabel(key, v)}</button>`
        ).join('');
      }
      let note = '';
      if (key === 'winMode') note = `<div class="rule-desc">${winModeDesc(r.winMode)}</div>`;
      else if (key === 'winScale') note = `<div class="rule-desc">${r.winMode === 'absolute' ? `累计分数模式下目标可自定义到很高（最高 ${WIN_SCALE_CAP} 分）。` : '分数差模式的合理区间较小，预设已覆盖常用值。'}</div>`;
      return `<div class="rule-row"><span class="rule-name">${RULE_LABELS[key]}</span><span class="rule-opts">${opts}</span></div>${note}`;
    }).join('') +
    `<div class="rules-note">当前：${rulesSummary(r)}</div>`;
  panel.classList.remove('hidden');
}
export function hideRulesPanel() { const p = el('rulesPanel'); if (p) p.classList.add('hidden'); }
// Plain-text summary of rules (used in read-only panels where only a string is needed).
export function rulesSummaryText(rules) { return rulesSummary(normalizeRules(rules)); }

// ============================================================================
// ONLINE LOBBY OVERLAY  (PeerJS room code / manual offer-answer exchange)
// ============================================================================
export function showOnlineLobby({ role, manual }) {
  const box = el('onlineLobby');
  if (!box) return;
  box.dataset.role = role || '';
  box.dataset.manual = manual ? '1' : '0';
  box.classList.remove('hidden');
  el('lobbyBody').innerHTML = '';
  setLobbyStatus(manual ? '正在准备邀请码…' : '正在建立连接…');
}
export function hideOnlineLobby() { const b = el('onlineLobby'); if (b) b.classList.add('hidden'); }
export function setLobbyStatus(txt) { const s = el('lobbyStatus'); if (s) s.textContent = txt; }

// Host: show the shareable code/link (PeerJS room code OR manual offer string).
export function showLobbyOffer({ manual, roomCode, offer, link }) {
  const body = el('lobbyBody'); if (!body) return;
  if (manual) {
    body.innerHTML = `
      <div class="lobby-step">① 把下面「邀请码」发给好友（或复制邀请链接）：</div>
      <textarea id="lobbyOfferOut" class="lobby-code" readonly>${offer || ''}</textarea>
      <div class="lobby-actions">
        <button class="btn small" data-ol="copyOffer">复制邀请码</button>
        <button class="btn small" data-ol="copyLink">复制邀请链接</button>
      </div>
      <div class="lobby-step">② 好友回传「回执码」后，粘贴到此处完成连接：</div>
      <textarea id="lobbyAnswerIn" class="lobby-code" placeholder="在此粘贴好友发来的回执码"></textarea>
      <div class="lobby-actions">
        <button class="btn small primary" data-ol="pasteAnswer">完成连接</button>
      </div>`;
  } else {
    body.innerHTML = `
      <div class="lobby-step">① 把这个「房间号」告诉好友：</div>
      <div class="lobby-room" id="lobbyRoomCode">${roomCode || ''}</div>
      <div class="lobby-actions">
        <button class="btn small" data-ol="copyLink">复制邀请链接</button>
      </div>
      <div class="lobby-step">② 好友打开链接或输入房间号即可加入。也可改用「邀请码」模式摆脱对信令服务器的依赖：</div>
      <div class="lobby-actions">
        <button class="btn small ghost" data-ol="switchManual">改用邀请码模式</button>
        <button class="btn small ghost" data-ol="lobbyCancel">取消</button>
      </div>`;
  }
  if (link) { /* link is shown via copy button */ }
  setLobbyStatus(manual ? '等待好友回传回执码…' : '等待好友加入…');
}

// Guest (manual mode): show the answer code to send back to the host.
export function showLobbyAnswer(answer) {
  const body = el('lobbyBody'); if (!body) return;
  const existing = body.querySelector('#lobbyAnswerOut');
  if (existing) { existing.value = answer || ''; return; }
  body.innerHTML = `
    <div class="lobby-step">① 已生成「回执码」，复制发给房主：</div>
    <textarea id="lobbyAnswerOut" class="lobby-code" readonly>${answer || ''}</textarea>
    <div class="lobby-actions">
      <button class="btn small" data-ol="copyAnswer">复制回执码</button>
      <button class="btn small ghost" data-ol="lobbyCancel">取消</button>
    </div>
    <div class="lobby-step">② 房主粘贴后，你们即可开始对局。</div>`;
}

// ============================================================================
// RANK EMBLEMS — 每个阶数一个独立的图像标志（非「数字+圈」）
// 形状随阶数递进：①箭簇 ②交叉双剑 ③盾牌 ④星 ⑤皇冠 ⑥钻石，颜色见 TIER_COLORS
// ============================================================================
const RANK_EMBLEMS = {
  // 一阶 · 青铜（灰）：单刃箭簇
  1: '<path d="M32 12 L50 46 L37 46 L37 54 L27 54 L27 46 L14 46 Z"/>',
  // 二阶 · 铜：交叉双剑
  2: '<g><rect x="28.4" y="12" width="7.2" height="40" rx="3.4" transform="rotate(45 32 32)"/>'
    + '<rect x="28.4" y="12" width="7.2" height="40" rx="3.4" transform="rotate(-45 32 32)"/>'
    + '<circle cx="32" cy="32" r="5" fill="#1c1710"/></g>',
  // 三阶 · 银：盾牌（带白色对勾）
  3: '<path d="M32 11 L51 20 V34 C51 47 42 53 32 55 C22 53 13 47 13 34 V20 Z"/>'
    + '<path d="M23 31 L29 37.5 L42 22" fill="none" stroke="#1c1710" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  // 四阶 · 金：五角星
  4: '<path d="M32 10 L38.4 25.4 L54.6 27.3 L42.4 38.4 L46.2 54.6 L32 45.4 L17.8 54.6 L21.6 38.4 L9.4 27.3 L25.6 25.4 Z"/>',
  // 五阶 · 青：皇冠
  5: '<path d="M12 46 L12 22 L22.5 33 L32 14 L41.5 33 L52 22 L52 46 Z"/>'
    + '<rect x="12" y="46" width="40" height="6.5" rx="2.5"/>'
    + '<circle cx="12" cy="20" r="3.2" fill="#1c1710"/><circle cx="32" cy="12" r="3.2" fill="#1c1710"/><circle cx="52" cy="20" r="3.2" fill="#1c1710"/>',
  // 六阶 · 蓝：切割钻石（顶级）
  6: '<path d="M18 18 H46 L57 32 L32 56 L7 32 Z"/>'
    + '<path d="M18 18 L32 32 L46 18 M7 32 H57 M32 32 V56" fill="none" stroke="#1c1710" stroke-width="2.6" stroke-linejoin="round" opacity=".82"/>',
};
export function rankSvg(tier) {
  tier = Math.min(RANK.TIERS, Math.max(1, tier || 1));
  const inner = RANK_EMBLEMS[tier] || RANK_EMBLEMS[1];
  return `<svg viewBox="0 0 64 64" class="rk-emblem" role="img" aria-label="${RANK.TIER_NAMES[tier]}徽章">${inner}</svg>`;
}

// ============================================================================
// TOP CHIP (profile summary on menu)
// ============================================================================
export function renderTopChip(profile) {
  const chip = el('topchip');
  if (!chip) return;
  const rk = profile.rank || { tier: 1, div: 0, points: 0 };
  const rkColor = rankColor(rk.tier);
  chip.innerHTML = `<span class="tc-avatar">${profile.avatar || '🜁'}</span><span class="tc-name">${profile.name}</span>`
    + `<span class="tc-rank" style="--tier:${rkColor}">${rankSvg(rk.tier)}<b>${RANK.DIVISIONS[rk.div]}</b></span>`
    + `<span class="tc-coin">✦ ${profile.coins}</span><span class="tc-gem">💎 ${profile.gems || 0}</span><span class="tc-stat">胜 ${profile.stats.wins} · 负 ${profile.stats.losses}</span>`;
}

// 排位赛界面：渲染当前段位徽章、晋级进度条与战绩。
export function renderRanked(profile) {
  const rk = profile.rank || { tier: 1, div: 0, points: 0 };
  const color = rankColor(rk.tier);
  const badge = el('rankBadge');
  if (badge) {
    badge.style.setProperty('--tier', color);
    badge.innerHTML = `<div class="rb-medal">${rankSvg(rk.tier)}</div><div class="rb-div">${RANK.TIER_NAMES[rk.tier]}·${RANK.DIVISIONS[rk.div]}</div>`;
  }
  const bar = el('rankBar');
  if (bar) {
    bar.style.width = Math.min(100, (rk.points / RANK.DIV_PROMOTE) * 100) + '%';
    bar.style.background = color;
  }
  const lbl = el('rankBarLabel');
  if (lbl) lbl.textContent = `晋级分 ${rk.points} / ${RANK.DIV_PROMOTE}`;
  const stats = el('rankedStats');
  if (stats) {
    const top = isTopRank(rk);
    stats.textContent = `排位战绩：胜 ${profile.stats.rankedWins || 0} · 负 ${profile.stats.rankedLosses || 0}`
      + (top ? ' · 已登顶六阶·上！' : '');
  }
}

// ============================================================================
// TUTORIAL SETUP (pick faction + content modules)
// ============================================================================
export const TUT_MODULES = [
  { id: 'goal', name: '目标与天平', core: true },
  { id: 'play', name: '出牌与献祭' },
  { id: 'attack', name: '攻击与天平' },
  { id: 'sigils', name: '印记特性' },
  { id: 'faction', name: '阵营玩法' },
  { id: 'modes', name: '模式与胜负' },
];

export function renderTutSetup(ctx) {
  const { faction, modules, factions } = ctx;
  const fTabs = el('tutFactions'); if (fTabs) {
    fTabs.innerHTML = Object.keys(factions).map((k) => {
      const f = factions[k];
      return `<button class="ftab ${k === faction ? 'active' : ''}" data-tf="${k}" style="--fc:${f.color}">${f.name}</button>`;
    }).join('');
  }
  const mWrap = el('tutModules'); if (mWrap) {
    mWrap.innerHTML = TUT_MODULES.map((m) => {
      const on = modules.has(m.id);
      return `<button class="tchip ${on ? 'on' : ''}" data-tm="${m.id}">${m.name}${m.core ? ' ★' : ''}</button>`;
    }).join('');
  }
}

export function renderHowTo(html) {
  const b = el('howtoBody'); if (b) b.innerHTML = html;
}

// 更新日志（产品内可见）。数据来自 constants.js 的 CHANGELOG（最新在前）。
export function renderChangelog(html) {
  const b = el('changelogBody'); if (b) b.innerHTML = html;
}
export function changelogHTML() {
  const entries = (Array.isArray(CHANGELOG) ? CHANGELOG : []).map((e) => {
    const items = (e.items || []).map((it) => `<li>${it}</li>`).join('');
    return `<div class="cl-entry">
      <div class="cl-head">
        <span class="cl-ver">${e.version || ''}</span>
        <span class="cl-date">${e.date || ''}</span>
        <span class="cl-title">${e.title || ''}</span>
      </div>
      <ul class="cl-items">${items}</ul>
    </div>`;
  }).join('');
  return `<div class="changelog-body">${entries}</div>`;
}

// Full "玩法说明" page: four play modes + two victory conditions + four factions.
// Built here (not in main.js) so the bulky copy stays out of the controller.
export function howToHTML() {
  const factionCard = (k) => {
    const f = FACTIONS[k];
    return `<div class="ht-faction" style="--fc:${f.color}">
      <div class="ht-fh"><span class="ht-dot" style="background:${f.color}"></span>${f.name}</div>
      <div class="ht-fd">${f.desc}</div>
      <div class="ht-fres">资源：${k === 'blood' ? '每回合 1 点血肉（不攒、重置）+ 献祭场上单位支付更高费' : k === 'bone' ? '生物死亡掉落骸骨（每只 +1）＋每回合极轻墓地滴流（约 0.75，攒满 1 才 +1）' : k === 'energy' ? '每回合回能（封顶 6，整回满）' : '场上魔石生物提供魔石（不消耗，但死亡即失）'}</div>
    </div>`;
  };
  const sigRows = Object.keys(SIGILS).map((s) =>
    `<div class="ht-sig"><span class="ht-sig-name">${SIGILS[s].name}</span><span class="ht-sig-desc">${SIGILS[s].desc}</span></div>`
  ).join('');
  const modeRows = [
    ['⚔ 单机模式', '对战电脑 AI。可先选阵营、组卡、设规则，适合熟悉机制与练手。'],
    ['🖥 本地双人', '同一台电脑上两名玩家轮流操作（同屏），每次回合交接会隐藏手牌防偷看。'],
    ['🏠 本地联机', '同一局域网内（如连同一个 Wi-Fi/路由器）创建房间或输入房间号加入，实时对战。'],
    ['🌍 线上联机', '跨网络 P2P 直连：可凭房号直连，或用「邀请码 / 邀请链接」摆脱对信令服务器的依赖。'],
  ].map(([t, d]) => `<div class="ht-mode"><div class="ht-mode-t">${t}</div><div class="ht-mode-d">${d}</div></div>`).join('');

  return `
  <div class="ht-section">
    <h3 class="ht-h">一、四种对战模式</h3>
    <div class="ht-modes">${modeRows}</div>
  </div>

  <div class="ht-section">
    <h3 class="ht-h">二、两种胜利条件</h3>
    <p class="ht-p">天平在屏幕顶部：把指针压到己方「你胜」一端即获胜。胜负判定有两种方式，可在建房 / 单机的<span class="ht-k">规则面板</span>里自选，目标分也可自定义：</p>
    <div class="ht-win">
      <div class="ht-win-row"><span class="ht-win-name">分数差</span><span class="ht-win-def">${winModeDesc('difference')} 默认目标 <b>${defaultWinScaleFor('difference')}</b> 分。</span></div>
      <div class="ht-win-row"><span class="ht-win-name">累计分数</span><span class="ht-win-def">${winModeDesc('absolute')} 默认目标 <b>${defaultWinScaleFor('absolute')}</b> 分。</span></div>
    </div>
    <p class="ht-p ht-note">⚖ 先手方（房主 / 你）开局天平 −1，作为先手优势的平衡修正。</p>
  </div>

  <div class="ht-section">
    <h3 class="ht-h">三、四大阵营</h3>
    <p class="ht-p">不同阵营的「资源」与核心机制各不相同，可在新手教程里逐一对练：</p>
    <div class="ht-factions">${['blood', 'bone', 'energy', 'mox', 'sand'].map(factionCard).join('')}</div>
  </div>

  <div class="ht-section">
    <h3 class="ht-h">四、印记特性速览</h3>
    <div class="ht-sigs">${sigRows}</div>
  </div>

  <div class="ht-section">
    <h3 class="ht-h">五、基本流程</h3>
    <p class="ht-p">① 选阵营、组卡、定规则 → ② 每回合用资源召唤生物到场地（默认 4 列）→ ③ 点「结束回合 / 攻击」让你的生物出击：同列有敌则交战，否则直击对方天平加分 → ④ 先把天平压满者获胜。血肉阵营打有费牌时，需先献祭场上已召唤的单位来支付。</p>
  </div>

  ${keyBindsHTML()}
  `;
}

// 键盘操作说明：从 keybinds 读取「当前生效」绑定（含用户自定义），动态渲染。
function keyBindsHTML() {
  const b = getBinds();
  const bindStr = (ctx, action) => (b[ctx][action] || []).map(fmtBind).join(' / ');
  const rows = (ctx, pairs) => pairs.map(([acts, label]) =>
    `<div class="ht-kb-row"><div class="ht-kb-keys">${acts.map((a) => `<kbd>${bindStr(ctx, a)}</kbd>`).join(' ')}</div><div class="ht-kb-desc">${label}</div></div>`
  ).join('');
  const battle = rows('battle', [
    [['select'], '选牌 / 在光标列放牌'],
    [['cursorLeft', 'cursorRight'], '移动光标（未选牌时移手牌，选牌后移列）'],
    [['endTurn'], '结束回合（选牌时改为在该列打出）'],
    [['lane1', 'lane2', 'lane3', 'lane4'], '在指定列（1-4）出牌'],
    [['cancel'], '取消选择'],
    [['surrender'], '投降（认输）'],
    [['peace'], '求和（申请平局，每局限 1 次）'],
    [['emote1', 'emote2', 'emote3', 'emote4', 'emote5', 'emote6'], '发送表情 👍😂😡🙏🔥💀'],
  ]);
  const builder = rows('builder', [
    [['cursorUp', 'cursorDown', 'cursorLeft', 'cursorRight'], '移动卡牌焦点（WASD）'],
    [['add1', 'sub1'], '该卡 +1 / −1'],
    [['add5', 'sub5'], '该卡 +5 / −5（选卡组快捷）'],
    [['confirm'], '确定并开始'],
    [['cancel'], '返回'],
  ]);
  return `
  <div class="ht-section">
    <h3 class="ht-h">六、键盘操作（可自定义）</h3>
    <p class="ht-p">全面支持键盘操作，并以 <b>WASD</b> 为主轴。所有键位均可在主菜单「⚙ 键位设置」里自由改键（支持 Shift/Ctrl/Alt 组合键）。下表为<span class="ht-k">当前生效</span>的绑定：</p>
    <div class="ht-kb-group"><div class="ht-kb-gtitle">⚔ 对战界面</div>${battle}</div>
    <div class="ht-kb-group"><div class="ht-kb-gtitle">🛠 组卡界面</div>${builder}</div>
    <p class="ht-p ht-note">提示：在组卡界面输入框打字时游戏快捷键不触发；按任意键即可在设置里重绑，Esc 取消本次重绑。</p>
  </div>`;
}
