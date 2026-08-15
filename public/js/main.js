// App controller: login, screen routing, single/AI, LAN, ONLINE(P2P), tutorial, collection, gacha.
import { createGame, playCard, endTurn, applyAction, instantiate } from './engine.js';
import { DECKS, CONFIG, FACTIONS, defaultDeck, DEFAULT_RULES, normalizeRules, SCOPE_NAMES, CARDS, defaultWinScaleFor, winModeName, winModeDesc, winScaleOptions, WIN_SCALE_CAP, isCostedCard, RECHARGE_PACKAGES, GEM_EXCHANGE, RANK, rankLabel, isTopRank } from './constants.js';
import { aiTakeTurn } from './ai.js';
import * as UI from './ui.js';
import { canPlayCard, renderTutSetup, TUT_MODULES, renderHowTo, changelogHTML } from './ui.js';
import { NetClient } from './network.js';
import { OnlineNet } from './net.js';
import { loadProfile, createProfile, saveProfile, drawPack, drawGemPack, buyCardDirect, recharge, exchangeGemsForCoins, recordResult, recordRanked, saveDeck, AVATARS, randomAvatar } from './profile.js';
import { unlockAudio, setMuted, isMuted, loadMute, playSfx } from './audio.js';

const App = {
  mode: null, me: 'A', state: null, net: null, online: null,
  ui: { selectedIid: null, sacList: [] },
  status: '', tut: null,
  builder: null, deck: null, deckA: null, deckB: null, _hotseatStep: 'A',
  rules: { ...DEFAULT_RULES },   // custom match rules (host/single/onlineHost); persisted in profile
  joinRules: null,               // rules of the room being joined (read-only, from host / LAN roominfo)
  onlineJoinInfo: null,          // { rules, host:{name,avatar} } received from host in online mode
  profile: null,
  coll: { faction: 'blood' },
  rewardGiven: false,
  aiLevel: 'normal',
  kb: { handIdx: -1, laneIdx: 0 },
};

const $ = (id) => document.getElementById(id);
const SCREENS = ['login', 'menu', 'collection', 'deckBuilder', 'game', 'tutorialSetup', 'howto', 'changelog', 'ranked'];

// Resume the AudioContext on the very first user gesture (browsers block audio
// until then). unlockAudio is idempotent and safe if Web Audio is unavailable.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true });
function show(screen) { for (const s of SCREENS) $(s).classList.toggle('hidden', s !== screen); }

const isMyTurn = () => !!App.state && App.state.currentPlayer === App.me && !App.state.over;
const canAct = () => (App.online ? App.online._open : (App.net ? App.net.ready : true)) && isMyTurn();
const unlockedSet = () => new Set(App.profile ? App.profile.unlocked : []);

// 有费卡（含需特定魔石的魔石法术卡）在卡组中每张最多 1 份；只有真正的 0 费免费卡
// （如松鼠 / 魔石生物）才能重复（上限 ZERO_COST_MAX）。对应需求：魔石中需特定宝石
// 才能召唤的卡最多只能选 1 张。
function maxCopies(id) {
  return isCostedCard(id) ? 1 : CONFIG.ZERO_COST_MAX;
}

function modeLabel() {
  return {
    single: '单机模式 · 对战 AI', tutorial: '新手教程',
    host: '本地联机 · 房主', join: '本地联机 · 挑战者',
    onlineHost: '线上联机 · 房主', onlineJoin: '线上联机 · 挑战者',
    rankedHost: '排位赛 · 线上房主', rankedJoin: '排位赛 · 线上挑战者',
    hotseat: '本地双人 · 同屏',
    ranked: '排位赛 · 同屏对战',
  }[App.mode] || '';
}

function render() {
  if (!App.state) return;
  UI.renderGame({ state: App.state, me: App.me, isMyTurn: canAct(), ui: App.ui, statusMsg: App.status, modeLabel: modeLabel(), kb: App.kb, kbArmed: !!App.ui.selectedIid && canAct() });
}

// ---------- Login / Menu ----------
function bootLogin() {
  const p = loadProfile();
  if (p) {
    App.profile = p;
    loadMute(p.muted);
    $('loginName').value = p.name;
    $('loginReturning').textContent = `欢迎回来，${p.name}。金币 ✦${p.coins} · 魂晶 💎${p.gems || 0}，直接进入即可。`;
    $('loginReturning').classList.remove('hidden');
  }
  renderAvatarPicker();
  show('login');
}
function doLogin() {
  const name = ($('loginName').value || '').trim() || '无名者';
  if (App.profile && App.profile.name === name) { /* returning */ }
  else if (App.profile) { App.profile.name = name.slice(0, 12); saveProfile(App.profile); }
  else { App.profile = createProfile(name); }
  App.aiLevel = App.profile.aiLevel || 'normal';
  applyLayout();
  // Restore the last-used deck from the profile (persisted across sessions).
  if (App.profile.deck && Array.isArray(App.profile.deck.cards) && App.profile.deck.cards.length) {
    App.deck = { res: App.profile.deck.res, cards: App.profile.deck.cards.slice() };
  }
  // Restore last-used custom rules too.
  if (App.profile.rules) App.rules = normalizeRules(App.profile.rules);
  toMenu();
  // If the app was opened from a shared invite link, jump into the online join flow.
  if (window.__autoJoin) {
    const aj = window.__autoJoin; window.__autoJoin = null;
    App._onlineManual = !!aj.m;
    if (aj.join) $('joinRoom').value = aj.join;
    openBuilder('onlineJoin');
  }
  // Ranked P2P invite link (?rjoin=CODE) → straight into the ranked join flow.
  if (window.__autoRankedJoin) {
    const code = window.__autoRankedJoin; window.__autoRankedJoin = null;
    App.rules = { ...DEFAULT_RULES }; App._pendingRankedCode = code;
    openBuilder('rankedJoin');
  }
}
function logout() { toMenu(); bootLogin(); }

// When served from a non-localhost origin (i.e. the public static deploy), the
// Node-backed LAN matchmaking is unavailable. Hide those controls; online P2P still works.
function applyEnvMode() {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '';
  document.querySelectorAll('[data-lan]').forEach((el) => {
    el.classList.toggle('hidden', !local);
  });
}

function showGame() { show('game'); UI.hideOverlay(); UI.hideGameOver(); UI.resetGameView(); }

function toMenu() {
  if (App.net) { App.net.close(); App.net = null; }
  if (App.online) { App.online.close(); App.online = null; }
  App.state = null; App.status = ''; App.me = 'A';
  App.ui = { selectedIid: null, sacList: [] }; App.rewardGiven = false; App.onlineJoinInfo = null;
  UI.hideOverlay(); UI.hideGameOver(); UI.hideOnlineLobby();
  $('hostInfo').classList.add('hidden');
  if (App.profile) UI.renderTopChip(App.profile);
  updateSoundBtn();
  applyLayout();
  document.querySelectorAll('#aiDiff .dbtn').forEach((b) => b.classList.toggle('on', b.dataset.diff === App.aiLevel));
  applyEnvMode();
  probeServerStatus();
  show('menu');
}

// 在菜单上展示联机可用性：非本机部署时说明 P2P 模式；本机部署时探测 server.js 是否在运行。
async function probeServerStatus() {
  const el = $('onlineHint'); if (!el) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '';
  if (!local) {
    el.innerHTML = '🌐 <b>线上联机</b>：点对点直连，无需服务器；若信令服务不可用会自动改用「邀请码」模式。';
    el.classList.remove('hidden');
    return;
  }
  el.innerHTML = '🔍 正在检测本地联机服务器…';
  el.classList.remove('hidden');
  let up = false;
  try {
    const r = await fetch('/api/roominfo?room=__probe__', { cache: 'no-store' });
    const t = await r.text();
    JSON.parse(t); // server 返回 JSON（即使是 404 错误）；静态托管返回 HTML → 解析失败。
    up = true;
  } catch (e) { up = false; }
  el.innerHTML = up
    ? '✅ 检测到联机服务器 ——「本地联机」可用（同局域网好友用本机地址加入）。'
    : '⚠️ 未检测到联机服务器：「本地联机」需在本机先运行 <code>node server.js</code>。';
}

// ---------- Local action application ----------
function applyLocal(action) {
  let r;
  if (action.type === 'play') r = playCard(App.state, App.me, action.iid, action.lane, { sacrifices: action.sacrifices });
  else if (action.type === 'endTurn') r = endTurn(App.state, App.me);
  else return;
  if (!r.ok) { App.status = r.reason; render(); return; }
  if (action.type === 'play') {
    if (action.sacrifices && action.sacrifices.length) playSfx('sacrifice');
    else playSfx('play');
  }
  App.ui.selectedIid = null; App.ui.sacList = []; App.status = '';
  render();
  if (App.mode === 'tutorial') tutorialCheck(action.type);
  if (!App.state.over && App.state.currentPlayer === 'B' && (App.mode === 'single' || App.mode === 'tutorial')) runAI();
  checkGameOver();
  // 同屏双人 / 排位赛（同屏）：每次「结束回合 / 攻击」后，把设备交给下一位玩家（防止偷看手牌）。
  // 线上 P2P 排位各自用自己设备，无需交接。
  if ((App.mode === 'hotseat' || App.mode === 'ranked') && action.type === 'endTurn' && !App.state.over) {
    const np = App.state.players[App.state.currentPlayer].name;
    UI.showHandoff('请把设备交给 ' + np + '，轮到 ' + np + ' 行动——点击继续');
  }
}

// Send an action. In online mode the host is authoritative (applies + broadcasts);
// the guest simply forwards the action to the host.
function act(action) {
  if (App.mode === 'onlineHost' || App.mode === 'rankedHost') {
    action.player = 'A';
    const r = applyAction(App.state, action);
    if (!r.ok) { App.status = r.reason; render(); return; }
    App.ui.selectedIid = null; App.ui.sacList = []; App.status = '';
    render();
    if (App.online) App.online.send({ type: 'state', state: App.state });
    checkGameOver();
    return;
  }
  if (App.mode === 'onlineJoin' || App.mode === 'rankedJoin') {
    App.ui.selectedIid = null; App.ui.sacList = []; App.status = '同步中…'; render();
    if (App.online) App.online.send({ type: 'action', action });
    return;
  }
  if (App.net) { App.ui.selectedIid = null; App.ui.sacList = []; App.status = '同步中…'; render(); App.net.send(action); return; }
  applyLocal(action);
}

function runAI() {
  setTimeout(() => {
    if (App.mode !== 'single' && App.mode !== 'tutorial') return;
    if (App.state.over || App.state.currentPlayer !== 'B') return;
    aiTakeTurn(App.state, App.aiLevel || 'normal');
    App.ui.selectedIid = null; render(); checkGameOver();
  }, 700);
}

function checkGameOver() {
  if (!App.state || !App.state.over) return;
  // 排位赛结算（仅限 PVP）：账户段位跟随本账号「你」的胜负升降，不发放金币。
  // 同屏：固定玩家A；线上 P2P：房主=A、挑战者=B，各自结算自己的段位。
  if ((App.mode === 'ranked' || App.mode === 'rankedHost' || App.mode === 'rankedJoin') && !App.rewardGiven) {
    App.rewardGiven = true;
    const won = (App.mode === 'ranked') ? (App.state.winner === 'A') : (App.state.winner === App.me);
    const r = recordRanked(App.profile, won);
    const sub = r.promoted
      ? `🎉 晋级！当前段位：${rankLabel(r.rank)}`
      : r.demoted
        ? `⬇ 降级……当前段位：${rankLabel(r.rank)}`
        : `当前段位：${rankLabel(r.rank)} · 晋级分 ${r.points}/${RANK.DIV_PROMOTE}` + (r.top ? '（已登顶六阶·上！）' : '');
    const txt = won ? '🏆 排位胜利！天平被你压垮了。' : '💀 排位失利……对手压垮了天平。';
    if (won) playSfx('win'); else playSfx('lose');
    UI.renderTopChip(App.profile);
    const tag = (App.mode === 'rankedHost' || App.mode === 'rankedJoin') ? '（线上排位 P2P）' : '';
    UI.showGameOver(txt + tag, sub);
    return;
  }
  const win = App.state.winner === App.me;
  let reward = '';
  if (!App.rewardGiven && App.profile && (App.mode === 'single' || App.mode === 'host' || App.mode === 'join' || App.mode === 'onlineHost' || App.mode === 'onlineJoin')) {
    App.rewardGiven = true;
    const gained = recordResult(App.profile, win);
    reward = `金币 +${gained}（当前 ✦${App.profile.coins} · 💎${App.profile.gems || 0}）`;
    UI.renderTopChip(App.profile);
  }
  const txt = win ? '🏆 你赢了！天平被你压垮了。' : '💀 你输了……对手压垮了天平。';
  if (win) playSfx('win'); else playSfx('lose');
  UI.showGameOver(txt + (App.mode === 'onlineHost' || App.mode === 'onlineJoin' ? '（线上对局）' : ''), reward);
}

// ---------- Tutorial (self-selectable content + faction-aware) ----------
function showTutStep() {
  if (!App.tut || !App.tut.steps) { UI.hideOverlay(); return; }
  const step = App.tut.steps[App.tut.step];
  if (!step) { UI.hideOverlay(); return; }
  UI.showOverlay(step.text, step.need == null);
}
function tutorialCheck(t) {
  if (!App.tut || !App.tut.steps) return;
  const step = App.tut.steps[App.tut.step];
  if (step && step.need === t) { App.tut.step++; showTutStep(); }
}
function tutNext() { if (!App.tut) return; App.tut.step++; showTutStep(); }

// Short description of each faction's resource, used inside tutorial text.
function resDescShort(fac) {
  return { blood: '献祭场上单位换血肉（无无偿投放）', bone: '生物死亡/每回合积累骸骨', energy: '每回合回能（封顶 6）', mox: '场上魔石生物提供魔石' }[fac] || '';
}
function sigilsIntro() {
  return '【印记特性】卡牌可能携带「印记」，常见有：\n'
    + '· 飞行：越过地面阻挡直击天平，仅被飞行单位挡。\n'
    + '· 毒触：攻击时额外 +1 伤害。\n'
    + '· 尖刺：被攻击时，攻击它的单位反受 1 点伤害。\n'
    + '· 连击：每次攻击造成两次伤害。\n'
    + '· 不死：首次死亡返回手牌。\n'
    + '· 头狼：相邻友方攻击 +1。\n'
    + '· 断尾：死亡时随机获得一只松鼠。\n'
    + '· 易碎：攻击一次后立即碎裂。\n'
    + '· 致死：造成的任何伤害都直接杀死目标。\n'
    + '· 厚甲：受到的伤害 −1。';
}
function modesIntro() {
  return '【模式与胜负】\n'
    + '· 四种模式：单机（对战 AI）、本地双人（同屏轮流）、本地联机（同局域网）、线上联机（P2P 直连）。\n'
    + '· 两种胜利条件（可在建房/单机的规则面板自选）：\n'
    + `  ▸ 分数差：比拼双方分数差，先拉开到目标分（默认 ${defaultWinScaleFor('difference')} 分）者胜，拉锯更激烈。\n`
    + `  ▸ 累计分数：各自累计未阻挡攻击分数，先达到目标分（默认 ${defaultWinScaleFor('absolute')} 分）者胜。\n`
    + '· 先手方开局天平 −1 作为平衡修正。';
}

// Build the tutorial step list from the player's chosen modules, in a sensible
// teaching order. The faction-aware "play" step explains that faction's resource.
function buildTutSteps(fac, mods) {
  const F = FACTIONS[fac];
  const mk = (key) => {
    switch (key) {
      case 'goal':
        return { text: `欢迎来到《邪刻》！\n\n【目标】把对方天平的指针压到己方一端即获胜。本局采用「${winModeName(App.rules.winMode)}」胜利方式，目标 ${App.rules.winScale} 分——顶部天平实时显示你与对手的分数。`, need: null };
      case 'play':
        return fac === 'blood'
          ? { text: '【出牌 · 血肉】点手牌选中一张牌→点空列即可召唤。\n血肉阵营没有任何无偿投放的血肉：所有费用都靠献祭场上已召唤的单位来支付。先把小怪（如「白鼬」免费 0 费或场上已有的单位）召唤/铺到场上，选中要打的牌时，点场上单位把它献祭补足费用，再点空列召唤。', need: 'play' }
          : { text: `【出牌 · ${F.name}】点手牌选中一张牌→点空列即可召唤。本阵营用「${F.name}」资源（${resDescShort(fac)}），资源够就能召唤。先放一只生物试试。`, need: 'play' };
      case 'attack':
        return { text: '【攻击】布置好后点「结束回合 / 攻击」。你的单位发动攻击：同列有敌人则交战，否则直接打对方天平加分。把指针推向你这一端即靠近胜利。现在结束回合试一次。', need: 'endTurn' };
      case 'sigils':
        return { text: sigilsIntro(), need: null };
      case 'faction':
        return { text: `【本局阵营：${F.name}】\n${F.desc}\n对手是「骸骨」阵营，机制不同——多打几局感受差异。`, need: null };
      case 'modes':
        return { text: modesIntro(), need: null };
    }
    return null;
  };
  const steps = [];
  for (const m of TUT_MODULES) if (mods.has(m.id)) { const s = mk(m.id); if (s) steps.push(s); }
  if (!steps.length) steps.push({ text: '（未选择内容，直接开始练习，自由对局吧）', need: null });
  return steps;
}

const TUT_SCENARIO = {
  blood:  { hand: ['squirrel', 'stoat', 'squirrel', 'raven'], board: ['squirrel'] },
  bone:   { hand: ['bone_pup', 'rat', 'bat', 'bone_pup'],      board: [] },
  energy: { hand: ['black_cat', 'magpie', 'falcon', 'black_cat'], board: [] },
  mox:    { hand: ['ruby_mox', 'imp', 'sprite', 'ruby_mox'],   board: ['ruby_mox'] },
};
// Give the tutorial a guaranteed hand + (for blood/mox) a pre-placed creature,
// so the interactive practice steps can never get the player stuck.
function setupTutorialScenario(state, fac) {
  const plan = TUT_SCENARIO[fac];
  if (!plan) return;
  const A = state.players.A;
  A.hand = plan.hand.map((id) => instantiate(id));
  for (const id of plan.board) {
    const lane = state.board.A.findIndex((c) => !c);
    if (lane >= 0) state.board.A[lane] = instantiate(id);
  }
}

function isCoreModule(id) { return TUT_MODULES.some((m) => m.id === id && m.core); }

function openTutorial() {
  App.tut = {
    step: 0,
    setup: { faction: 'blood', modules: new Set(['goal', 'play', 'attack', 'sigils', 'faction', 'modes']) },
  };
  UI.renderTutSetup({ faction: App.tut.setup.faction, modules: App.tut.setup.modules, factions: FACTIONS });
  show('tutorialSetup');
}
function beginTutorial() {
  const fac = App.tut.setup.faction;
  const mods = App.tut.setup.modules;
  App.mode = 'tutorial'; App.me = 'A'; App.net = null; App.online = null; App.rewardGiven = false;
  App.state = createGame({
    nameA: '你', avatarA: '🧙', nameB: '对手', avatarB: '👹',
    deckA: DECKS[fac], resA: fac, deckB: DECKS.bone, resB: 'bone',
    rules: { ...DEFAULT_RULES, winMode: App.rules.winMode, winScale: App.rules.winScale },
  });
  setupTutorialScenario(App.state, fac);
  App.ui = { selectedIid: null, sacList: [] };
  App.tut.step = 0;
  App.tut.steps = buildTutSteps(fac, mods);
  showGame(); render(); showTutStep();
}

function openHowTo() { UI.renderHowTo(UI.howToHTML()); show('howto'); }
function openChangelog() { UI.renderChangelog(changelogHTML()); show('changelog'); }

// ---------- Modes ----------
function startSingle() {
  App.mode = 'single'; App.me = 'A'; App.net = null; App.online = null; App.rewardGiven = false;
  const d = App.deck || { res: 'blood', cards: DECKS.blood };
  const scope = App.rules.deckScope;
  const aiRes = scope !== 'all' ? scope : d.res;
  App.state = createGame({
    nameA: App.profile ? App.profile.name : '你', avatarA: App.profile ? App.profile.avatar : '🜁',
    nameB: '电脑', avatarB: '🤖',
    deckA: d.cards, resA: d.res, deckB: defaultDeck(aiRes), resB: aiRes,
    rules: App.rules,
  });
  App.ui = { selectedIid: null, sacList: [] };
  showGame(); render();
}

// 本地双人（同一台电脑）模式：两名玩家同屏轮流，视角随当前行动方翻转。
function startHotseat() {
  App.mode = 'hotseat'; App.me = 'A'; App.net = null; App.online = null; App.rewardGiven = false;
  const dA = App.deckA || { res: 'blood', cards: DECKS.blood };
  const dB = App.deckB || { res: 'bone', cards: DECKS.bone };
  App.state = createGame({
    nameA: '玩家1', avatarA: App.profile ? App.profile.avatar : '🦇',
    nameB: '玩家2', avatarB: '🐯',
    deckA: dA.cards, resA: dA.res, deckB: dB.cards, resB: dB.res,
    rules: App.rules,
  });
  App.ui = { selectedIid: null, sacList: [] };
  showGame(); render();
}

// 回合交接：把视角切到刚行动完、轮到的那一方（me = 当前行动方）。
function hotseatContinue() {
  if (!App.state) return;
  App.me = App.state.currentPlayer;
  App.ui.selectedIid = null; App.ui.sacList = [];
  UI.hideOverlay();
  render();
}

// ---------------- 排位赛（仅限 PVP：同屏双人对战） ----------------
function openRanked() {
  App._hotseatStep = 'A';
  UI.renderRanked(App.profile);
  show('ranked');
}
function startRanked() {
  App.mode = 'ranked'; App.me = 'A'; App.net = null; App.online = null; App.rewardGiven = false;
  const dA = App.deckA || { res: 'blood', cards: DECKS.blood };
  const dB = App.deckB || { res: 'bone', cards: DECKS.bone };
  App.state = createGame({
    nameA: (App.profile ? App.profile.name : '玩家1') + '（你）', avatarA: App.profile ? App.profile.avatar : '🦇',
    nameB: '对手', avatarB: '🐯',
    deckA: dA.cards, resA: dA.res, deckB: dB.cards, resB: dB.res,
    rules: App.rules,
  });
  App.ui = { selectedIid: null, sacList: [] };
  showGame(); render();
}

// ---------------- LAN (local server) ----------------
async function startHost() {
  const d = App.deck || { res: 'blood', cards: DECKS.blood };
  let data;
  try {
    const res = await fetch('/api/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: App.profile ? App.profile.name : '房主', avatar: App.profile ? App.profile.avatar : '🜁', res: d.res, deck: d.cards, rules: App.rules }) });
    data = await res.json();
  } catch (e) {
    alert('未检测到联机服务器。\n\n若要用「本地联机」，请在本机运行：\n    node server.js\n然后刷新页面再创建房间（同一局域网内的好友用你的电脑地址加入）。\n\n若想在互联网上直接对战，请改用「🌍 线上联机」（点对点，无需服务器）。');
    toMenu(); return;
  }
  if (data.error) { alert(data.error); return; }
  App.mode = 'host'; App.me = data.side; App.net = null; App.rewardGiven = false;
  App.ui = { selectedIid: null, sacList: [] };
  const addr = window.location.host;
  const ruleTxt = `场地${App.rules.lanes}列 · 胜利${App.rules.winScale}分 · 抽${App.rules.drawPerTurn}张/轮 · ${SCOPE_NAMES[App.rules.deckScope]}`;
  $('hostInfo').classList.remove('hidden');
  $('hostInfo').innerHTML = `房间已创建！把下面信息发给好友：<br>地址：<code>${addr}</code><br>房间号：<code>${data.room}</code><br>房间规则：<code>${ruleTxt}</code><br>好友打开地址后点「加入房间」并输入该房间号。`;
  App.net = new NetClient(data.room, data.token, data.side,
    (state, you) => { App.state = state; if (you) App.me = you; render(); checkGameOver(); },
    () => { App.status = '对手已加入，开始！'; render(); });
  App.state = null; showGame(); App.net.connect(); App.status = '等待对手加入…'; render();
}
async function startJoin() {
  const room = ($('joinRoom').value || '').trim().toUpperCase();
  if (!room) { alert('请输入房间号'); return; }
  const d = App.deck || { res: 'blood', cards: DECKS.blood };
  let data;
  try {
    const res = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, avatar: App.profile ? App.profile.avatar : '🜁', res: d.res, deck: d.cards }) });
    data = await res.json();
  } catch (e) {
    alert('无法连接联机服务器。\n\n请确认：\n① 房主已运行 node server.js；\n② 你和房主在同一局域网（或用房主的公网地址）；\n③ 房间号正确。\n\n若想在互联网上直接对战，请改用「🌍 线上联机」（点对点，无需服务器）。');
    toMenu(); return;
  }
  if (data.error) { alert(data.error); return; }
  App.mode = 'join'; App.me = data.side; App.net = null; App.rewardGiven = false;
  App.ui = { selectedIid: null, sacList: [] };
  App.net = new NetClient(data.room, data.token, data.side,
    (state, you) => { App.state = state; if (you) App.me = you; render(); checkGameOver(); },
    () => { App.status = '已连接，开始！'; render(); });
  App.state = null; showGame(); App.net.connect(); App.status = '连接中…'; render();
}

// ---------------- ONLINE (P2P) ----------------
function onlineMsgHandler(msg) {
  // Host side (authoritative): both casual and ranked hosts run identical logic.
  if (App.mode === 'onlineHost' || App.mode === 'rankedHost') {
    if (msg.type === 'hello') {
      App._guestProfile = msg.profile;
      if (App.online) App.online.send({ type: 'roomInfo', rules: App.rules, host: { name: App.profile.name, avatar: App.profile.avatar } });
    } else if (msg.type === 'join') {
      // Validate deck scope, then build the authoritative game and start.
      const scope = App.rules.deckScope;
      if (scope !== 'all' && msg.res !== scope) {
        if (App.online) App.online.send({ type: 'error', msg: `房间限定「${SCOPE_NAMES[scope]}」卡组` });
        return;
      }
      const myD = App.deck || { res: 'blood', cards: DECKS.blood };
      App.state = createGame({
        nameA: App.profile.name, avatarA: App.profile.avatar,
        nameB: msg.profile.name, avatarB: msg.profile.avatar,
        deckA: myD.cards, resA: myD.res, deckB: msg.deck, resB: msg.res, rules: App.rules,
      });
      App.me = 'A'; App.rewardGiven = false;
      App.ui = { selectedIid: null, sacList: [] };
      UI.hideOnlineLobby();
      showGame(); render();
      if (App.online) App.online.send({ type: 'start', state: App.state });
    } else if (msg.type === 'action') {
      msg.action.player = 'B';
      const r = applyAction(App.state, msg.action);
      if (!r.ok) { if (App.online) App.online.send({ type: 'state', state: App.state }); return; }
      App.ui.selectedIid = null; render();
      if (App.online) App.online.send({ type: 'state', state: App.state });
      checkGameOver();
    }
    return;
  }
  // Guest side
  if (App.mode === 'onlineJoin' || App.mode === 'rankedJoin') {
    if (msg.type === 'roomInfo') {
      App.onlineJoinInfo = { rules: normalizeRules(msg.rules), host: msg.host };
      App.joinRules = normalizeRules(msg.rules);
      // Show the (read-only) rules panel and open the builder on the scoped faction.
      UI.hideRulesPanel();
      UI.hideOnlineLobby();
      const panel = $('rulesPanel');
      panel.innerHTML = `<div class="rules-title">⚙ 房间规则（由房主设定）</div><div class="rules-note">${UI.rulesSummaryText(App.joinRules)}</div>`;
      panel.classList.remove('hidden');
      if (App.joinRules.deckScope !== 'all') App.builder.faction = App.joinRules.deckScope;
      renderBuilder();
    } else if (msg.type === 'start' || msg.type === 'state') {
      // Hide the lobby / waiting overlay once the match is live.
      UI.hideOnlineLobby(); UI.hideOverlay();
      App.state = msg.state; App.me = 'B'; App.status = '';
      if (!$('game').classList.contains('hidden')) render(); else { showGame(); render(); }
      checkGameOver();
    } else if (msg.type === 'error') {
      alert('无法加入：' + (msg.msg || '规则不符'));
      toMenu();
    }
  }
}

function startOnline(mode, codeOverride) {
  App.mode = mode;
  const manual = App._onlineManual;
  if (!manual) App._switchedManual = false;
  const isHost = mode.endsWith('Host');
  const isRanked = mode === 'rankedHost' || mode === 'rankedJoin';
  const roomCode = isHost ? genRoom() : ((codeOverride || '').trim().toUpperCase() || ($('joinRoom').value || '').trim().toUpperCase());
  App.online = new OnlineNet({
    isHost, roomCode, manual,
    onMessage: onlineMsgHandler,
    onOpen: () => {
      if (isHost) {
        UI.setLobbyStatus('已连接，等待对手加入…');
      } else {
        // Guest: announce presence so host can send room info.
        if (App.online) App.online.send({ type: 'hello', profile: { name: App.profile.name, avatar: App.profile.avatar } });
        UI.setLobbyStatus('已连接，等待房主规则…');
      }
    },
    onClose: () => { if (App.mode) UI.setLobbyStatus('连接已断开'); },
    onError: (e) => {
      // 信令服务（PeerJS）不可用时，自动降级到「邀请码」模式（纯 WebRTC + 公共 STUN，无需任何服务器）。
      if (!manual && !App._switchedManual) {
        App._switchedManual = true;
        App._onlineManual = true;
        if (App.online) { try { App.online.close(); } catch (_) {} App.online = null; }
        UI.setLobbyStatus('点对点信令不可用，已自动切换到「邀请码」模式（无需服务器）…');
        startOnline(mode, codeOverride);
        return;
      }
      UI.setLobbyStatus('连接出错：' + (e && e.message ? e.message : e) + '（可重试，或改用「本地联机」运行服务器）');
    },
    onStatus: (kind, payload) => {
      if (kind === 'wait') {
        // Ranked rooms use ?rjoin= so the invite link opens the ranked flow.
        if (isRanked) App.online.inviteLink = location.origin + location.pathname + '?rjoin=' + payload.roomCode;
        UI.showLobbyOffer({ manual: false, roomCode: payload.roomCode, link: App.online.inviteLink });
      } else if (kind === 'offer') UI.showLobbyOffer({ manual: true, offer: payload.offer, link: payload.link });
      else if (kind === 'answer') UI.showLobbyAnswer(payload.answer);
      else if (kind === 'connecting') UI.setLobbyStatus('正在建立连接…');
    },
  });
  App.online.connect();
  if (isHost) {
    UI.showOnlineLobby({ role: 'host', manual });
    if (manual) UI.setLobbyStatus('正在生成邀请码…');
  } else {
    UI.showOnlineLobby({ role: 'join', manual });
    if (manual) renderManualGuestPrompt();
    else UI.setLobbyStatus('正在通过房号连接…');
  }
}

// Guest manual-mode prompt: paste the host's offer (from ?m= link or clipboard).
function renderManualGuestPrompt() {
  const m = new URLSearchParams(location.search).get('m');
  if (m) { if (App.online) App.online.connectWithOffer(m); UI.setLobbyStatus('已载入邀请码，生成回执中…'); return; }
  $('lobbyBody').innerHTML = `<div class="lobby-step">粘贴房主发来的「邀请码」：</div><textarea id="lobbyOfferIn" class="lobby-code" placeholder="在此粘贴邀请码"></textarea><div class="lobby-actions"><button class="btn small primary" data-ol="pasteOffer">生成回执码</button><button class="btn small ghost" data-ol="lobbyCancel">取消</button></div>`;
  UI.setLobbyStatus('请粘贴房主发来的邀请码');
}

function genRoom() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

// ---------- Deck builder (unlocked-only) ----------
async function openBuilder(mode) {
  App.builder = { mode, faction: 'blood', counts: {} };
  App.joinRules = null;
  App.onlineJoinInfo = null;
  App._pendingRankedCode = null;
  const unlocked = unlockedSet();
  for (const k of ['blood', 'bone', 'energy', 'mox']) {
    let added = 0;
    for (const id of FACTIONS[k].cards) {
      if (!unlocked.has(id)) continue;
      const copies = Math.min(maxCopies(id), CONFIG.DECK_MAX - added);
      App.builder.counts[id] = (App.builder.counts[id] || 0) + copies;
      added += copies;
      if (added >= CONFIG.DECK_MAX) break;
    }
  }
  const last = (mode === 'ranked')
    ? (App._hotseatStep === 'A' ? App.deckA : App.deckB)
    : App.deck;
  if (last && Array.isArray(last.cards) && last.cards.length && FACTIONS[last.res] && mode !== 'hotseat') {
    for (const id of FACTIONS[last.res].cards) App.builder.counts[id] = 0;
    for (const id of last.cards) if (unlocked.has(id)) App.builder.counts[id] = Math.min(maxCopies(id), (App.builder.counts[id] || 0) + 1);
    App.builder.faction = last.res;
  }

  if (mode === 'single' || mode === 'host' || mode === 'onlineHost' || (mode === 'hotseat' && App._hotseatStep === 'A')) {
    if (App.rules.deckScope !== 'all') App.builder.faction = App.rules.deckScope;
    UI.renderRulesPanel(App.rules);
  } else if (mode === 'join') {
    UI.hideRulesPanel();
    const room = ($('joinRoom').value || '').trim().toUpperCase();
    if (!room) { alert('请输入房间号'); toMenu(); return; }
    try {
      const r = await fetch('/api/roominfo?room=' + encodeURIComponent(room));
      const d = await r.json();
      if (!r.ok) { alert(d.error || '房间不存在'); toMenu(); return; }
      if (d.full) { alert('房间已满'); toMenu(); return; }
      App.joinRules = normalizeRules(d.rules);
      const panel = $('rulesPanel');
      panel.innerHTML = `<div class="rules-title">⚙ 房间规则（由房主设定）</div><div class="rules-note">${UI.rulesSummaryText(App.joinRules)}</div>`;
      panel.classList.remove('hidden');
      if (App.joinRules.deckScope !== 'all') App.builder.faction = App.joinRules.deckScope;
    } catch (e) {
      alert('无法连接联机服务器（房间号无效或服务器未运行）。\n请确认房主已运行 node server.js 且房间号正确。');
      toMenu(); return;
    }
    } else if (mode === 'onlineJoin' || mode === 'rankedJoin') {
      // Connect immediately so the host can send the (read-only) room rules over
      // the channel. The builder's confirm button stays disabled until roomInfo.
      UI.hideRulesPanel();
      App.mode = mode;
      startOnline(mode, App._pendingRankedCode);
      App._pendingRankedCode = null;
    } else {
    UI.hideRulesPanel();
  }
  // 同屏双人·玩家2：若房间限定了单一阵营，直接锁定其阵营，避免组错被驳回。
  if (mode === 'hotseat' && App._hotseatStep === 'B' && App.rules.deckScope !== 'all') {
    App.builder.faction = App.rules.deckScope;
  }
  show('deckBuilder'); renderBuilder();
}
function renderBuilder() {
  const f = FACTIONS[App.builder.faction];
  const total = f.cards.reduce((s, id) => s + (App.builder.counts[id] || 0), 0);
  const who = App.builder.mode === 'hotseat' ? (App._hotseatStep === 'B' ? '玩家2' : '玩家1') : null;
  UI.renderDeckBuilder({ faction: f, counts: App.builder.counts, min: CONFIG.DECK_MIN, max: CONFIG.DECK_MAX, total, unlocked: unlockedSet(), who });
  // Online guest may not confirm until the host's rules have arrived.
  const confirm = document.querySelector('[data-bact="builderConfirm"]');
  if (confirm && (App.builder.mode === 'onlineJoin' || App.builder.mode === 'rankedJoin') && !App.onlineJoinInfo) confirm.disabled = true;
}
function builderSetFaction(k) { App.builder.faction = k; renderBuilder(); }
function builderAdjust(id, d) {
  if (d > 0 && !unlockedSet().has(id)) return;
  const f = FACTIONS[App.builder.faction];
  const total = f.cards.reduce((s, i) => s + (App.builder.counts[i] || 0), 0);
  if (d > 0 && total >= CONFIG.DECK_MAX) return;
  // 有费用的卡每张最多 1 张（"有费卡不能重复选"规则）；0 费卡可重复。
  const cur = App.builder.counts[id] || 0;
  if (d > 0 && cur >= maxCopies(id)) return;
  if (d < 0 && cur <= 0) return;
  App.builder.counts[id] = Math.max(0, cur + d);
  renderBuilder();
}
function builderConfirm() {
  const f = FACTIONS[App.builder.faction];
  const unlocked = unlockedSet();
  const total = f.cards.reduce((s, id) => s + (App.builder.counts[id] || 0), 0);
  if (total < CONFIG.DECK_MIN || total > CONFIG.DECK_MAX) { alert(`卡组数量需在 ${CONFIG.DECK_MIN} ~ ${CONFIG.DECK_MAX} 之间`); return; }
  const scope = App.builder.mode === 'join'
    ? (App.joinRules ? App.joinRules.deckScope : 'all')
    : (App.builder.mode === 'onlineJoin' || App.builder.mode === 'rankedJoin')
      ? (App.onlineJoinInfo ? App.onlineJoinInfo.rules.deckScope : 'all')
      : App.rules.deckScope;
  if (scope !== 'all' && f.res !== scope) { alert(`规则限定「${SCOPE_NAMES[scope]}」，请切换到对应阵营组卡`); return; }
  const cards = [];
  for (const id of f.cards) { if (!unlocked.has(id)) continue; const n = Math.min(maxCopies(id), App.builder.counts[id] || 0); for (let i = 0; i < n; i++) cards.push(id); }
  if (cards.length < CONFIG.DECK_MIN) { alert('已解锁的卡不足以组成卡组，先去抽卡吧'); return; }

  // 本地双人（同屏）/ 排位赛：分两遍组卡，先存玩家1再存玩家2，然后开局。
  if (App.builder.mode === 'hotseat' || App.builder.mode === 'ranked') {
    if (App._hotseatStep === 'A') {
      App.deckA = { res: f.res, cards };
      App._hotseatStep = 'B';
      openBuilder(App.builder.mode);
      return;
    }
    App.deckB = { res: f.res, cards };
    const mode = App.builder.mode; App.builder = null;
    if (mode === 'hotseat') startHotseat();
    else if (mode === 'ranked') startRanked();
    return;
  }

  App.deck = { res: f.res, cards };
  if (App.profile) {
    saveDeck(App.profile, App.deck);
    App.profile.rules = { ...App.rules };
    saveProfile(App.profile);
  }
  const mode = App.builder.mode; App.builder = null;
  if (mode === 'single') startSingle();
  else if (mode === 'host') startHost();
  else if (mode === 'join') startJoin();
  else if (mode === 'onlineHost') startOnline('onlineHost');
  else if (mode === 'rankedHost') startOnline('rankedHost');
  else if (mode === 'onlineJoin') {
    // Connection already established in openBuilder; just send the deck and wait.
    if (App.online) {
      App.online.send({ type: 'join', profile: { name: App.profile.name, avatar: App.profile.avatar }, deck: App.deck.cards, res: App.deck.res });
      UI.hideOnlineLobby();
      showGame(); App.status = '已加入，等待房主开始…'; UI.showOverlay('已发送组卡，等待房主开始对局…', false);
    } else {
      startOnline('onlineJoin');
    }
  } else if (mode === 'rankedJoin') {
    if (App.online) {
      App.online.send({ type: 'join', profile: { name: App.profile.name, avatar: App.profile.avatar }, deck: App.deck.cards, res: App.deck.res });
      UI.hideOnlineLobby();
      showGame(); App.status = '已加入，等待房主开始…'; UI.showOverlay('已发送组卡，等待房主开始对局…', false);
    } else {
      startOnline('rankedJoin', App._pendingRankedCode);
    }
  }
}
function builderCancel() { App.builder = null; toMenu(); }

// ---------- Collection (图鉴 + 抽卡分支) ----------
function openCollection() { App.coll.faction = 'blood'; App.coll.shopTab = 'packs'; showCollSub('grid'); }
function collSetFaction(k) { App.coll.faction = k; UI.renderCollection({ profile: App.profile, faction: k }); }
// 在「我的收藏」内切换子视图：grid=图鉴，gacha=抽卡/商店。
function showCollSub(sub) {
  if (sub === 'gacha') UI.renderShop({ profile: App.profile, tab: App.coll.shopTab || 'packs' });
  else UI.renderCollection({ profile: App.profile, faction: App.coll.faction });
  const grid = $('collGridView'), gacha = $('collGachaView');
  if (grid) grid.classList.toggle('hidden', sub !== 'grid');
  if (gacha) gacha.classList.toggle('hidden', sub !== 'gacha');
  document.querySelectorAll('#collection .cstab').forEach((b) => b.classList.toggle('on', b.dataset.csub === sub));
  show('collection');
}

// ---------- Shop / Gacha (embedded in collection) ----------
let shopBusy = false;
function doDraw() {
  if (shopBusy) return;
  const r = drawPack(App.profile);
  if (!r.ok) { alert(r.reason); return; }
  shopBusy = true;
  playSfx('pack');
  UI.renderShop({ profile: App.profile, tab: 'packs' });
  UI.playPackOpen(r, () => { UI.renderTopChip(App.profile); shopBusy = false; });
}

// 暗夜包开包
function doDrawGem() {
  if (shopBusy) return;
  const r = drawGemPack(App.profile);
  if (!r.ok) { alert(r.reason); return; }
  shopBusy = true;
  playSfx('pack');
  UI.renderShop({ profile: App.profile, tab: 'packs' });
  UI.playPackOpen(r, () => { UI.renderTopChip(App.profile); shopBusy = false; });
}

// 切换商店标签页
function shopSetTab(tab) {
  App.coll.shopTab = tab;
  UI.renderShop({ profile: App.profile, tab });
}

// 直购卡牌
function doBuyCard(id) {
  const r = buyCardDirect(App.profile, id);
  if (!r.ok) { alert(r.reason); return; }
  playSfx('click');
  UI.renderShop({ profile: App.profile, tab: 'direct' });
  UI.renderTopChip(App.profile);
  // 简单购买反馈
  const c = CARDS[id];
  alert(`购买成功！「${c.name}」已加入收藏。`);
}

// 充值
function doRecharge(pkgId) {
  const pkg = RECHARGE_PACKAGES.find((p) => p.id === pkgId);
  if (!pkg) return;
  const total = pkg.gems + (pkg.bonus || 0);
  if (!confirm(`确认充值 ¥${pkg.price} 获得 ${total} 魂晶？（模拟支付，不会产生真实交易）`)) return;
  const r = recharge(App.profile, pkg);
  if (r.ok) {
    playSfx('click');
    UI.renderShop({ profile: App.profile, tab: 'recharge' });
    UI.renderTopChip(App.profile);
    alert(`充值成功！获得 ${r.gems} 魂晶，当前共 ${r.total} 💎`);
  }
}

// 魂晶兑换金币
function doExchange() {
  const input = $('exAmount');
  const gems = parseInt(input?.value, 10);
  if (!gems || gems < 1) { alert('请输入有效的魂晶数量'); return; }
  const r = exchangeGemsForCoins(App.profile, gems);
  if (!r.ok) { alert(r.reason); return; }
  playSfx('click');
  UI.renderShop({ profile: App.profile, tab: 'recharge' });
  UI.renderTopChip(App.profile);
  alert(`兑换成功！${r.gems} 💎 → ${r.coins} ✦ 金币`);
}

// ---------- Login avatar picker ----------
function renderAvatarPicker() {
  const wrap = $('avatarPicker'); if (!wrap) return;
  const cur = App.profile ? App.profile.avatar : randomAvatar();
  wrap.innerHTML = AVATARS.map((a) => `<button type="button" class="av-opt ${a === cur ? 'on' : ''}" data-av="${a}">${a}</button>`).join('');
  $('loginAvatar').textContent = cur;
}
function setAvatar(a) {
  if (App.profile) { App.profile.avatar = a; saveProfile(App.profile); }
  $('loginAvatar').textContent = a;
  document.querySelectorAll('#avatarPicker .av-opt').forEach((b) => b.classList.toggle('on', b.dataset.av === a));
}

// ---------- Wiring ----------
$('login').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lact]'); if (b && b.dataset.lact === 'enter') doLogin();
  const av = e.target.closest('[data-av]'); if (av) setAvatar(av.dataset.av);
});
$('loginName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('loginAvatar').addEventListener('click', () => { const wrap = $('avatarPicker'); if (wrap) wrap.classList.toggle('open'); });

$('menu').addEventListener('click', (e) => {
  const diff = e.target.closest('[data-diff]');
  if (diff) {
    App.aiLevel = diff.dataset.diff;
    if (App.profile) { App.profile.aiLevel = App.aiLevel; saveProfile(App.profile); }
    document.querySelectorAll('#aiDiff .dbtn').forEach((b) => b.classList.toggle('on', b.dataset.diff === App.aiLevel));
    playSfx('click');
    return;
  }
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const a = btn.dataset.act;
  if (a === 'sound') { toggleSound(); return; }
  if (a === 'layout') { cycleLayout(); return; }
  playSfx('click');
  if (a === 'single') openBuilder('single');
  else if (a === 'ranked') openRanked();
  else if (a === 'tutorial') openTutorial();
  else if (a === 'howto') openHowTo();
  else if (a === 'changelog') openChangelog();
  else if (a === 'collection') openCollection();
  else if (a === 'hotseat') { App.deckA = null; App.deckB = null; App._hotseatStep = 'A'; openBuilder('hotseat'); }
  else if (a === 'host') openBuilder('host');
  else if (a === 'join') openBuilder('join');
  else if (a === 'onlineHost') { App._onlineManual = false; openBuilder('onlineHost'); }
  else if (a === 'onlineJoin') { App._onlineManual = false; openBuilder('onlineJoin'); }
  else if (a === 'logout') logout();
});

function toggleSound() {
  const m = !isMuted();
  setMuted(m);
  if (App.profile) { App.profile.muted = m; saveProfile(App.profile); }
  if (!m) { unlockAudio(); playSfx('click'); }
  updateSoundBtn();
}
function updateSoundBtn() {
  const b = $('soundToggle');
  if (!b) return;
  b.textContent = isMuted() ? '🔇 音效：关' : '🔊 音效：开';
}

// 界面布局开关：standard（默认，菜单两列 + 组卡宽网格）/ compact（菜单三列 + 组卡左栏阵营右栏卡牌）。
function applyLayout() {
  const compact = App.profile && App.profile.layout === 'compact';
  document.body.classList.toggle('layout-compact', !!compact);
  updateLayoutBtn();
}
function cycleLayout() {
  const cur = App.profile && App.profile.layout === 'compact' ? 'compact' : 'standard';
  const next = cur === 'compact' ? 'standard' : 'compact';
  if (App.profile) { App.profile.layout = next; saveProfile(App.profile); }
  applyLayout();
  playSfx('click');
}
function updateLayoutBtn() {
  const b = $('layoutToggle');
  if (!b) return;
  const compact = App.profile && App.profile.layout === 'compact';
  b.textContent = compact ? '🎚 布局：紧凑（三列+双栏）' : '🎚 布局：标准';
}

$('collection').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-ctab]'); if (tab) { collSetFaction(tab.dataset.ctab); return; }
  const sub = e.target.closest('[data-csub]'); if (sub) { showCollSub(sub.dataset.csub); return; }
  const open = e.target.closest('[data-sact="open"]'); if (open) { doDraw(); return; }
  const openGem = e.target.closest('[data-sact="openGem"]'); if (openGem) { doDrawGem(); return; }
  const stab = e.target.closest('[data-stab]'); if (stab) { shopSetTab(stab.dataset.stab); return; }
  const buy = e.target.closest('[data-buy]'); if (buy) { doBuyCard(buy.dataset.buy); return; }
  const rc = e.target.closest('[data-recharge]'); if (rc) { doRecharge(rc.dataset.recharge); return; }
  const ex = e.target.closest('[data-act="exchange"]'); if (ex) { doExchange(); return; }
  const back = e.target.closest('[data-cact="back"]'); if (back) toMenu();
});

// 兑换输入实时更新结果
$('collection').addEventListener('input', (e) => {
  if (e.target.id === 'exAmount') {
    const gems = parseInt(e.target.value, 10) || 0;
    const result = $('exResult');
    if (result) result.textContent = `${gems * GEM_EXCHANGE.rate} ✦`;
  }
});

$('deckBuilder').addEventListener('click', (e) => {
  const rb = e.target.closest('[data-rule]');
  if (rb) {
    const key = rb.dataset.rule;
    const raw = rb.dataset.rval;
    if (key === 'winMode') {
      // 切换胜利方式时，把目标分重置为该方式的默认值（可在面板再改）。
      App.rules = normalizeRules({ ...App.rules, winMode: raw, winScale: defaultWinScaleFor(raw) });
    } else if (key === 'deckScope') {
      App.rules = normalizeRules({ ...App.rules, [key]: raw });
      if (raw !== 'all') builderSetFaction(raw);
    } else {
      App.rules = normalizeRules({ ...App.rules, [key]: Number(raw) });
    }
    UI.renderRulesPanel(App.rules);
    return;
  }
  const tab = e.target.closest('[data-btab]'); if (tab) { builderSetFaction(tab.dataset.btab); return; }
  const card = e.target.closest('[data-bcard]'); if (card) { builderAdjust(card.dataset.bcard, parseInt(card.dataset.bdelta, 10)); return; }
  const act = e.target.closest('[data-bact]'); if (!act) return;
  if (act.dataset.bact === 'builderCancel') builderCancel();
  else if (act.dataset.bact === 'builderConfirm') builderConfirm();
});

// 胜利目标自由输入（累计分数模式可设很高的自定义数值）。监听 change 而非 input，避免输入时被重渲染夺走焦点。
$('deckBuilder').addEventListener('change', (e) => {
  const rin = e.target.closest('[data-rinput="winScale"]');
  if (!rin) return;
  let v = Math.round(Number(rin.value));
  if (!Number.isFinite(v) || v < 1) v = 1;
  if (v > WIN_SCALE_CAP) { v = WIN_SCALE_CAP; rin.value = v; }
  App.rules = normalizeRules({ ...App.rules, winScale: v });
  UI.renderRulesPanel(App.rules);
});

// ---------- Tutorial setup screen ----------
$('tutorialSetup').addEventListener('click', (e) => {
  if (!App.tut) return;
  const tf = e.target.closest('[data-tf]');
  if (tf) { App.tut.setup.faction = tf.dataset.tf; UI.renderTutSetup({ faction: App.tut.setup.faction, modules: App.tut.setup.modules, factions: FACTIONS }); return; }
  const tm = e.target.closest('[data-tm]');
  if (tm) {
    const id = tm.dataset.tm;
    if (App.tut.setup.modules.has(id)) { if (!isCoreModule(id)) App.tut.setup.modules.delete(id); }
    else App.tut.setup.modules.add(id);
    UI.renderTutSetup({ faction: App.tut.setup.faction, modules: App.tut.setup.modules, factions: FACTIONS });
    return;
  }
  const act = e.target.closest('[data-tact]'); if (!act) return;
  if (act.dataset.tact === 'tutBack') toMenu();
  else if (act.dataset.tact === 'tutStart') { if (App.tut.setup.modules.size) beginTutorial(); else alert('请至少选择一个学习内容'); }
});

// ---------- How-to screen ----------
$('howto').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hact="howtoBack"]'); if (b) toMenu();
});

$('changelog').addEventListener('click', (e) => {
  const b = e.target.closest('[data-clact="back"]'); if (b) toMenu();
});

// ---------- Ranked (排位赛) screen ----------
$('ranked').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ract]'); if (!b) return;
  if (b.dataset.ract === 'back') toMenu();
  else if (b.dataset.ract === 'start') { App._hotseatStep = 'A'; openBuilder('ranked'); }
  else if (b.dataset.ract === 'onlineHost') { App._onlineManual = false; App.rules = { ...DEFAULT_RULES }; openBuilder('rankedHost'); }
  else if (b.dataset.ract === 'onlineJoin') {
    const code = ($('rankedRoom').value || '').trim().toUpperCase();
    if (!code) { alert('请输入房间号或邀请码'); return; }
    App._onlineManual = false; App.rules = { ...DEFAULT_RULES }; App._pendingRankedCode = code; openBuilder('rankedJoin');
  }
});

// ---------- 战斗交互（点击与键盘共用）----------
// 选中 / 取消手牌；血肉牌会进入“选祭品”状态并给出提示。
function selectHand(iid) {
  if (!canAct()) return;
  if (App.ui.selectedIid === iid) { App.ui.selectedIid = null; App.ui.sacList = []; App.status = ''; }
  else {
    App.ui.selectedIid = iid; App.ui.sacList = [];
    const card = App.state.players[App.me].hand.find((c) => c.iid === iid);
    if (card && card.costType === 'blood' && card.cost > 0) {
      // 血肉规则：当回合血肉(pool) 恒为 0，完全靠献祭场上已召唤单位来支付。
      const pool = App.state.players[App.me].blood || 0;
      let boardAvail = 0; for (const u of App.state.board[App.me]) if (u) boardAvail += u.bloodValue;
      const needFromBoard = Math.max(0, card.cost - pool);
      App.status = (pool + boardAvail) >= card.cost
        ? `「${card.name}」需 ${card.cost} 血肉（本回合血肉 ${pool}，差额点场上单位献祭）：已选 0/${needFromBoard}`
        : `血肉不足：本回合 ${pool} + 场上 ${boardAvail} = ${pool + boardAvail} < ${card.cost}，先把单位召唤上场`;
    } else App.status = '';
  }
  App.kb.handIdx = -1;
  render();
}
// 切换献祭某张己方场上单位（仅当选中的是需献祭的血肉牌）。
function toggleSac(iid) {
  if (!canAct() || !App.ui.selectedIid) return;
  const sel = App.state.players[App.me].hand.find((c) => c.iid === App.ui.selectedIid);
  if (!sel || sel.costType !== 'blood' || sel.cost <= 0) return;
  const idx = (App.ui.sacList || []).indexOf(iid);
  if (idx >= 0) App.ui.sacList.splice(idx, 1); else App.ui.sacList.push(iid);
  const pool = App.state.players[App.me].blood || 0;
  let have = 0; for (const s of App.ui.sacList) { const u = App.state.board[App.me].find((c) => c && c.iid === s); if (u) have += u.bloodValue; }
  const ready = (pool + have) >= sel.cost;
  App.status = `「${sel.name}」需 ${sel.cost} 血肉（本回合血肉 ${pool}，已献祭 ${have}）` + (ready ? '（可召唤）' : '：继续点场上单位献祭');
  render();
}
// 在指定空列打出当前选中的牌（血肉牌带走已选祭品）。
function playOnLane(lane) {
  if (!canAct() || !App.ui.selectedIid) return;
  const card = App.state.players[App.me].hand.find((c) => c.iid === App.ui.selectedIid);
  if (!card) return;
  const a = { type: 'play', iid: card.iid, lane };
  if (card.costType === 'blood' && card.cost > 0) {
    const pool = App.state.players[App.me].blood || 0;
    let sacTotal = 0; for (const s of (App.ui.sacList || [])) { const u = App.state.board[App.me].find((c) => c && c.iid === s); if (u) sacTotal += u.bloodValue; }
    if (pool + sacTotal < card.cost) { App.status = `还需献祭 ${card.cost - pool - sacTotal} 血肉：点你场上的单位献祭`; render(); return; }
    a.sacrifices = App.ui.sacList.slice();
  }
  App.ui.selectedIid = null; App.ui.sacList = []; App.kb.laneIdx = 0;
  act(a);
}
// 选牌后按列键（1-4 / QWER）：空列→打牌；己方单位列且需献祭→切换献祭；己方单位列但无需献祭→提示。
function laneKey(lane) {
  if (!canAct() || !App.ui.selectedIid) return;
  const me = App.me;
  const unit = App.state.board[me][lane];
  const sel = App.state.players[me].hand.find((c) => c.iid === App.ui.selectedIid);
  if (unit) {
    if (sel && sel.costType === 'blood' && sel.cost > 0) toggleSac(unit.iid);
    else { App.status = '该列已有单位，请选空列出牌'; render(); }
  } else {
    playOnLane(lane);
  }
}
// 控制按钮（结束回合 / 菜单 / 教程下一步 / 同屏交接）。
function ctrlAct(name) {
  if (name === 'endTurn') act({ type: 'endTurn' });
  else if (name === 'menu') toMenu();
  else if (name === 'tutNext') tutNext();
  else if (name === 'hotseatContinue') hotseatContinue();
}

$('game').addEventListener('click', (e) => {
  const t = e.target.closest('[data-hand],[data-playlane],[data-saccard],[data-act]'); if (!t) return;
  if (t.dataset.hand) { selectHand(t.dataset.hand); return; }
  if (t.dataset.saccard) { toggleSac(t.dataset.saccard); return; }
  if (t.dataset.playlane) { playOnLane(parseInt(t.dataset.playlane, 10)); return; }
  if (t.dataset.act) { ctrlAct(t.dataset.act); return; }
});

// ---------- Online lobby (overlay) wiring ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ol]'); if (!b) return;
  const a = b.dataset.ol;
  if (a === 'copyLink') { const link = App.online ? App.online.inviteLink : ''; copyText(link); UI.setLobbyStatus('邀请链接已复制'); }
  else if (a === 'copyOffer') { copyText(App.online ? App.online.offerStr : ''); UI.setLobbyStatus('邀请码已复制'); }
  else if (a === 'copyAnswer') { copyText(App.online ? App.online.answerStr : ''); UI.setLobbyStatus('回执码已复制'); }
  else if (a === 'pasteOffer') { const v = $('lobbyOfferIn').value.trim(); if (v && App.online) { App.online.connectWithOffer(v); UI.setLobbyStatus('已载入邀请码，生成回执中…'); } }
  else if (a === 'pasteAnswer') { const v = $('lobbyAnswerIn').value.trim(); if (v && App.online) { App.online.acceptAnswer(v); UI.setLobbyStatus('正在建立连接…'); } }
  else if (a === 'switchManual') {
    App._onlineManual = true;
    const isHost = App.mode.endsWith('Host');
    UI.showOnlineLobby({ role: isHost ? 'host' : 'join', manual: true });
    if (isHost) startOnlineManualRegenerate();
    else renderManualGuestPrompt();
  }
  else if (a === 'lobbyCancel') { if (App.online) App.online.close(); App.online = null; toMenu(); }
});
function startOnlineManualRegenerate() {
  // Re-create the host net in manual mode to produce a fresh offer.
  if (App.online) App.online.close();
  const isHost = App.mode.endsWith('Host');
  App.online = new OnlineNet({
    isHost, roomCode: isHost ? genRoom() : '', manual: true,
    onMessage: onlineMsgHandler,
    onOpen: () => UI.setLobbyStatus('已连接，等待对手加入…'),
    onClose: () => UI.setLobbyStatus('连接已断开'),
    onError: (e) => UI.setLobbyStatus('连接出错：' + (e && e.message ? e.message : e)),
    onStatus: (kind, payload) => {
      if (kind === 'offer') UI.showLobbyOffer({ manual: true, offer: payload.offer, link: payload.link });
      else if (kind === 'connecting') UI.setLobbyStatus('正在建立连接…');
    },
  });
  App.online.connect();
  UI.setLobbyStatus('正在生成邀请码…');
}
function copyText(t) { if (!t) return; if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); else { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) {} ta.remove(); } }

// ---------- 键盘交互（战斗界面）----------
// 完整键盘操作：1-9 选牌 · 选牌后 1-4/QWER 在该列出牌或献祭 · ←→ 移动光标 ·
// 空格/Enter 结束回合（无选牌时）或在列光标打出（有选牌时）· Esc 取消。
document.addEventListener('keydown', (e) => {
  if (!App.state || $('game').classList.contains('hidden')) return;
  const overlayOpen = !$('overlay').classList.contains('hidden');
  const tutStep = App.tut && App.tut.steps ? App.tut.steps[App.tut.step] : null;
  const onInfoStep = overlayOpen && App.mode === 'tutorial' && tutStep && tutStep.need == null;
  // 覆盖层（教程信息 / 同屏交接）：Enter / Esc → 继续
  if (onInfoStep) { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); tutNext(); } return; }
  if (overlayOpen && App.mode === 'hotseat') { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); hotseatContinue(); } return; }
  if (App.state.over) return;

  const hand = App.state.players[App.me].hand;
  const LANES = (App.state.rules && App.state.rules.lanes) || CONFIG.LANES;
  const k = e.key;

  // 1) 选牌：数字 1-9（未选中任何牌时）
  if (/^[1-9]$/.test(k) && !App.ui.selectedIid) {
    const idx = parseInt(k, 10) - 1;
    if (idx < hand.length) { e.preventDefault(); App.kb.handIdx = idx; selectHand(hand[idx].iid); }
    return;
  }
  // 2) 选牌后：数字 1-4 / QWER = 在该列打牌或献祭
  if (App.ui.selectedIid && /^[1-4qwerQWER]$/.test(k)) {
    let lane;
    if (/^[1-4]$/.test(k)) lane = parseInt(k, 10) - 1;
    else lane = 'qwer'.indexOf(k.toLowerCase());
    if (lane >= 0 && lane < LANES) { e.preventDefault(); App.kb.laneIdx = lane; laneKey(lane); }
    return;
  }
  // 3) 方向键：未选牌→移动手牌光标（仅高亮预览）；已选牌→移动列光标
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    e.preventDefault();
    if (!App.ui.selectedIid) {
      if (hand.length) App.kb.handIdx = Math.max(0, Math.min(hand.length - 1, (App.kb.handIdx < 0 ? 0 : App.kb.handIdx) + (k === 'ArrowRight' ? 1 : -1)));
    } else {
      App.kb.laneIdx = (App.kb.laneIdx + (k === 'ArrowRight' ? 1 : LANES - 1)) % LANES;
    }
    render();
    return;
  }
  // 4) Enter / 空格：未选牌→结束回合；已选牌→在当前列光标打牌 / 献祭
  if (k === 'Enter' || k === ' ') {
    e.preventDefault();
    if (!App.ui.selectedIid) { if (canAct()) act({ type: 'endTurn' }); }
    else laneKey(Math.max(0, Math.min(LANES - 1, App.kb.laneIdx)));
    return;
  }
  // 5) Esc：取消选牌 / 献祭
  if (k === 'Escape') {
    if (App.ui.selectedIid || (App.ui.sacList && App.ui.sacList.length)) {
      e.preventDefault(); App.ui.selectedIid = null; App.ui.sacList = []; App.kb.laneIdx = 0; App.status = ''; render();
    }
  }
});

// Auto-join via ?join=ROOM / ?m=OFFER (casual) or ?rjoin=CODE (ranked P2P).
(function autoJoinFromUrl() {
  const params = new URLSearchParams(location.search);
  const join = params.get('join');
  const m = params.get('m');
  const rjoin = params.get('rjoin');
  if (join || m) window.__autoJoin = { join, m };
  if (rjoin) window.__autoRankedJoin = rjoin.toUpperCase();
})();

// ---------- Boot ----------
bootLogin();
