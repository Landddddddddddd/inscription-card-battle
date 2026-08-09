// Zero-dependency Node server:
//  - serves the static client from /public
//  - authoritative game sessions per room (uses the shared engine)
//  - LAN transport via Server-Sent Events (state push) + plain POST (actions)
// No external npm packages required.

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createGame, applyAction } from './public/js/engine.js';
import { DECKS, CARDS, CONFIG, normalizeRules, deckMatchesScope, SCOPE_NAMES, rulesSummary } from './public/js/constants.js';

// Reject decks containing unknown card ids (a malformed client deck must never
// crash the server). Returns { ok:true, deck } or { ok:false, error }.
function sanitizeDeck(deck) {
  if (!Array.isArray(deck)) return { ok: false, error: '卡组格式错误' };
  const clean = deck.filter((id) => CARDS[id]);
  if (clean.length < CONFIG.DECK_MIN) {
    return { ok: false, error: `卡组至少 ${CONFIG.DECK_MIN} 张` };
  }
  return { ok: true, deck: clean.slice(0, CONFIG.DECK_MAX) };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const rooms = new Map();
const genCode = () => Math.random().toString(36).slice(2, 7).toUpperCase();

function serveStatic(req, res) {
  // Defensive: req.url can be undefined/'' on the bare '/' request in some
  // Node builds (parser race) — normalize before use.
  let url = (req.url || '/').split('?')[0];
  if (url === '' || url === '/') url = '/index.html';
  if (url === '/') url = '/index.html';
  const fp = path.join(PUBLIC, path.normalize(url));
  if (!fp.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
      // Dev-friendly: never let the browser cache the client during local play,
      // otherwise edits to ui.js/style.js silently fail to show on refresh.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
}

function broadcast(room, msg) {
  const r = rooms.get(room);
  if (!r) return;
  const s = JSON.stringify(msg);
  for (const c of r.clients) {
    try { c.res.write(`data: ${s}\n\n`); } catch (e) { /* ignore */ }
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function handleApi(req, res) {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    let json = {};
    try { json = JSON.parse(body || '{}'); } catch (e) { /* ignore */ }
    const url = req.url.split('?')[0];

    if (req.method === 'POST' && url === '/api/create') {
      const code = genCode();
      const rules = normalizeRules(json.rules);   // custom room rules (lanes/win/draw/scope)
      const sd = sanitizeDeck(Array.isArray(json.deck) ? json.deck : DECKS.blood);
      if (!sd.ok) return sendJson(res, 400, { error: sd.error });
      const deckA = sd.deck;
      if (!deckMatchesScope(deckA, rules.deckScope)) {
        return sendJson(res, 400, { error: `房间规则限定「${SCOPE_NAMES[rules.deckScope]}」，你的卡组不符合` });
      }
      const resA = json.res || 'blood';
      // guest placeholder until they join — pick the scoped faction's default deck
      const resB = rules.deckScope !== 'all' ? rules.deckScope : 'blood';
      const deckB = DECKS[resB] || DECKS.blood;
      const avatarA = json.avatar || '🜁';
      const state = createGame({
        nameA: json.name || '房主', nameB: '挑战者', avatarA, avatarB: '🜁',
        deckA, resA, deckB, resB, rules,
      });
      const tokenA = 'A' + Math.random().toString(36).slice(2, 8);
      rooms.set(code, {
        state,
        players: { A: tokenA, B: null },
        clients: [],
        cfg: { deckA, resA, deckB, resB, rules, avatarA },
      });
      return sendJson(res, 200, { room: code, token: tokenA, side: 'A', rules });
    }

    if (req.method === 'GET' && url === '/api/roominfo') {
      const q = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const r = rooms.get((q.get('room') || '').toUpperCase());
      if (!r) return sendJson(res, 404, { error: '房间不存在' });
      return sendJson(res, 200, { rules: r.cfg.rules, full: !!r.players.B, summary: rulesSummary(r.cfg.rules) });
    }

    if (req.method === 'POST' && url === '/api/join') {
      const r = rooms.get(json.room);
      if (!r) return sendJson(res, 404, { error: '房间不存在' });
      if (r.players.B) return sendJson(res, 409, { error: '房间已满' });
      const rules = r.cfg.rules || normalizeRules(null);
      const sd = sanitizeDeck(Array.isArray(json.deck) ? json.deck : r.cfg.deckB);
      if (!sd.ok) return sendJson(res, 400, { error: sd.error });
      const deckB = sd.deck;
      if (!deckMatchesScope(deckB, rules.deckScope)) {
        return sendJson(res, 400, { error: `本房间限定「${SCOPE_NAMES[rules.deckScope]}」卡组，请重新组卡` });
      }
      const resB = json.res || r.cfg.resB;
      r.cfg.deckB = deckB; r.cfg.resB = resB;
      // rebuild the match now that both decks are known (room rules apply)
      try {
        r.state = createGame({
          nameA: r.state.players.A.name, nameB: json.name || '挑战者',
          deckA: r.cfg.deckA, resA: r.cfg.resA,
          deckB, resB, rules, avatarA: r.cfg.avatarA, avatarB: json.avatar || '🜁',
        });
      } catch (e) {
        return sendJson(res, 400, { error: '卡组无效: ' + e.message });
      }
      const tokenB = 'B' + Math.random().toString(36).slice(2, 8);
      r.players.B = tokenB;
      sendJson(res, 200, { room: json.room, token: tokenB, side: 'B', rules });
      broadcast(json.room, { type: 'start' });
      broadcast(json.room, { type: 'state', state: r.state });
      return;
    }

    if (req.method === 'GET' && url === '/api/state') {
      const q = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const r = rooms.get(q.get('room'));
      if (!r) return sendJson(res, 404, { error: '房间不存在' });
      return sendJson(res, 200, r.state);
    }

    if (req.method === 'GET' && url === '/api/events') {
      const q = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const code = q.get('room');
      const token = q.get('token');
      const r = rooms.get(code);
      if (!r) { res.writeHead(404); return res.end('no room'); }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 3000\n\n');
      const side = token === r.players.A ? 'A' : token === r.players.B ? 'B' : '?';
      const client = { token, res };
      r.clients.push(client);
      res.write(`data: ${JSON.stringify({ type: 'state', state: r.state, you: side })}\n\n`);
      res.on('close', () => { r.clients = r.clients.filter((c) => c !== client); });
      return;
    }

    if (req.method === 'POST' && url === '/api/action') {
      const r = rooms.get(json.room);
      if (!r) return sendJson(res, 404, { error: '房间不存在' });
      const side = json.token === r.players.A ? 'A' : json.token === r.players.B ? 'B' : null;
      if (!side) return sendJson(res, 403, { error: '无效身份' });
      const action = json.action || {};
      action.player = side;
      const result = applyAction(r.state, action);
      if (result.ok) broadcast(json.room, { type: 'state', state: r.state });
      return sendJson(res, 200, result);
    }

    res.writeHead(404);
    res.end('not found');
  });
}

const server = http.createServer((req, res) => {
  const u = req.url || '/';
  if (u.startsWith('/api/')) return handleApi(req, res);
  serveStatic(req, res);
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('=============================================');
  console.log('  邪刻 · 本地联机版  已启动');
  console.log('=============================================');
  console.log(`  本机访问 : http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  局域网访问: http://${ip}:${PORT}`);
  console.log('  把本机 IP 和房间号发给好友即可联机。');
  console.log('=============================================');
});
