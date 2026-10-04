// 战役层：多章节推进 / 地图遭遇 / Roguelike 本局重开 / 通关记录
// 纯逻辑、无 DOM 依赖，Node 与浏览器共用。所有随机走可复现 PRNG（联机权威需要）。

import {
  PIECES, SIGILS, SIGIL_IDS, EVENTS, RELICS, RELIC_IDS,
  LOOT_KINDS, RECRUIT_POOL, PROMOTE_CHOICES, BATTLE, TUNING,
} from './constants.js';
import { CHAPTERS } from './chapters.js';
import { createBattle, applyAction, livingUnits, makeRng, unitAt } from './engine.js';

// ------------------------------------------------------------------ 随机
function roll(state) {
  state.rngState = (state.rngState + 1) >>> 0;
  return makeRng((state.seed ^ (state.chapterIndex * 7919) ^ (state.rngState * 2654435761)) >>> 0)();
}
function pick(state, arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(roll(state) * arr.length) % arr.length];
}
function shuffled(state, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(roll(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const key = (f, r) => `${f},${r}`;

// ------------------------------------------------------------------ 名册
let rosterSeq = 0;
function makeRosterUnit(type, opts = {}) {
  const base = PIECES[type] || PIECES.pawn;
  rosterSeq += 1;
  return {
    id: opts.id || `pc${rosterSeq}`,
    type,
    name: opts.name || base.name,
    atk: opts.atk != null ? opts.atk : base.atk,
    hp: opts.hp != null ? opts.hp : base.hp,
    maxHp: opts.maxHp != null ? opts.maxHp : base.hp,
    sigils: opts.sigils ? [...opts.sigils] : [],
  };
}

// ------------------------------------------------------------------ 建局
export function createRun({ seed = Date.now(), coop = false, chapterIndex = 0 } = {}) {
  const state = {
    seed: seed >>> 0,
    rngState: 0,
    coop,
    chapterIndex: clamp(chapterIndex, 0, CHAPTERS.length - 1),
    roster: [],
    fallen: [],
    relics: [],
    pos: [0, 0],
    candles: 0,
    candlesMax: 0,
    steps: 0,
    tiles: {},
    phase: 'map',
    pending: null,
    battle: null,
    over: null,
    log: [],
    stats: { battles: 0, elites: 0, fallen: 0, chaptersCleared: 0 },
  };
  // 第一章按章节自带队伍开局；后续章节继承上一章队伍
  const firstParty = CHAPTERS[state.chapterIndex].party || ['pawn', 'pawn', 'knight'];
  state.roster = firstParty.map((t) => makeRosterUnit(t));
  enterChapter(state, state.chapterIndex, true);
  return state;
}

function pushLog(state, text) {
  state.log.push(text);
  if (state.log.length > 300) state.log.shift();
}

export function currentChapter(state) {
  return CHAPTERS[state.chapterIndex];
}

/** 进入（或重开到）某一章：重置地图与蜡烛，队伍回满，遗物保留 */
export function enterChapter(state, idx, isFirst = false) {
  state.chapterIndex = clamp(idx, 0, CHAPTERS.length - 1);
  const ch = currentChapter(state);
  state.pos = [...ch.start];
  state.candlesMax = ch.candles + (TUNING.candleBonus || 0);
  state.candles = state.candlesMax;
  state.steps = 0;
  state.tiles = generateMap(state, ch);
  state.phase = 'map';
  state.pending = null;
  state.battle = null;
  state.over = null;
  // 进入新的一章：阵亡者归队（满血），是 Roguelike 的「下一幕重置」
  if (!isFirst && state.fallen.length) {
    for (const u of state.fallen) { u.hp = u.maxHp; state.roster.push(u); }
    state.fallen = [];
    pushLog(state, '新的一章：阵亡的棋子重新站回了棋盘上。');
  }
  // 队伍回满（阵亡者已归队）
  for (const u of state.roster) u.hp = u.maxHp;
  if (!isFirst) state.stats.chaptersCleared += 1;
  pushLog(state, `【${ch.title}】开始 —— ${ch.theme.name}，蜡烛 ${state.candles} 支`);
  return state;
}

// ------------------------------------------------------------------ 地图生成
function generateMap(state, ch) {
  const tiles = {};
  const size = ch.board;
  for (let f = 0; f < size; f++) {
    for (let r = 0; r < size; r++) {
      tiles[key(f, r)] = { kind: 'empty', seen: false, cleared: false };
    }
  }
  tiles[key(...ch.start)] = { kind: 'start', seen: true, cleared: true };
  tiles[key(...ch.throne)] = { kind: 'boss', seen: true, cleared: false };

  const counts = ch.tiles || { battle: 8, elite: 2, promote: 2, rest: 3, event: 6 };
  const bag = [];
  for (let i = 0; i < (counts.battle || 0); i++) bag.push('battle');
  for (let i = 0; i < (counts.elite || 0); i++) bag.push('elite');
  for (let i = 0; i < (counts.promote || 0); i++) bag.push('promote');
  for (let i = 0; i < (counts.rest || 0); i++) bag.push('rest');
  for (let i = 0; i < (counts.event || 0); i++) bag.push('event');

  const spots = [];
  for (let f = 0; f < size; f++) {
    for (let r = 0; r < size; r++) {
      const k = key(f, r);
      if (k === key(...ch.start) || k === key(...ch.throne)) continue;
      spots.push([f, r]);
    }
  }
  const order = shuffled(state, spots);
  const eventPool = [...(ch.events || []), ...EVENTS];
  bag.forEach((kind, i) => {
    const [f, r] = order[i];
    if (![f, r]) return;
    const t = { kind, seen: false, cleared: false };
    if (kind === 'event') {
      const ev = pick(state, eventPool);
      t.eventId = ev ? ev.id : null;
    }
    tiles[key(f, r)] = t;
  });
  // 地图开局即明示格子类型（可规划路线；随机性交给编成/事件/战利品）
  for (const k of Object.keys(tiles)) tiles[k].seen = true;
  return tiles;
}

/** 王可走的相邻格（八方一格） */
export function legalKingMoves(state) {
  const size = currentChapter(state).board;
  const [f, r] = state.pos;
  const out = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const nf = f + df, nr = r + dr;
      if (nf < 0 || nf >= size || nr < 0 || nr >= size) continue;
      out.push([nf, nr]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ 移动与遭遇
export function moveKing(state, to) {
  if (state.over) return { ok: false, error: '本局已结束' };
  if (state.phase !== 'map') return { ok: false, error: '当前不在地图上' };
  const legal = legalKingMoves(state).some(([f, r]) => f === to[0] && r === to[1]);
  if (!legal) return { ok: false, error: '王只能走相邻一格' };

  const ch = currentChapter(state);
  state.pos = [to[0], to[1]];
  state.steps += 1;
  state.candles -= 1;
  const tile = state.tiles[key(to[0], to[1])];
  tile.seen = true;
  pushLog(state, `王行至 ${sq(to)}（蜡烛 -1，余 ${state.candles}）`);

  const isFight = tile.kind === 'battle' || tile.kind === 'elite' || tile.kind === 'boss';
  if (isFight && (ch.modifiers?.battleCandleCost || 0) > 0) {
    state.candles -= ch.modifiers.battleCandleCost;
    pushLog(state, `本章规则：开战额外消耗 ${ch.modifiers.battleCandleCost} 支蜡烛`);
  }

  if (state.candles <= 0 && tile.kind !== 'boss') {
    state.candles = 0;
    finishRun(state, 'dead', ch.outOfCandles || '蜡烛燃尽。', 'candles');
    return { ok: true, encounter: 'dead' };
  }

  switch (tile.kind) {
    case 'empty':
      tile.cleared = true;
      pushLog(state, '这一格空无一物，只有灰。');
      return { ok: true, encounter: 'empty' };
    case 'battle':
    case 'elite':
      startBattle(state, tile.kind);
      return { ok: true, encounter: tile.kind };
    case 'boss':
      pushLog(state, ch.throneIntro || '');
      startBattle(state, 'boss');
      return { ok: true, encounter: 'boss' };
    case 'promote':
      state.phase = 'promote';
      state.pending = { kind: 'promote' };
      pushLog(state, '升变之所：一枚兵可以成为别的什么。');
      return { ok: true, encounter: 'promote' };
    case 'rest':
      state.phase = 'rest';
      state.pending = { kind: 'rest' };
      pushLog(state, '休整之所：你可以疗伤，也可以唤回一名旧部。');
      return { ok: true, encounter: 'rest' };
    case 'event': {
      const ev = [...(ch.events || []), ...EVENTS].find((e) => e.id === tile.eventId) || pick(state, EVENTS);
      state.phase = 'event';
      state.pending = { kind: 'event', event: ev };
      pushLog(state, `异象：${ev.title}`);
      return { ok: true, encounter: 'event' };
    }
    default:
      tile.cleared = true;
      return { ok: true, encounter: 'empty' };
  }
}

function sq([f, r]) {
  return `${String.fromCharCode(97 + f)}${r + 1}`;
}

// ------------------------------------------------------------------ 战斗
function buildSquad(state, kind) {
  const ch = currentChapter(state);
  if (kind === 'boss') {
    return { list: ch.boss.map((t) => ({ type: t })), sigils: ch.bossSigils || {} };
  }
  const tierIdx = clamp(Math.floor(state.steps / 5), 0, (ch.tiers?.length || 1) - 1);
  const pool = kind === 'elite' ? (ch.elitePool || ch.tiers?.[tierIdx] || [['pawn', 'pawn']]) : (ch.tiers?.[tierIdx] || [['pawn', 'pawn']]);
  const base = pool[Math.floor(roll(state) * pool.length) % pool.length] || ['pawn', 'pawn'];
  // 普通战与精英战都比队伍少 1 子（玩家靠人数优势换天平竞速）；精英棋子更强且带印记
  const maxSize = kind === 'elite' ? 4 : 4;
  const minSize = kind === 'elite' ? 2 : 2;
  const size = clamp(state.roster.length - 1, minSize, maxSize);
  const list = [];
  for (let i = 0; i < size; i++) list.push({ type: base[i % base.length] });
  // 精英：随推进给部分敌子附加印记
  const sigils = {};
  if (kind === 'elite') {
    for (const spec of list) {
      if (roll(state) < 0.35 + tierIdx * 0.1) {
        spec.sigils = [pick(state, SIGIL_IDS)];
      }
    }
    if (tierIdx >= 2 && roll(state) < 0.5) list.push({ type: 'rook' });
  }
  return { list, sigils };
}

export function startBattle(state, kind) {
  const ch = currentChapter(state);
  const { list, sigils } = buildSquad(state, kind);
  const party = state.roster.map((u) => ({
    id: u.id, rid: u.id, type: u.type, name: u.name,
    atk: u.atk, hp: u.hp, maxHp: u.maxHp, sigils: [...u.sigils],
  }));
  const enemyRank = BATTLE.RANKS - 1 - (ch.modifiers?.enemyAdvance || 0);
  const winScale = BATTLE.WIN_SCALE + (ch.modifiers?.scaleBonus || 0);
  state.battle = createBattle({
    party, enemy: list, relics: state.relics, coop: state.coop,
    seed: (state.seed ^ (state.steps * 104729)) >>> 0,
    winScale, enemyRank, enemySigils: sigils,
  });
  state.phase = 'battle';
  state.pending = { kind, squadSize: list.length };
  if (kind === 'elite') state.stats.elites += 1;
  state.stats.battles += 1;
  const label = kind === 'boss' ? `${ch.bossName}（${ch.title}）` : kind === 'elite' ? '强手' : '交锋';
  pushLog(state, `战斗开始 —— ${label}${winScale !== BATTLE.WIN_SCALE ? `（天平阈值 ${winScale}）` : ''}`);
  return state.battle;
}

/** 把战斗动作转交给引擎（联机时由服务端权威调用） */
export function battleAction(state, action) {
  if (!state.battle) return { ok: false, error: '当前没有进行中的战斗' };
  const res = applyAction(state.battle, action);
  if (state.battle.over) settleBattle(state);
  return res;
}

/** 战斗结束结算：回写名册、阵亡处理、战利品或章节推进 */
export function settleBattle(state) {
  const b = state.battle;
  if (!b || !b.over) return state;
  const ch = currentChapter(state);
  const kind = state.pending?.kind || 'battle';
  // 把战报并入战役日志（截断，避免日志无限增长）
  if (b.log?.length) {
    for (const line of b.log.slice(-14)) pushLog(state, `· ${line}`);
  }

  // 回写血量 / 阵亡
  const survivors = [];
  for (const ru of state.roster) {
    const bu = b.units.find((u) => u.rid === ru.id);
    if (!bu) continue;
    if (bu.alive) {
      ru.hp = Math.max(1, bu.hp);
      survivors.push(ru);
    } else {
      state.fallen.push(ru);
      state.stats.fallen += 1;
      pushLog(state, `${PIECES[ru.type].glyph}${ru.name} 阵亡，离开了队伍。`);
    }
  }
  state.roster = survivors;

  if (b.over.result === 'lose') {
    finishRun(state, 'dead', ch.loseText || '你的棋子全数倒下。', 'battle');
    return state;
  }

  pushLog(state, `战斗胜利（${b.over.reason}）`);
  // 战后整备：幸存者恢复满血（战斗内的血量消耗不跨场累积，
  // Roguelike 的压力改由「棋子永久阵亡」与「蜡烛预算」承担）
  healAll(state, 999);
  pushLog(state, '战后整备：全队恢复满血');
  if (state.relics.includes('gear')) {
    state.candles += 1;
    pushLog(state, '遗物「铜齿轮」：蜡烛 +1');
  }
  state.tiles[key(...state.pos)].cleared = true;
  state.battle = null;

  if (kind === 'boss') {
    state.phase = 'chapterEnd';
    state.pending = { kind: 'chapterEnd' };
    pushLog(state, ch.winText || '本章通关。');
    return state;
  }

  state.phase = 'loot';
  state.pending = { kind: 'loot', options: makeLootOptions(state, kind === 'elite') };
  return state;
}

function makeLootOptions(state, isElite) {
  const kinds = shuffled(state, Object.keys(LOOT_KINDS)).slice(0, 3);
  return kinds.map((k) => {
    const opt = { kind: k, name: LOOT_KINDS[k].name, desc: LOOT_KINDS[k].desc };
    if (k === 'recruit') {
      opt.type = pick(state, RECRUIT_POOL);
      if (isElite && roll(state) < 0.5) opt.type = pick(state, ['knight', 'bishop', 'rook']);
    }
    if (k === 'sharpen' || k === 'temper' || k === 'sigil') {
      const u = pick(state, state.roster);
      opt.unitId = u ? u.id : null;
    }
    if (k === 'sigil') opt.sigil = pick(state, SIGIL_IDS);
    return opt;
  });
}

export function chooseLoot(state, idx) {
  if (state.phase !== 'loot') return { ok: false, error: '当前没有战利品可选' };
  const opt = state.pending?.options?.[idx];
  if (!opt) return { ok: false, error: '无效的选项' };
  if (opt.kind === 'recruit') {
    if (state.roster.length < 6) {
      const u = makeRosterUnit(opt.type);
      state.roster.push(u);
      pushLog(state, `招募：${PIECES[opt.type].glyph}${u.name} 加入队伍。`);
    } else {
      state.candles += 2;
      pushLog(state, '队伍已满，改为获得 2 支蜡烛。');
    }
  } else if (opt.kind === 'sharpen') {
    const u = state.roster.find((x) => x.id === opt.unitId) || pick(state, state.roster);
    if (u) { u.atk += 1; pushLog(state, `磨锋：${PIECES[u.type].glyph}${u.name} 攻击 +1（现 ${u.atk}）`); }
  } else if (opt.kind === 'temper') {
    const u = state.roster.find((x) => x.id === opt.unitId) || pick(state, state.roster);
    if (u) { u.maxHp += 2; u.hp += 2; pushLog(state, `淬甲：${PIECES[u.type].glyph}${u.name} 血量 +2（现 ${u.hp}/${u.maxHp}）`); }
  } else if (opt.kind === 'sigil') {
    const u = state.roster.find((x) => x.id === opt.unitId) || pick(state, state.roster);
    const s = opt.sigil || pick(state, SIGIL_IDS);
    if (u && !u.sigils.includes(s)) { u.sigils.push(s); pushLog(state, `授印：${PIECES[u.type].glyph}${u.name} 获得「${SIGILS[s].name}」`); }
  }
  state.phase = 'map';
  state.pending = null;
  return { ok: true };
}

// ------------------------------------------------------------------ 升变 / 休整 / 事件
export function promoteOptions(state) {
  const pawns = state.roster.filter((u) => u.type === 'pawn');
  return { pawns: pawns.map((u) => ({ id: u.id, name: u.name })), choices: PROMOTE_CHOICES };
}

export function choosePromote(state, { unitId, type }) {
  if (state.phase !== 'promote') return { ok: false, error: '当前不是升变节点' };
  const u = state.roster.find((x) => x.id === unitId) || state.roster.find((x) => x.type === 'pawn');
  if (!u) {
    // 没有兵可升变 → 退化为全员小回血
    healAll(state, 1);
    pushLog(state, '队伍中没有兵可以升变，改为全队 +1 血。');
    state.phase = 'map'; state.pending = null;
    return { ok: true };
  }
  const oldBase = PIECES[u.type];
  const newBase = PIECES[type] || PIECES.queen;
  const atkBonus = u.atk - oldBase.atk;
  const hpBonus = u.maxHp - oldBase.hp;
  u.type = newBase === oldBase ? u.type : type;
  u.atk = Math.max(1, newBase.atk + atkBonus);
  u.maxHp = Math.max(1, newBase.hp + hpBonus);
  u.hp = Math.min(u.maxHp, u.hp + (newBase.hp - oldBase.hp));
  u.name = newBase.name;
  pushLog(state, `升变：${oldBase.glyph}兵 → ${newBase.glyph}${newBase.name}（${u.atk}/${u.hp}）`);
  state.tiles[key(...state.pos)].cleared = true;
  state.phase = 'map'; state.pending = null;
  return { ok: true };
}

export function restOptions(state) {
  return {
    canRevive: state.fallen.length > 0,
    fallen: state.fallen.map((u) => ({ id: u.id, name: u.name, type: u.type, glyph: PIECES[u.type].glyph })),
    roster: state.roster.map((u) => ({ id: u.id, name: u.name, type: u.type, glyph: PIECES[u.type].glyph, atk: u.atk, maxHp: u.maxHp })),
  };
}

export function chooseRest(state, { kind, unitId } = {}) {
  if (state.phase !== 'rest') return { ok: false, error: '当前不是休整节点' };
  if (kind === 'revive') {
    const i = state.fallen.findIndex((u) => u.id === unitId);
    const idx = i >= 0 ? i : 0;
    if (state.fallen.length) {
      const u = state.fallen.splice(idx, 1)[0];
      u.hp = u.maxHp;
      state.roster.push(u);
      pushLog(state, `${PIECES[u.type].glyph}${u.name} 归队（满血）。`);
    } else {
      return { ok: false, error: '没有阵亡的棋子可以唤回' };
    }
  } else if (kind === 'train') {
    const u = state.roster.find((x) => x.id === unitId) || pick(state, state.roster);
    if (u) {
      u.atk += 1;
      pushLog(state, `整训：${PIECES[u.type].glyph}${u.name} 攻击 +1（现 ${u.atk}）`);
    } else {
      return { ok: false, error: '队伍中无人可训' };
    }
  } else {
    // 补给：蜡烛 +3（休整格在无阵亡者时的价值出口）
    state.candles += 3;
    pushLog(state, '补给：蜡烛 +3');
  }
  state.tiles[key(...state.pos)].cleared = true;
  state.phase = 'map'; state.pending = null;
  return { ok: true };
}

function healAll(state, amount) {
  for (const u of state.roster) {
    u.hp = amount >= 999 ? u.maxHp : Math.min(u.maxHp, u.hp + amount);
  }
}

export function chooseEvent(state, idx) {
  if (state.phase !== 'event') return { ok: false, error: '当前没有待决的异象' };
  const ev = state.pending?.event;
  const choice = ev?.choices?.[idx];
  if (!choice) return { ok: false, error: '无效的选择' };
  applyEffect(state, choice.effect);
  pushLog(state, choice.result || choice.label);
  state.tiles[key(...state.pos)].cleared = true;
  // 事件可能引出升变选择
  if (choice.effect?.promote) {
    state.phase = 'promote';
    state.pending = { kind: 'promote' };
    return { ok: true, chained: 'promote' };
  }
  state.phase = state.roster.length ? 'map' : 'over';
  state.pending = null;
  if (!state.roster.length) finishRun(state, 'dead', '队伍已无一人。', 'wiped');
  return { ok: true };
}

function applyEffect(state, eff = {}) {
  if (eff.candles) {
    state.candles = Math.max(0, state.candles + eff.candles);
    if (state.candles <= 0) finishRun(state, 'dead', currentChapter(state).outOfCandles || '蜡烛燃尽。', 'candles');
  }
  if (eff.healAll) healAll(state, eff.healAll);
  if (eff.duplicate) {
    const src = pick(state, state.roster);
    if (src && state.roster.length < 6) {
      const copy = makeRosterUnit(src.type, { atk: src.atk, maxHp: src.maxHp, hp: src.hp, sigils: src.sigils });
      state.roster.push(copy);
      pushLog(state, `复制：${PIECES[copy.type].glyph}${copy.name} 多了一名同名同伴。`);
    }
  }
  if (eff.sacrificeForAtk) {
    const victim = state.roster.splice(0, 1)[0];
    if (victim) {
      state.fallen.push(victim);
      pushLog(state, `${PIECES[victim.type].glyph}${victim.name} 被交了出去。`);
      for (const u of state.roster) u.atk += eff.sacrificeForAtk;
    }
  }
  if (eff.relic) {
    const pool = RELIC_IDS.filter((r) => !state.relics.includes(r));
    if (pool.length) {
      const r = pick(state, pool);
      state.relics.push(r);
      pushLog(state, `获得遗物：「${RELICS[r].name}」—— ${RELICS[r].desc}`);
    }
  }
  if (eff.buffRandom) {
    const u = pick(state, state.roster);
    if (u) {
      u.atk += eff.buffRandom[0] || 0;
      u.maxHp += eff.buffRandom[1] || 0;
      u.hp += eff.buffRandom[1] || 0;
      pushLog(state, `低语生效：${PIECES[u.type].glyph}${u.name} +${eff.buffRandom[0]} 攻 +${eff.buffRandom[1]} 血`);
    }
  }
}

// ------------------------------------------------------------------ 章节推进 / 结束
export function advanceChapter(state) {
  if (state.phase !== 'chapterEnd') return { ok: false, error: '当前不在章节结算' };
  if (state.chapterIndex + 1 >= CHAPTERS.length) {
    finishRun(state, 'win', '所有章节通关。执局者把棋子一枚枚收回匣中，然后看着你。', 'allClear');
    return { ok: true, done: true };
  }
  enterChapter(state, state.chapterIndex + 1);
  return { ok: true, chapter: state.chapterIndex };
}

function finishRun(state, result, text, reason = null) {
  state.over = {
    result, text, reason,
    chapterIndex: state.chapterIndex, steps: state.steps, candles: state.candles,
    battles: state.stats.battles,
  };
  state.phase = 'over';
  state.battle = null;
  state.pending = null;
  pushLog(state, text);
}

export function restartRun(state) {
  const seed = (state.seed + 1) >>> 0;
  const coop = state.coop;
  const fresh = createRun({ seed, coop, chapterIndex: 0 });
  return fresh;
}

// ------------------------------------------------------------------ 记录（纯函数，存储由调用方提供）
export function emptyRecords() {
  return { runs: 0, wins: 0, deaths: 0, chapterClears: {}, bestCandlesLeft: 0, bestSteps: null, fastestMs: null };
}

export function updateRecords(records, state, elapsedMs = null) {
  const r = { ...records, chapterClears: { ...(records.chapterClears || {}) } };
  r.runs += 1;
  const ch = currentChapter(state);
  if (state.over?.result === 'win') {
    r.wins += 1;
    r.chapterClears[ch.id] = (r.chapterClears[ch.id] || 0) + 1;
    const left = Math.max(0, state.candles);
    if (left > (r.bestCandlesLeft || 0)) r.bestCandlesLeft = left;
    if (r.bestSteps == null || state.steps < r.bestSteps) r.bestSteps = state.steps;
    if (elapsedMs != null && (r.fastestMs == null || elapsedMs < r.fastestMs)) r.fastestMs = elapsedMs;
  } else {
    r.deaths += 1;
  }
  return r;
}

// ------------------------------------------------------------------ 冒烟用：自动完成一局（AI 托管）
export function autoRun(state, { maxSteps = 400 } = {}) {
  let guard = 0;
  while (!state.over && guard++ < maxSteps) {
    if (state.phase === 'map') {
      const moves = legalKingMoves(state);
      const [tf, tr] = currentChapter(state).throne;
      // 王走八方 → 用切比雪夫距离；蜡烛不足以支撑绕路时必须直奔王座
      const distNow = Math.max(Math.abs(state.pos[0] - tf), Math.abs(state.pos[1] - tr));
      const mustRush = state.candles <= distNow + 4;
      const scored = moves.map((m) => {
        const t = state.tiles[key(m[0], m[1])];
        const d = Math.max(Math.abs(m[0] - tf), Math.abs(m[1] - tr));
        if (mustRush) return { m, s: -10 * d };
        let s = -d * 2.5;                                           // 朝王座推进（权重高于绕路）
        if (t.cleared) s -= 5;                                      // 走回头路没有收益
        else if (t.kind === 'battle') s += state.roster.length >= 5 ? 0 : 4;
        else if (t.kind === 'elite') s += state.roster.length >= 5 ? 3 : -8;
        else if (t.kind === 'promote') s += 4;
        else if (t.kind === 'rest') s += state.fallen.length ? 5 : 1;
        else if (t.kind === 'event') s += 2;
        else if (t.kind === 'boss') s += state.roster.length >= 4 ? 8 : -8; // 队伍不足先练级
        return { m, s };
      });
      scored.sort((a, b) => b.s - a.s);
      moveKing(state, scored[0].m);
    } else if (state.phase === 'battle') {
      const b = state.battle;
      const actors = livingUnits(b, 'player').filter((u) => !u.hasActed);
      if (actors.length === 0) { battleAction(state, { type: 'endTurn', who: 'p1' }); continue; }
      const u = actors[0];
      const act = aiChooseAction(state.battle, u);
      battleAction(state, act);
    } else if (state.phase === 'loot') {
      chooseLoot(state, 0);
    } else if (state.phase === 'promote') {
      const { pawns } = promoteOptions(state);
      choosePromote(state, { unitId: pawns[0]?.id, type: 'queen' });
    } else if (state.phase === 'rest') {
      // 有阵亡者优先复活，否则整训
      chooseRest(state, state.fallen.length ? { kind: 'revive' } : { kind: 'train' });
    } else if (state.phase === 'event') {
      chooseEvent(state, 0);
    } else if (state.phase === 'chapterEnd') {
      advanceChapter(state);
    } else break;
  }
  return state.over || { result: 'timeout' };
}

import { optionsFor as battleOptionsFor } from './engine.js';

/** 战斗 AI（「熟练玩家」代理，用于平衡测量）：优先击杀；利用天平机制让单位保持
 *   未受阻以推分，并主动挡住敌方高攻单位；避免把残血单位送进敌方可击杀的格子。 */
function contributionAt(b, u, f, r) {
  const foes = livingUnits(b, 'enemy');
  const blocked = foes.some((e) => e.f === f && e.r > r);
  const myPush = blocked ? 0 : u.atk;
  let blockGain = 0;
  for (const e of foes) if (e.f === f && e.r > r) blockGain += e.atk; // 挡住 e → 敌方少推 e.atk
  return myPush * 4 + blockGain * 5;
}

/** 计算单位从 (of,or) 出发能攻击到的格子（几何，忽略阻挡——用于威胁/setUp 估算） */
function atkSquaresFrom(b, u, of, or) {
  const base = PIECES[u.type] || PIECES.pawn;
  const inB = (f, r) => f >= 0 && f < BATTLE.FILES && r >= 0 && r < BATTLE.RANKS;
  const out = [];
  const push = (f, r) => { if (inB(f, r)) out.push({ f, r }); };
  const fwd = u.side === 'player' ? 1 : -1;
  switch (base.move) {
    case 'pawn':
      push(of - 1, or + fwd); push(of + 1, or + fwd); break;
    case 'knight':
      for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) push(of + df, or + dr);
      break;
    case 'king':
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) push(of + df, or + dr);
      break;
    case 'bishop':
    case 'rook':
    case 'queen': {
      const dirs = base.move === 'bishop' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
        : base.move === 'rook' ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
          : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [df, dr] of dirs)
        for (let s = 1; s <= base.range; s++) {
          const f = of + df * s, r = or + dr * s;
          if (!inB(f, r)) break;
          push(f, r);
          if (unitAt(b, f, r)) break;
        }
      break;
    }
  }
  return out;
}

/** (f,r) 是否处于敌方某单位的击杀威胁内（忽略阻挡，略高估危险，使 AI 偏谨慎） */
function enemyThreatAt(b, f, r, hp, armored) {
  for (const e of livingUnits(b, 'enemy')) {
    const dmg = e.atk * (e.sigils.includes('double_strike') ? 2 : 1);
    const eff = armored ? Math.max(1, dmg - 1) : dmg;
    if (eff >= hp && atkSquaresFrom(b, e, e.f, e.r).some((s) => s.f === f && s.r === r)) return true;
  }
  return false;
}

export function aiChooseAction(b, u) {
  const { attacks, moves } = battleOptionsFor(b, u.id);
  let best = null;
  const consider = (score, action) => { if (!best || score > best.score) best = { score, action }; };

  // 原地不动的基准贡献（用于保留好位置）
  const stay = contributionAt(b, u, u.f, u.r);

  for (const tid of attacks) {
    const t = b.units.find((x) => x.id === tid);
    if (!t) continue;
    const hits = u.sigils.includes('double_strike') ? 2 : 1;
    let rem = t.hp;
    for (let i = 0; i < hits && rem > 0; i++) {
      let d = u.atk;
      if (t.sigils.includes('armored')) d = Math.max(1, d - 1);
      rem -= d;
    }
    const kills = rem <= 0;
    let selfLoss = 0;
    if (!kills) {
      let c = t.atk;
      if (u.sigils.includes('armored')) c = Math.max(1, c - 1);
      selfLoss += c;
    }
    if (t.sigils.includes('sharp_quills')) selfLoss += 1;
    const survive = u.hp - selfLoss > 0;
    let score = (kills ? 120 : 20) + (kills ? t.atk * 10 : 0) + (survive ? 14 : -95) - selfLoss * 3;
    consider(score, { type: 'attack', unitId: u.id, targetId: tid });
  }

  for (const m of moves) {
    const newC = contributionAt(b, u, m.f, m.r);
    const danger = enemyThreatAt(b, m.f, m.r, u.hp, u.sigils.includes('armored'));
    // 移动后能否于下回合攻击某敌方（setUp 吃子）
    let setup = 0;
    const reach = atkSquaresFrom(b, u, m.f, m.r);
    for (const e of livingUnits(b, 'enemy')) {
      if (reach.some((s) => s.f === e.f && s.r === e.r)) setup += 6 + e.atk * 2;
    }
    const score = newC - (danger ? 60 : 0) + setup;
    consider(score, { type: 'move', unitId: u.id, to: m });
  }

  consider(stay, { type: 'wait', unitId: u.id });
  return best ? best.action : { type: 'wait', unitId: u.id };
}

export function chapterCount() {
  return CHAPTERS.length;
}
