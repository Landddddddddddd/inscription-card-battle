// keybinds.js — 自定义键位系统（战斗 / 组卡 两套上下文）。
// 绑定描述符：{ code, shift?, ctrl?, alt? }，code 取 KeyboardEvent.code（布局无关）。
// 每个动作默认可绑定多个候选键；用户改键时整体替换为主键（保留默认中的备用键由「恢复默认」恢复）。

const LS_KEY = 'inscription.keybinds.v1';

// 战斗上下文：WASD 为主轴。
//  - A/D（含 ←/→）移动光标：未选牌时移手牌、选中后移列
//  - W 选牌 / 放牌（选中牌后在当前列打出）
//  - S/Esc 取消选择
//  - 空格 / Enter 结束回合（选中牌时改为在该列打出）
//  - 1-4 在对应列出牌（选中牌时）
//  - F 投降 · P 求和
//  - Q/E/R/T/G/H 六个表情
const DEFAULTS = {
  battle: {
    cursorLeft:  [{ code: 'KeyA' }, { code: 'ArrowLeft' }],
    cursorRight: [{ code: 'KeyD' }, { code: 'ArrowRight' }],
    select:      [{ code: 'KeyW' }],
    cancel:      [{ code: 'KeyS' }, { code: 'Escape' }],
    endTurn:     [{ code: 'Space' }, { code: 'Enter' }, { code: 'NumpadEnter' }],
    lane1:       [{ code: 'Digit1' }, { code: 'Numpad1' }],
    lane2:       [{ code: 'Digit2' }, { code: 'Numpad2' }],
    lane3:       [{ code: 'Digit3' }, { code: 'Numpad3' }],
    lane4:       [{ code: 'Digit4' }, { code: 'Numpad4' }],
    surrender:   [{ code: 'KeyF' }],
    peace:       [{ code: 'KeyP' }],
    emote1:      [{ code: 'KeyQ' }],
    emote2:      [{ code: 'KeyE' }],
    emote3:      [{ code: 'KeyR' }],
    emote4:      [{ code: 'KeyT' }],
    emote5:      [{ code: 'KeyG' }],
    emote6:      [{ code: 'KeyH' }],
  },
  // 组卡上下文：WASD 移动卡牌焦点，=/- 增减 1，Shift+←/→ 增减 5（即「选卡组快捷」）。
  builder: {
    cursorLeft:  [{ code: 'KeyA' }, { code: 'ArrowLeft' }],
    cursorRight: [{ code: 'KeyD' }, { code: 'ArrowRight' }],
    cursorUp:    [{ code: 'KeyW' }, { code: 'ArrowUp' }],
    cursorDown:  [{ code: 'KeyS' }, { code: 'ArrowDown' }],
    add1:        [{ code: 'Equal' }, { code: 'NumpadAdd' }],
    sub1:        [{ code: 'Minus' }, { code: 'NumpadSubtract' }],
    add5:        [{ code: 'ArrowRight', shift: true }],
    sub5:        [{ code: 'ArrowLeft', shift: true }],
    confirm:     [{ code: 'Enter' }, { code: 'NumpadEnter' }, { code: 'Space' }],
    cancel:      [{ code: 'Escape' }],
  },
};

const MOD_KEYS = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];

function clone(o) { return JSON.parse(JSON.stringify(o)); }

let _cache = null;

export function getBinds() {
  if (_cache) return _cache;
  let stored = null;
  try { const s = localStorage.getItem(LS_KEY); if (s) stored = JSON.parse(s); } catch (_) { /* ignore */ }
  const base = clone(DEFAULTS);
  if (stored && stored.battle && stored.builder) {
    for (const ctx of ['battle', 'builder']) {
      for (const k in base[ctx]) if (stored[ctx][k]) base[ctx][k] = stored[ctx][k];
    }
  }
  _cache = base;
  return _cache;
}

function saveBinds() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_cache)); } catch (_) { /* ignore */ }
}

export function setBind(ctx, action, bind) {
  const b = getBinds();
  if (!b[ctx]) b[ctx] = {};
  const nb = normalizeBind(bind);
  if (!nb) return;
  b[ctx][action] = [nb];
  saveBinds();
}

export function resetBinds() {
  _cache = clone(DEFAULTS);
  saveBinds();
}

function normalizeBind(b) {
  if (!b || !b.code) return null;
  return { code: b.code, shift: !!b.shift, ctrl: !!b.ctrl, alt: !!b.alt };
}

// 从一次 keydown 事件提取绑定描述符；纯修饰键返回 null（需配合普通键）。
export function eventToBind(e) {
  if (MOD_KEYS.includes(e.code)) return null;
  return { code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey };
}

function matchOne(b, e) {
  if (!b || b.code !== e.code) return false;
  if (!!b.shift !== e.shiftKey) return false;
  if (!!b.ctrl !== e.ctrlKey) return false;
  if (!!b.alt !== e.altKey) return false;
  return true;
}

export function matchAction(binds, ctx, e) {
  const grp = binds[ctx];
  if (!grp) return null;
  for (const action in grp) {
    const list = grp[action];
    if (!list) continue;
    for (const b of list) if (matchOne(b, e)) return action;
  }
  return null;
}

const CODE_LABEL = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Space: '空格', Enter: 'Enter', Escape: 'Esc',
  Equal: '=', Minus: '−', NumpadAdd: '+', NumpadSubtract: '−',
  NumpadEnter: 'Enter',
};

export function fmtBind(b) {
  if (!b) return '未设置';
  let s = '';
  if (b.ctrl) s += 'Ctrl+';
  if (b.alt) s += 'Alt+';
  if (b.shift) s += 'Shift+';
  s += codeLabel(b.code);
  return s;
}

function codeLabel(code) {
  if (CODE_LABEL[code]) return CODE_LABEL[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  return code;
}
