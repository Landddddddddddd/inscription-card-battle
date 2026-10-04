// 战斗引擎：国际象棋走法 + 《邪刻》式「纵列阻挡 / 天平推分取胜」
// 纯逻辑、无 DOM 依赖，Node 与浏览器共用。所有随机走可复现 PRNG（联机权威需要）。

import { BATTLE, PIECES, SIGILS } from './constants.js';

// ------------------------------------------------------------------ 随机数
export function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 状态自带计数器，保证「同一状态 + 同一动作 = 同一结果」（服务端权威可重放）
function rand(state) {
  state.rngState = (state.rngState + 1) >>> 0;
  return makeRng(state.seed ^ (state.rngState * 2654435761))();
}

// ------------------------------------------------------------------ 建局
let uid = 0;
function nextId(state, prefix = 'u') {
  state.seq += 1;
  return `${prefix}${state.seq}`;
}

function makeUnit(state, side, spec, f, r, owner) {
  const base = PIECES[spec.type] || PIECES.pawn;
  const maxHp = spec.hp != null ? spec.hp : base.hp;
  return {
    id: spec.id || nextId(state, side === 'player' ? 'p' : 'e'),
    rid: spec.rid || null,          // 对应战役名册中的棋子 id（用于战后回写血量）
    side,
    type: spec.type,
    name: spec.name || base.name,
    glyph: base.glyph,
    atk: spec.atk != null ? spec.atk : base.atk,
    hp: spec.hp != null ? spec.hp : base.hp,
    maxHp,
    sigils: [...(spec.sigils || [])],
    f, r,
    hasActed: false,
    alive: true,
    owner: owner || (side === 'player' ? 'p1' : 'cpu'),
  };
}

/**
 * party  : 名册棋子 [{id,type,atk,hp,maxHp,sigils,name}]（hp 为进入战斗时的血量）
 * enemy  : 敌方编成 [{type, sigils?}]
 * relics : 已持有遗物 id 数组
 * coop   : 是否双人（true 时玩家单位交替归属 p1/p2）
 */
export function createBattle({ party = [], enemy = [], relics = [], seed = 1, coop = false, winScale = null, enemyRank = null, enemySigils = null } = {}) {
  const state = {
    seed: seed >>> 0,
    rngState: 0,
    seq: 0,
    units: [],
    scale: { player: 0, enemy: 0 },
    turn: 'player',
    round: 1,
    over: null,
    log: [],
    relics: [...relics],
    coop,
    winScale: winScale || BATTLE.WIN_SCALE,
    playersDone: { p1: false, p2: false },
    revivedByMirror: false,
  };

  const place = (list, side, rank) => {
    const n = list.length;
    const start = Math.max(0, Math.floor((BATTLE.FILES - n) / 2));
    list.forEach((spec, i) => {
      const owner = side === 'player'
        ? (coop ? (i % 2 === 0 ? 'p1' : 'p2') : 'p1')
        : 'cpu';
      state.units.push(makeUnit(state, side, spec, start + i, rank, owner));
    });
  };

  // 玩家在下方（rank 0），敌方在上方（默认最上一行；章节可让其开局向前推进）
  const topRank = enemyRank == null ? BATTLE.RANKS - 1 : Math.max(1, Math.min(BATTLE.RANKS - 1, enemyRank));
  place(party.slice(0, BATTLE.FILES), 'player', 0);
  place(enemy.slice(0, BATTLE.FILES), 'enemy', topRank);

  // 章节 Boss 的附加印记
  if (enemySigils) {
    for (const u of state.units) {
      if (u.side === 'enemy' && enemySigils[u.type]) {
        for (const s of enemySigils[u.type]) if (!u.sigils.includes(s)) u.sigils.push(s);
      }
    }
  }

  if (relics.includes('wax_seal')) {
    state.scale.player += 1;
    pushLog(state, '遗物「火漆印」生效：我方天平 +1');
  }
  if (relics.includes('tongs')) {
    for (const u of state.units) {
      if (u.side === 'player' && !u.sigils.includes('armored')) u.sigils.push('armored');
    }
    pushLog(state, '遗物「铁钳」生效：我方全员获得「厚甲」');
  }

  pushLog(state, `第 1 回合 · 我方行动`);
  return state;
}

function pushLog(state, text) {
  state.log.push(text);
  if (state.log.length > 200) state.log.shift();
}

// ------------------------------------------------------------------ 棋盘查询
export function unitAt(state, f, r) {
  return state.units.find((u) => u.alive && u.f === f && u.r === r) || null;
}
export function livingUnits(state, side) {
  return state.units.filter((u) => u.alive && u.side === side);
}
function inBoard(f, r) {
  return f >= 0 && f < BATTLE.FILES && r >= 0 && r < BATTLE.RANKS;
}

const DIR_ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR_DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT_STEPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

function forwardDir(side) {
  return side === 'player' ? 1 : -1;
}

/** 生成某单位「可移动到的空格」与「可攻击的敌方单位 id」 */
export function optionsFor(state, unitId) {
  const u = state.units.find((x) => x.id === unitId);
  if (!u || !u.alive || u.hasActed || state.over) return { moves: [], attacks: [] };
  const base = PIECES[u.type] || PIECES.pawn;
  const moves = [];
  const attacks = [];
  const consider = (f, r) => {
    if (!inBoard(f, r)) return false;      // false = 停止延伸（滑行类）
    const occ = unitAt(state, f, r);
    if (!occ) { moves.push({ f, r }); return true; }
    if (occ.side !== u.side) attacks.push(occ.id);
    return false;
  };

  switch (base.move) {
    case 'pawn': {
      const d = forwardDir(u.side);
      const fr = u.r + d;
      if (inBoard(u.f, fr) && !unitAt(state, u.f, fr)) moves.push({ f: u.f, r: fr });
      for (const df of [-1, 1]) {
        const nf = u.f + df;
        if (inBoard(nf, fr)) {
          const occ = unitAt(state, nf, fr);
          if (occ && occ.side !== u.side) attacks.push(occ.id);
        }
      }
      break;
    }
    case 'knight': {
      for (const [df, dr] of KNIGHT_STEPS) consider(u.f + df, u.r + dr);
      break;
    }
    case 'king': {
      for (const [df, dr] of [...DIR_ORTHO, ...DIR_DIAG]) consider(u.f + df, u.r + dr);
      break;
    }
    case 'bishop':
    case 'rook':
    case 'queen': {
      const dirs = base.move === 'bishop' ? DIR_DIAG : base.move === 'rook' ? DIR_ORTHO : [...DIR_ORTHO, ...DIR_DIAG];
      for (const [df, dr] of dirs) {
        for (let step = 1; step <= base.range; step++) {
          if (!consider(u.f + df * step, u.r + dr * step)) break;
        }
      }
      break;
    }
    default:
      break;
  }
  return { moves, attacks };
}

// ------------------------------------------------------------------ 伤害
function dealDamage(state, target, amount, sourceLabel) {
  if (!target.alive || amount <= 0) return 0;
  let dmg = amount;
  if (target.sigils.includes('armored')) dmg = Math.max(1, dmg - 1);
  target.hp -= dmg;
  pushLog(state, `${target.glyph}${target.name} 受到 ${dmg} 点伤害（剩余 ${Math.max(0, target.hp)}）`);
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    pushLog(state, `${target.glyph}${target.name} 被吃掉了（${sourceLabel}）`);
    if (target.side === 'player' && state.relics.includes('mirror') && !state.revivedByMirror) {
      state.revivedByMirror = true;
      target.alive = true;
      target.hp = Math.max(1, Math.floor(target.maxHp / 2));
      pushLog(state, `遗物「镜面」生效：${target.glyph}${target.name} 以半血复活`);
    }
  }
  return dmg;
}

// ------------------------------------------------------------------ 动作
function afterUnitAction(state) {
  // 玩家方是否已无子可动
  const remaining = livingUnits(state, 'player').filter((u) => !u.hasActed);
  const allDone = remaining.length === 0;
  const bothDeclared = !state.coop || (state.playersDone.p1 && state.playersDone.p2);
  if (allDone || (state.coop && bothDeclared)) {
    finishPlayerTurn(state);
  }
}

function finishPlayerTurn(state) {
  if (state.over) return;
  enemyTurn(state);
  if (state.over) return;
  endOfRound(state);
  if (state.over) return;
  state.round += 1;
  for (const u of state.units) if (u.alive) u.hasActed = false;
  state.playersDone = { p1: false, p2: false };
  state.turn = 'player';
  pushLog(state, `第 ${state.round} 回合 · 我方行动`);
}

export function applyAction(state, action) {
  if (state.over) return { ok: false, error: '对局已结束' };
  if (state.turn !== 'player' && action.type !== 'endTurn') {
    return { ok: false, error: '当前不是我方回合' };
  }

  if (action.type === 'endTurn') {
    const who = action.who || 'p1';
    state.playersDone[who] = true;
    pushLog(state, who === 'p2' ? '玩家二 结束行动' : '玩家一 结束行动');
    if (!state.coop || (state.playersDone.p1 && state.playersDone.p2)) finishPlayerTurn(state);
    return { ok: true };
  }

  const u = state.units.find((x) => x.id === action.unitId);
  if (!u || !u.alive) return { ok: false, error: '棋子不存在' };
  if (u.side !== 'player') return { ok: false, error: '不能操控对方棋子' };
  if (u.hasActed) return { ok: false, error: '该棋子本回合已行动' };
  if (state.coop && action.who && u.owner !== action.who) return { ok: false, error: '这不是你的棋子' };

  if (action.type === 'move') {
    const { moves } = optionsFor(state, u.id);
    const target = moves.find((m) => m.f === action.to?.f && m.r === action.to?.r);
    if (!target) return { ok: false, error: '该格子不可到达' };
    u.f = target.f; u.r = target.r;
    u.hasActed = true;
    pushLog(state, `${u.glyph}${u.name} 移动至 ${sqName(target.f, target.r)}`);
    afterUnitAction(state);
    return { ok: true };
  }

  if (action.type === 'attack') {
    const { attacks } = optionsFor(state, u.id);
    if (!attacks.includes(action.targetId)) return { ok: false, error: '该目标不在攻击范围' };
    const target = state.units.find((x) => x.id === action.targetId);
    const hits = u.sigils.includes('double_strike') ? 2 : 1;
    pushLog(state, `${u.glyph}${u.name} 攻击 ${target.glyph}${target.name}`);
    for (let i = 0; i < hits; i++) {
      if (!target.alive) break;
      dealDamage(state, target, u.atk, `${u.glyph}${u.name}`);
    }
    // 反击（《邪刻》同时结算语义）：防守者存活则回敬一次
    if (target.alive && u.alive) {
      pushLog(state, `${target.glyph}${target.name} 反击`);
      dealDamage(state, u, target.atk, `${target.glyph}${target.name}`);
    }
    // 尖刺反伤
    if (target.sigils.includes('sharp_quills') && u.alive) {
      pushLog(state, `尖刺反伤 1 点`);
      dealDamage(state, u, 1, '尖刺');
    }
    u.hasActed = true;
    checkElimination(state);
    if (!state.over) afterUnitAction(state);
    return { ok: true };
  }

  if (action.type === 'wait') {
    u.hasActed = true;
    pushLog(state, `${u.glyph}${u.name} 按兵不动`);
    afterUnitAction(state);
    return { ok: true };
  }

  return { ok: false, error: '未知动作' };
}

// ------------------------------------------------------------------ 敌方 AI
function enemyTurn(state) {
  state.turn = 'enemy';
  const actors = livingUnits(state, 'enemy').sort((a, b) => b.atk - a.atk);
  for (const e of actors) {
    if (!e.alive || state.over) continue;
    const { attacks, moves } = optionsFor(state, e.id);
    if (attacks.length > 0) {
      // 优先能击杀的，其次血量最低的
      let best = null;
      for (const id of attacks) {
        const t = state.units.find((x) => x.id === id);
        if (!t) continue;
        const lethal = t.hp <= e.atk * (e.sigils.includes('double_strike') ? 2 : 1);
        if (!best) { best = { t, lethal }; continue; }
        if (lethal && !best.lethal) best = { t, lethal };
        else if (lethal === best.lethal && t.hp < best.t.hp) best = { t, lethal };
      }
      if (best) {
        const hits = e.sigils.includes('double_strike') ? 2 : 1;
        pushLog(state, `${e.glyph}${e.name} 攻击 ${best.t.glyph}${best.t.name}`);
        for (let i = 0; i < hits; i++) {
          if (!best.t.alive) break;
          dealDamage(state, best.t, e.atk, `${e.glyph}${e.name}`);
        }
        if (best.t.alive && e.alive) {
          pushLog(state, `${best.t.glyph}${best.t.name} 反击`);
          dealDamage(state, e, best.t.atk, `${best.t.glyph}${best.t.name}`);
        }
        if (best.t.sigils.includes('sharp_quills') && e.alive) dealDamage(state, e, 1, '尖刺');
        e.hasActed = true;
        checkElimination(state);
        if (state.over) return;
        continue;
      }
    }
    // 无攻击目标 → 朝最近的玩家棋子推进
    const foes = livingUnits(state, 'player');
    if (foes.length && moves.length) {
      let bestMove = null, bestDist = Infinity;
      for (const m of moves) {
        for (const foe of foes) {
          const d = Math.abs(m.f - foe.f) + Math.abs(m.r - foe.r);
          if (d < bestDist) { bestDist = d; bestMove = m; }
        }
      }
      if (bestMove) {
        e.f = bestMove.f; e.r = bestMove.r;
        pushLog(state, `${e.glyph}${e.name} 移动至 ${sqName(e.f, e.r)}`);
      }
    }
    e.hasActed = true;
  }
}

// ------------------------------------------------------------------ 回合结束结算（天平）
function endOfRound(state) {
  // 印记：狂热 / 回复
  for (const u of state.units) {
    if (!u.alive) continue;
    if (u.sigils.includes('frenzy')) {
      const before = u.atk;
      u.atk = Math.min(BATTLE.FRENZY_CAP, u.atk + 1);
      if (u.atk !== before) pushLog(state, `${u.glyph}${u.name} 狂热：攻击 ${before} → ${u.atk}`);
    }
    if (u.sigils.includes('regen') && u.hp < u.maxHp) {
      u.hp = Math.min(u.maxHp, u.hp + 1);
      pushLog(state, `${u.glyph}${u.name} 回复 1 点血（${u.hp}/${u.maxHp}）`);
    }
  }

  // 天平：本方棋子在所在纵列上「前方无敌子阻挡」时，其攻击力推天平
  let playerPush = 0, enemyPush = 0;
  for (const u of livingUnits(state, 'player')) {
    const blocked = livingUnits(state, 'enemy').some((e) => e.f === u.f && e.r > u.r);
    if (!blocked || u.sigils.includes('airborne')) playerPush += u.atk;
  }
  for (const e of livingUnits(state, 'enemy')) {
    const blocked = livingUnits(state, 'player').some((p) => p.f === e.f && p.r < e.r);
    if (!blocked || e.sigils.includes('airborne')) enemyPush += e.atk;
  }
  if (playerPush || enemyPush) {
    state.scale.player += playerPush;
    state.scale.enemy += enemyPush;
    pushLog(state, `天平结算：我方 +${playerPush} → ${state.scale.player}｜敌方 +${enemyPush} → ${state.scale.enemy}`);
  }

  checkOver(state);
}

function checkElimination(state) {
  if (livingUnits(state, 'enemy').length === 0) {
    state.over = { result: 'win', reason: '敌方棋子全部被吃' };
    pushLog(state, '敌方全灭 —— 胜利');
  } else if (livingUnits(state, 'player').length === 0) {
    state.over = { result: 'lose', reason: '我方棋子全部被吃' };
    pushLog(state, '我方全灭 —— 失败');
  }
}

function checkOver(state) {
  const need = state.winScale || BATTLE.WIN_SCALE;
  const diff = state.scale.player - state.scale.enemy;
  if (diff >= need) {
    state.over = { result: 'win', reason: `天平领先 ${diff} 分` };
    pushLog(state, `天平领先 ${diff} 分 —— 胜利`);
  } else if (diff <= -need) {
    state.over = { result: 'lose', reason: `天平落后 ${-diff} 分` };
    pushLog(state, `天平落后 ${-diff} 分 —— 失败`);
  } else {
    checkElimination(state);
  }
}

// ------------------------------------------------------------------ 工具
export function sqName(f, r) {
  return `${String.fromCharCode(97 + f)}${r + 1}`;
}

export function unitSummary(u) {
  const sig = u.sigils.map((s) => SIGILS[s]?.name || s).join('、');
  return `${u.glyph} ${u.name} ${u.atk}/${u.hp}${sig ? ` · ${sig}` : ''}`;
}

/** 自动跑完一局（用于冒烟测试 / AI 托管） */
export function autoPlay(state, maxRounds = 60) {
  let guard = 0;
  while (!state.over && guard++ < maxRounds * 40) {
    if (state.turn === 'player') {
      const actors = livingUnits(state, 'player').filter((u) => !u.hasActed);
      if (actors.length === 0) { applyAction(state, { type: 'endTurn', who: 'p1' }); continue; }
      const u = actors[0];
      const { attacks, moves } = optionsFor(state, u.id);
      if (attacks.length) applyAction(state, { type: 'attack', unitId: u.id, targetId: attacks[0] });
      else if (moves.length) applyAction(state, { type: 'move', unitId: u.id, to: moves[0] });
      else applyAction(state, { type: 'wait', unitId: u.id });
    } else {
      // 敌方回合由 applyAction 内部驱动；这里防御性推进
      applyAction(state, { type: 'endTurn', who: 'p1' });
    }
  }
  return state.over || { result: 'draw', reason: '达到回合上限' };
}
