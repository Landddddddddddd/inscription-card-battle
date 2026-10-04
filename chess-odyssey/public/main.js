// 入口：菜单 → 单人 / 联机；持有全局状态并把玩家动作翻译为引擎调用或网络消息。
import {
  createRun, moveKing, battleAction, chooseLoot, choosePromote,
  chooseRest, chooseEvent, advanceChapter, currentChapter,
} from './js/campaign.js';
import { renderGame } from './ui.js';
import { openCoop } from './net.js';

const app = document.getElementById('app');
const G = {
  mode: null,        // 'solo' | 'coop' | null(菜单)
  state: null,
  me: null,          // coop 时的 'p1' / 'p2'
  selected: null,    // 战斗中选中的单位 id
  net: null,
  room: null,        // 房间码
  coopView: 'lobby', // coop 子界面：lobby | waiting | room
};

// ----------------------------------------------------------------- 工具
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function draw() {
  if (!G.mode || !G.state) { drawMenu(); return; }
  renderGame(app, {
    state: G.state, me: G.me, selected: G.selected, mode: G.mode, onRestart: doRestart,
    onSelect: (id) => { G.selected = (G.selected === id ? null : id); draw(); },
    dispatch,
  });
}

// ----------------------------------------------------------------- 菜单 / 大厅
function drawMenu() {
  app.innerHTML = '';
  const wrap = h(`
    <div>
      <div class="title-block">
        <h1>残 局</h1>
        <div class="sub">THE ENDGAME · 国际象棋 Roguelike</div>
      </div>
      <div class="menu">
        <button class="primary" id="solo">单人闯关</button>
        <button id="coop">联机合作（双人）</button>
        <div class="muted center">走到黑王的王座 h8，每一步都烧掉一支蜡烛。<br>棋子为单位，沿国际象棋走法作战，靠「天平」推分取胜。</div>
      </div>
    </div>`);
  app.appendChild(wrap);
  wrap.querySelector('#solo').onclick = startSolo;
  wrap.querySelector('#coop').onclick = startCoopMenu;
}

function startCoopMenu() {
  app.innerHTML = '';
  const wrap = h(`
    <div>
      <div class="title-block"><h1 style="font-size:30px">联机合作</h1></div>
      <div class="menu">
        <button class="primary" id="host">创建房间</button>
        <div class="card">
          <h3>加入房间</h3>
          <input class="code" id="code" maxlength="4" placeholder="ABCD" />
          <div style="height:10px"></div>
          <button id="join" style="width:100%">用房间码加入</button>
        </div>
        <button id="back">返回</button>
        <div class="muted center">两人共用一局：王由任意一方移动；战斗中各单位按归属分别操控。</div>
      </div>
    </div>`);
  app.appendChild(wrap);
  wrap.querySelector('#host').onclick = () => connectCoop('host');
  wrap.querySelector('#join').onclick = () => {
    const code = wrap.querySelector('#code').value.trim().toUpperCase();
    if (code.length !== 4) { toast('请输入 4 位房间码'); return; }
    connectCoop('join', code);
  };
  wrap.querySelector('#back').onclick = () => { G.mode = null; drawMenu(); };
}

function connectCoop(role, code) {
  G.mode = 'coop';
  G.coopView = 'lobby';
  G._coopEverOpened = false;
  G.net = openCoop({
    onOpen: () => { G._coopEverOpened = true; },
    onMessage: handleCoopMsg,
    onError: () => {
      if (!G._coopEverOpened && G.mode === 'coop') {
        toast('联机需要本地运行服务端：node server.js。当前为纯网页托管环境，仅支持单人闯关。');
      }
    },
    onClose: () => { if (G._coopEverOpened && G.mode === 'coop') toast('与服务器断开连接'); },
  });
  G._role = role; G._code = code;
  drawLobby();
  // 等连接建立后发送（WebSocket onopen 异步，这里用 readyState 轮询兜底）
  const sendWhenReady = () => {
    if (G.net.ready) {
      if (role === 'host') G.net.send({ type: 'host' });
      else G.net.send({ type: 'join', code });
    } else setTimeout(sendWhenReady, 50);
  };
  sendWhenReady();
}

function drawLobby() {
  app.innerHTML = '';
  const wrap = h(`<div><div class="title-block"><h1 style="font-size:28px">房间</h1></div><div class="menu" id="box"></div></div>`);
  app.appendChild(wrap);
  const box = wrap.querySelector('#box');
  if (G.coopView === 'room') {
    box.appendChild(h(`<div class="card center"><h3>房间已创建</h3>
      <div style="font-size:34px;letter-spacing:0.3em;color:var(--gold-soft);margin:8px 0">${G.room}</div>
      <div class="muted">把房间码发给队友，等他加入后由你点「开始」。</div></div>`));
    const startBtn = h(`<button class="primary" style="width:100%">开始游戏</button>`);
    startBtn.onclick = () => G.net.send({ type: 'start' });
    box.appendChild(startBtn);
    box.appendChild(h(`<button id="leave" style="width:100%">离开</button>`));
    box.querySelector('#leave').onclick = leaveCoop;
  } else if (G.coopView === 'joined') {
    box.appendChild(h(`<div class="card center"><h3>已加入房间</h3>
      <div style="font-size:34px;letter-spacing:0.3em;color:var(--gold-soft);margin:8px 0">${G.room}</div>
      <div class="muted">等待房主开始游戏…</div></div>`));
    box.appendChild(h(`<button id="leave" style="width:100%">离开</button>`));
    box.querySelector('#leave').onclick = leaveCoop;
  } else if (G.coopView === 'waiting') {
    box.appendChild(h(`<div class="card center"><div class="spin">连 接 中 …</div></div>`));
  } else {
    box.appendChild(h(`<div class="card center"><div class="spin">连 接 中 …</div>
      <div class="muted">正在${G._role === 'host' ? '创建房间' : '加入 ' + G._code}</div></div>`));
  }
}

function leaveCoop() {
  if (G.net) G.net.close();
  G.net = null; G.mode = null; G.state = null; G.room = null; G.me = null;
  drawMenu();
}

function handleCoopMsg(msg) {
  switch (msg.type) {
    case 'roomCreated':
      G.room = msg.code; G.me = msg.slot; G.coopView = 'room'; drawLobby(); break;
    case 'joined':
      G.room = msg.code; G.me = msg.slot; G.coopView = 'joined'; drawLobby(); break;
    case 'peerJoined':
      toast('队友已加入，房主可以开始了'); break;
    case 'started':
      toast('对局开始'); break;
    case 'state':
      G.state = msg.state; G.selected = null; draw(); break;
    case 'peerLeft':
      toast('队友离开了，本局结束'); G.state = null; G.mode = 'coop'; G.coopView = G.me === 'p1' ? 'room' : 'joined'; break;
    case 'error':
      toast(msg.message || '出错'); break;
    default: break;
  }
}

// ----------------------------------------------------------------- 单人
function startSolo() {
  const ch = currentChapter(createRun({ chapterIndex: 0 }));
  app.innerHTML = '';
  const wrap = h(`
    <div class="banner" style="margin-top:30px">
      <h2 style="color:var(--gold-soft)">${ch.title}</h2>
      <div class="narrative" style="text-align:left;margin:14px 0">
        ${(ch.intro || []).map((p) => `<div style="margin:6px 0">${p}</div>`).join('')}
      </div>
      <div class="actions">
        <button class="primary" id="go">步入棋室</button>
        <button id="back">返回</button>
      </div>
    </div>`);
  app.appendChild(wrap);
  wrap.querySelector('#go').onclick = () => {
    G.mode = 'solo'; G.me = 'p1'; G.selected = null;
    G.state = createRun({ seed: (Date.now() >>> 0), chapterIndex: 0 });
    draw();
  };
  wrap.querySelector('#back').onclick = () => { G.mode = null; drawMenu(); };
}

function applySolo(action) {
  const st = G.state;
  switch (action.type) {
    case 'king': moveKing(st, action.to); break;
    case 'battle': battleAction(st, action.action); break;
    case 'loot': chooseLoot(st, action.idx); break;
    case 'promote': choosePromote(st, { unitId: action.unitId, type: action.piece }); break;
    case 'rest': chooseRest(st, { kind: action.kind, unitId: action.unitId }); break;
    case 'event': chooseEvent(st, action.idx); break;
    case 'advance': advanceChapter(st); break;
    default: break;
  }
  G.selected = null;
}

function dispatch(action) {
  if (G.mode === 'solo') {
    applySolo(action);
    draw();
  } else if (G.mode === 'coop' && G.net) {
    if (action.type === 'battle') G.selected = null;
    G.net.send({ type: 'action', action });
  }
}

function doRestart() {
  if (G.mode === 'solo') {
    G.selected = null;
    G.state = createRun({ seed: ((Date.now() >>> 0) ^ 0x9e3779b9) >>> 0, chapterIndex: 0 });
    draw();
  } else if (G.mode === 'coop' && G.net) {
    if (G.me === 'p1') G.net.send({ type: 'restart' });
    else toast('等待房主重开');
  }
}

// ----------------------------------------------------------------- 启动
drawMenu();
