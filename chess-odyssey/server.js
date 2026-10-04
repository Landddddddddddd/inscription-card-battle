// 《残局 · 单机/联机主线》——零依赖 Node 服务端
// 职责：
//   1) 静态托管 public/（index.html / js / css）
//   2) 手写 RFC6455 WebSocket，提供双人合作（co-op）联机
//   3) 服务端为权威：持有唯一 campaign 状态，接受玩家动作并广播快照
//
// 运行：node server.js  （默认端口 8080，可用 PORT 环境变量覆盖）

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createRun, moveKing, battleAction, chooseLoot, choosePromote,
  chooseRest, chooseEvent, advanceChapter, currentChapter,
} from './public/js/campaign.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ----------------------------------------------------------------- 静态托管
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 防目录穿越
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ----------------------------------------------------------------- 房间 / 权威状态
/** rooms: code -> { code, players:[ws|null, ws|null], state, started, seed } */
const rooms = new Map();

function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (rooms.has(code));
  return code;
}

function sanitize(state) {
  // 状态为纯数据（无函数/循环引用），直接结构化克隆以便广播
  return JSON.parse(JSON.stringify(state));
}

function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of room.players) {
    if (ws && ws.readyState === 1) ws.send(msg);
  }
}

function broadcastState(room) {
  broadcast(room, { type: 'state', state: sanitize(room.state), chapter: currentChapter(room.state).title });
}

// 把客户端动作应用到权威状态（slot 用于战斗中的单位归属）
function applyToState(room, slot, action) {
  const st = room.state;
  if (!st || st.over) return;
  switch (action.type) {
    case 'king':
      if (st.phase === 'map') moveKing(st, action.to);
      break;
    case 'battle': {
      const a = action.action || {};
      a.who = slot; // 服务端盖章归属，引擎据此校验「这不是你的棋子」
      if (st.phase === 'battle') battleAction(st, a);
      break;
    }
    case 'loot':
      if (st.phase === 'loot') chooseLoot(st, action.idx | 0);
      break;
    case 'promote':
      if (st.phase === 'promote') choosePromote(st, { unitId: action.unitId, type: action.piece });
      break;
    case 'rest':
      if (st.phase === 'rest') chooseRest(st, { kind: action.kind, unitId: action.unitId });
      break;
    case 'event':
      if (st.phase === 'event') chooseEvent(st, action.idx | 0);
      break;
    case 'advance':
      if (st.phase === 'chapterEnd') advanceChapter(st);
      break;
    default:
      break;
  }
}

function leaveRoom(room, ws) {
  const idx = room.players.indexOf(ws);
  if (idx >= 0) room.players[idx] = null;
  const others = room.players.filter((p) => p && p !== ws);
  for (const o of others) if (o.readyState === 1) o.send(JSON.stringify({ type: 'peerLeft' }));
}

// ----------------------------------------------------------------- WebSocket
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);

  const ws = makeWs(socket);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleMessage(ws, msg);
  });
  ws.on('close', () => {
    if (ws.room) leaveRoom(ws.room, ws);
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'host': {
      const code = genCode();
      const room = { code, players: [ws, null], state: null, started: false };
      rooms.set(code, room);
      ws.room = room; ws.slot = 'p1';
      ws.send(JSON.stringify({ type: 'roomCreated', code, slot: 'p1' }));
      break;
    }
    case 'join': {
      const room = rooms.get(msg.code);
      if (!room) { ws.send(JSON.stringify({ type: 'error', message: '房间不存在' })); break; }
      if (room.started) { ws.send(JSON.stringify({ type: 'error', message: '对局已开始' })); break; }
      if (room.players[1]) { ws.send(JSON.stringify({ type: 'error', message: '房间已满' })); break; }
      room.players[1] = ws;
      ws.room = room; ws.slot = 'p2';
      ws.send(JSON.stringify({ type: 'joined', code: room.code, slot: 'p2' }));
      if (room.players[0] && room.players[0].readyState === 1)
        room.players[0].send(JSON.stringify({ type: 'peerJoined', slot: 'p2' }));
      break;
    }
    case 'start': {
      const room = ws.room;
      if (!room || ws.slot !== 'p1') { ws.send(JSON.stringify({ type: 'error', message: '只有房主可开始' })); break; }
      if (room.players[1] == null) { ws.send(JSON.stringify({ type: 'error', message: '等待队友加入' })); break; }
      room.state = createRun({ seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, coop: true, chapterIndex: 0 });
      room.started = true;
      broadcast(room, { type: 'started' });
      broadcastState(room);
      break;
    }
    case 'restart': {
      const room = ws.room;
      if (!room || ws.slot !== 'p1') { ws.send(JSON.stringify({ type: 'error', message: '只有房主可重开' })); break; }
      room.state = createRun({ seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, coop: true, chapterIndex: 0 });
      broadcastState(room);
      break;
    }
    case 'action': {
      const room = ws.room;
      if (!room || !room.started) break;
      console.error('[svr] action', ws.slot, JSON.stringify(msg.action).slice(0, 80));
      try {
        applyToState(room, ws.slot, msg.action || {});
        console.error('[svr] applied phase=', room.state.phase);
        broadcastState(room);
        console.error('[svr] broadcasted');
      } catch (e) {
        console.error('[svr] ACTION ERROR', e && e.stack || e);
      }
      break;
    }
    default:
      break;
  }
}

// 极简 WebSocket 封装（仅实现文本帧 + 关闭）
function makeWs(socket) {
  const ws = {
    socket,
    readyState: 1,
    room: null,
    slot: null,
    _buf: Buffer.alloc(0),
    send(data) {
      socket.write(encodeFrame(String(data)));
    },
    on(type, cb) {
      if (type === 'message') ws._onMessage = cb;
      else if (type === 'close') ws._onClose = cb;
    },
  };
  socket.on('data', (chunk) => {
    ws._buf = Buffer.concat([ws._buf, chunk]);
    let frame;
    while ((frame = decodeFrame(ws._buf))) {
      ws._buf = ws._buf.slice(frame.consumed);
      if (frame.opcode === 0x8) { // close
        socket.end(); ws.readyState = 3; ws._onClose && ws._onClose(); return;
      } else if (frame.opcode === 0x9) { // ping → pong
        socket.write(encodeFrame(frame.payload, 0xA)); // pong
      } else if (frame.opcode === 0x1) { // text
        ws._onMessage && ws._onMessage(frame.payload.toString('utf8'));
      }
    }
  });
  socket.on('close', () => { ws.readyState = 3; ws._onClose && ws._onClose(); });
  socket.on('error', () => { ws.readyState = 3; ws._onClose && ws._onClose(); });
  return ws;
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) === 0x80;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) === 0x80;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2)); offset = 10;
  }
  let mask = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.slice(offset, offset + 4); offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.slice(offset, offset + len);
  if (masked) {
    const out = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i % 4];
    payload = out;
  }
  return { fin, opcode, payload, consumed: offset + len };
}

function encodeFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

server.listen(PORT, () => {
  console.log(`《残局》服务端已启动： http://localhost:${PORT}  （联机端口相同）`);
});
