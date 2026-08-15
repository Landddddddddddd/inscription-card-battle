// Shared card & rule definitions. Pure data — safe to import in both Node and the browser.

export const CONFIG = {
  LANES: 4,
  HAND_START: 4,
  DRAW_PER_TURN: 1,
  HAND_LIMIT: 10,
  WIN_SCALE: 6,          // unblocked attack points needed to tilt the scale to a win
  FIRST_HANDICAP: 1,     // 先手方（房主/你）开局天平 -1，作为先手优势的平衡修正
  ENERGY_CAP: 5,         // energy faction ramp cap: 1,2,3,4,5 then stays at 5
  ENERGY_RAMP_EVERY: 2,   // grow the energy pool every Nth of its own turns (slows late-game flood)
  BONE_CAP_MAX: 12,
  BONE_PER_TURN: 1,      // passive graveyard drip each turn
  BONE_DEATH_GAIN: 0,     // bones from creature deaths OFF (bone is now a steady passive-drip faction)
  BLOOD_PER_TURN: 0,      // 每回合无偿血肉 = 0（用户硬约束：血肉阵营不靠无偿发放，完全靠献祭已召唤单位来获得血肉）。pool 恒为 0，所有 blood 卡费用都由场上单位 bloodValue 支付。平衡由卡牌数值承担。
  DECK_MIN: 5,           // deck builder constraints（0 费卡下限：卡组最少 5 张）
  DECK_MAX: 30,
  ZERO_COST_MAX: 15,     // 单张 0 费卡在卡组中的最多重复数（原上限 2，现放宽到 15）
};

// ============================================================================
// CUSTOM MATCH RULES (自定义房间规则)
// A per-game "rules" object travels inside the game state, so both LAN peers
// and the renderer always agree on lanes / win target / draw count / deck scope.
// ============================================================================
export const RULE_OPTIONS = {
  lanes:       [3, 4, 5, 6, 7],            // board size (columns per side)
  winMode:     ['difference', 'absolute'],// 胜利方式：分数差 / 累计分数
  drawPerTurn: [1, 2, 3],                  // cards drawn at the start of each turn
  deckScope:   ['all', 'blood', 'bone', 'energy', 'mox'], // deck restriction
};
// 胜利目标可自定义的上限（防止异常数值）。
export const WIN_SCALE_CAP = 200;
// 不同胜利方式提供不同的预设目标分；累计分数（absolute）模式允许更高的自定义数值。
export function winScaleOptions(mode) {
  return mode === 'absolute'
    ? [10, 15, 20, 30, 40, 50, 75, 100]
    : [3, 4, 5, 6, 8, 10, 12];
}
export const DEFAULT_RULES = { lanes: 4, winMode: 'difference', winScale: 5, drawPerTurn: 1, deckScope: 'all' };

// 胜利方式的默认目标分（可在规则面板自定义）。
export function defaultWinScaleFor(mode) { return mode === 'absolute' ? 10 : 5; }
export function winModeName(m) { return m === 'absolute' ? '累计分数' : '分数差'; }
export function winModeDesc(m) {
  return m === 'absolute'
    ? '双方各自累计「未阻挡攻击」分数，先达到目标分者获胜。'
    : '比拼双方分数差，先拉开到目标分差者获胜（拉锯更激烈，适合快节奏对局）。';
}

export const SCOPE_NAMES = { all: '不限阵营', blood: '仅血肉', bone: '仅骸骨', energy: '仅能量', mox: '仅魔石' };

// ============================================================================
// RANKED LADDER (排位赛)
// 6 阶（一阶最低 → 六阶最高），每阶分 下/中/上 三个小阶，共 18 个段位。
// 最高段位 = 六阶·上。胜 +晋级分，负 −晋级分；满 DIV_PROMOTE 升上一小阶、
// 归零则降下一小阶。仅限 PVP（同屏双人对战）。
// ============================================================================
export const RANK = {
  TIERS: 6,
  DIVS: 3,                       // 每阶 3 个小阶：下(0) / 中(1) / 上(2)
  DIVISIONS: ['下', '中', '上'],
  TIER_NAMES: ['', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶'], // 索引 1..6
  TIER_COLORS: ['', '#9aa0a8', '#cd7f32', '#c0c0c0', '#e7b53a', '#4fd1c5', '#5aa6ff'],
  POINTS_WIN: 30,               // 每胜一场 +30 晋级分
  POINTS_LOSE: 30,              // 每负一场 −30 晋级分
  DIV_PROMOTE: 100,             // 小阶内满 100 分即晋级
};
export function rankLabel(rank) {
  const tier = Math.min(RANK.TIERS, Math.max(1, (rank && rank.tier) || 1));
  const div = Math.min(RANK.DIVS - 1, Math.max(0, (rank && rank.div) || 0));
  return `${RANK.TIER_NAMES[tier]}·${RANK.DIVISIONS[div]}`;
}
export function rankColor(tier) {
  tier = Math.min(RANK.TIERS, Math.max(1, tier || 1));
  return RANK.TIER_COLORS[tier];
}
export function rankIndex(rank) {
  const tier = Math.min(RANK.TIERS, Math.max(1, (rank && rank.tier) || 1));
  const div = Math.min(RANK.DIVS - 1, Math.max(0, (rank && rank.div) || 0));
  return (tier - 1) * RANK.DIVS + div; // 0 = 一阶·下 … 17 = 六阶·上
}
export function rankFromIndex(i) {
  i = Math.min(RANK.TIERS * RANK.DIVS - 1, Math.max(0, i | 0));
  return { tier: Math.floor(i / RANK.DIVS) + 1, div: i % RANK.DIVS, points: 0 };
}
export function isTopRank(rank) {
  return (rank && rank.tier >= RANK.TIERS && rank.div >= RANK.DIVS - 1);
}

// Clamp/normalize an arbitrary rules object to legal values (never throws).
export function normalizeRules(r) {
  const src = r && typeof r === 'object' ? r : {};
  const pick = (key, fallback) => {
    const v = Number(src[key]);
    return RULE_OPTIONS[key].includes(v) ? v : fallback;
  };
  const winMode = RULE_OPTIONS.winMode.includes(src.winMode) ? src.winMode : DEFAULT_RULES.winMode;
  // 胜利目标：允许 1~WIN_SCALE_CAP 之间的任意整数自定义（累计分数模式可设很高）。
  const wsRaw = Number(src.winScale);
  const winScale = (Number.isFinite(wsRaw) && Number.isInteger(wsRaw) && wsRaw >= 1 && wsRaw <= WIN_SCALE_CAP)
    ? wsRaw : defaultWinScaleFor(winMode);
  return {
    lanes: pick('lanes', DEFAULT_RULES.lanes),
    winMode,
    winScale,
    drawPerTurn: pick('drawPerTurn', DEFAULT_RULES.drawPerTurn),
    deckScope: RULE_OPTIONS.deckScope.includes(src.deckScope) ? src.deckScope : DEFAULT_RULES.deckScope,
  };
}

// Which faction a card belongs to, derived from its cost type.
export function factionOfCard(id) {
  const c = CARDS[id];
  if (!c) return null;
  return c.costType === 'gem' ? 'mox' : c.costType; // blood / bone / energy / mox
}

// 是否为「有费卡」：需要付出资源才能召唤，卡组中每张最多 1 份。
//   - 数值费用卡：cost > 0（血肉/骸骨/能量）
//   - 魔石法术卡：costType==='gem' 且需要特定宝石（gemCost 非空）——召唤受魔石限制，视为有费卡
// 真正的 0 费免费卡（cost===0 且无宝石要求，如魔石生物）才允许重复（上限 ZERO_COST_MAX）。
export function isCostedCard(id) {
  const c = CARDS[id];
  if (!c) return false;
  if (c.cost > 0) return true;
  if (c.costType === 'gem') return (c.gemCost || []).length > 0; // 需要特定魔石才能召唤
  return false;
}

// Does every card in `deck` satisfy the room's deck scope?
export function deckMatchesScope(deck, scope) {
  if (!scope || scope === 'all') return true;
  return (deck || []).every((id) => factionOfCard(id) === scope);
}

// Human-readable one-line summary, e.g. "场地5列 · 胜利·分数差5分 · 抽2张/轮 · 仅骸骨".
export function rulesSummary(r) {
  const rules = normalizeRules(r);
  const parts = [`场地${rules.lanes}列`, `胜利·${winModeName(rules.winMode)}${rules.winScale}分`, `抽${rules.drawPerTurn}张/轮`];
  if (rules.deckScope !== 'all') parts.push(SCOPE_NAMES[rules.deckScope]);
  return parts.join(' · ');
}

// Gem (魔石) colors for the Mox faction. A Mox creature on the board provides
// its color; Wizard cards require the matching gem(s) *present on the board*
// to be summoned (gems are a board-presence resource, not consumed on cast).
export const GEMS = {
  orange: { name: '橙', color: '#e67e22' },
  green:  { name: '绿', color: '#27ae60' },
  blue:   { name: '蓝', color: '#2980b9' },
};

// Sigil (ability) metadata. Codes used by CARDS below.
export const SIGILS = {
  airborne:      { name: '飞行', desc: '可越过地面阻挡直接攻击天平；仅能被飞行单位阻挡。' },
  double_strike:{ name: '连击', desc: '每次攻击造成两次伤害（攻击天平时也翻倍）。' },
  poison_touch:  { name: '毒触', desc: '攻击时额外造成 1 点伤害。' },
  sharp_quills:  { name: '尖刺', desc: '被攻击时，攻击它的单位受到 1 点伤害。' },
  undying:       { name: '不死', desc: '首次死亡时返回手牌，而非进入弃牌堆。' },
  loose_tail:    { name: '断尾', desc: '死亡时，随机获得一只松鼠到手牌。' },
  pack:          { name: '头狼', desc: '使相邻友方单位的攻击力 +1。' },
  burrower:      { name: '掘洞', desc: '可在己方空列之间移动（预留特性）。' },
  brittle:       { name: '易碎', desc: '攻击一次后立即死亡（碎裂）。' },
  death_touch:   { name: '致死', desc: '造成的任何伤害都会直接杀死目标（无视剩余生命）。' },
  armored:       { name: '厚甲', desc: '受到的伤害 −1（最低为 0）。' },
  frenzy:        { name: '狂热', desc: '每回合开始攻击力 +1（封顶 6）。越拖越凶。' },
  regen:         { name: '回复', desc: '每回合开始恢复 1 点生命（不超过上限）。持久消耗战核心。' },
};

// costType: 'blood' | 'bone' | 'energy' | 'gem'
//   - blood  阵营：献祭生物换血肉，花血肉召唤
//   - bone   阵营：生物死亡积累骸骨，花骸骨召唤
//   - energy 阵营：每回合稳定回能量
//   - mox    阵营：魔石体系。场上每有一只「魔石生物」即提供一种颜色的魔石（橙/绿/蓝），
//                  法术(Wizard)卡 costType='gem'，需场上存在对应颜色的魔石才能召唤
//                  （魔石生物一旦死亡，就失去该颜色的魔石）。魔石生物本身免费(0费)。
// bloodValue: how much blood a sacrifice of this creature yields (universal sacrifice currency)
export const CARDS = {
  // ===================== BLOOD（血肉）=====================
  // 0 费真·免费卡（零投入即可打出）：不应具备攻击，定位为铺场/祭品炮灰。
  // 注意：骸骨阵营的 0 费卡（bone_pup）豁免——其"费用"由死亡产骸骨偿还；
  // 魔石法术卡虽 cost:0，但需场上对应魔石才能召唤，并非免费，亦不受影响。
  squirrel:    { name: '松鼠',   atk: 0, hp: 1, cost: 0, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#8a5a2b', glyph: '鼠' },
  stoat:       { name: '白鼬',   atk: 2, hp: 2, cost: 1, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#d9d2c5', glyph: '鼬' },
  raven:       { name: '乌鸦',   atk: 1, hp: 1, cost: 1, costType: 'blood', sigils: ['airborne'],       bloodValue: 2, color: '#2b2b3a', glyph: '鸦' },
  mole:        { name: '鼹鼠',   atk: 1, hp: 1, cost: 1, costType: 'blood', sigils: ['undying'],        bloodValue: 2, color: '#5b4636', glyph: '鼹' },
  beaver:      { name: '河狸',   atk: 2, hp: 2, cost: 1, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#6b4f2a', glyph: '狸' },
  adder:       { name: '蝰蛇',   atk: 1, hp: 2, cost: 1, costType: 'blood', sigils: ['poison_touch'],  bloodValue: 2, color: '#3b6b3b', glyph: '蛇' },
  raccoon:     { name: '浣熊',   atk: 2, hp: 2, cost: 1, costType: 'blood', sigils: ['loose_tail'],    bloodValue: 2, color: '#7a6a55', glyph: '浣' },
  opossum:     { name: '负鼠',   atk: 2, hp: 2, cost: 2, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#7a6a55', glyph: '负' },
  wolf:        { name: '狼',     atk: 3, hp: 2, cost: 2, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#6e6e6e', glyph: '狼' },
  bullfrog:    { name: '牛蛙',   atk: 3, hp: 3, cost: 2, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#4a7a3a', glyph: '蛙' },
  vulture:     { name: '秃鹫',   atk: 3, hp: 1, cost: 2, costType: 'blood', sigils: ['airborne'],       bloodValue: 2, color: '#4a3a2a', glyph: '鹫' },
  cougar:      { name: '美洲狮', atk: 3, hp: 2, cost: 3, costType: 'blood', sigils: ['double_strike'],  bloodValue: 2, color: '#9a8a6a', glyph: '狮' },
  dire_wolf:   { name: '恐狼',   atk: 3, hp: 3, cost: 3, costType: 'blood', sigils: ['pack'],           bloodValue: 2, color: '#4a4a55', glyph: '恐' },
  hound:       { name: '猎犬',   atk: 3, hp: 4, cost: 3, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#8a6a3a', glyph: '犬' },
  skunk:       { name: '臭鼬',   atk: 1, hp: 2, cost: 1, costType: 'blood', sigils: ['brittle'],        bloodValue: 2, color: '#2b2b2b', glyph: '臭' },
  great_white: { name: '大白鲨', atk: 3, hp: 3, cost: 3, costType: 'blood', sigils: ['sharp_quills'],   bloodValue: 2, color: '#c8d6e0', glyph: '鲨' },
  warthog:     { name: '疣猪',   atk: 3, hp: 3, cost: 3, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#9a7a5a', glyph: '猪' },
  bear:        { name: '巨熊',   atk: 5, hp: 4, cost: 4, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#5a4636', glyph: '熊' },
  wolf_cub:    { name: '狼崽',   atk: 2, hp: 1, cost: 1, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#8a8a8a', glyph: '崽' },

  // 新增：印记演示卡（通用级，便于快速试玩）
  viper_king:  { name: '蝰王',   atk: 3, hp: 2, cost: 3, costType: 'blood', sigils: ['death_touch'],     bloodValue: 2, color: '#5a2a2a', glyph: '蝰' },

  // 新增普通卡（丰富卡池，配合"有费卡不可重复"规则提供更多可选单位）
  field_mouse: { name: '田鼠', atk: 2, hp: 1, cost: 1, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#9a8a6a', glyph: '田' },
  toad:        { name: '蟾蜍', atk: 2, hp: 2, cost: 1, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#4a7a3a', glyph: '蟾' },
  shrew:       { name: '鼩鼱', atk: 1, hp: 1, cost: 1, costType: 'blood', sigils: ['undying'],        bloodValue: 2, color: '#7a6a55', glyph: '鼩' },
  hawk:        { name: '苍鹰', atk: 1, hp: 2, cost: 1, costType: 'blood', sigils: ['airborne'],       bloodValue: 2, color: '#5a6a7a', glyph: '鹰' },
  ferret:      { name: '雪貂', atk: 3, hp: 2, cost: 2, costType: 'blood', sigils: [],                 bloodValue: 2, color: '#b8a890', glyph: '貂' },

  // 新增：印记演示卡（狂热 / 回复）
  warg:        { name: '战狼',   atk: 2, hp: 3, cost: 2, costType: 'blood', sigils: ['frenzy'],        bloodValue: 2, color: '#9a5a3a', glyph: '战' },
  rat_king:    { name: '鼠王',   atk: 1, hp: 4, cost: 2, costType: 'blood', sigils: ['regen'],         bloodValue: 2, color: '#8a7a6a', glyph: '王' },
  berserker:   { name: '狂战士', atk: 3, hp: 2, cost: 3, costType: 'blood', sigils: ['frenzy','double_strike'], bloodValue: 2, color: '#b5241f', glyph: '狂' },

  // [daily 2026-08-09] 重甲獾
  armored_badger: { name: '重甲獾', atk: 2, hp: 2, cost: 2, costType: 'blood', sigils: ['armored'],        bloodValue: 2, color: '#6b5a4a', glyph: '獾' },

  // [daily 2026-08-12] 刺猬
  hedgehog:    { name: '刺猬', atk: 2, hp: 3, cost: 2, costType: 'blood', sigils: ['sharp_quills'],  bloodValue: 2, color: '#7a5a3a', glyph: '猬' },

  // [daily 2026-08-14] 豪猪
  porcupine:   { name: '豪猪', atk: 2, hp: 1, cost: 1, costType: 'blood', sigils: ['sharp_quills'],  bloodValue: 2, color: '#7a5a3a', glyph: '豪' },

  // [daily 2026-08-15] 水獭
  otter:       { name: '水獭', atk: 2, hp: 3, cost: 2, costType: 'blood', sigils: ['undying'],        bloodValue: 2, color: '#6b4f3a', glyph: '獭' },

  // ===================== BONE（骸骨 · 亡灵墓地主题）=====================
  // 骸骨阵营的 0 费起手牌：免费铺场充当炮灰，死亡后即可积累骸骨（骸骨只从生物死亡获得）。
  bone_pup:    { name: '枯骨幼犬', atk: 1, hp: 1, cost: 0, costType: 'bone', sigils: ['brittle'],        bloodValue: 1, color: '#cfcabc', glyph: '骨' },
  rat:         { name: '瘟疫鼠',   atk: 1, hp: 1, cost: 1, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#9a8a7a', glyph: '鼠' },
  cat:         { name: '墓园妖猫', atk: 1, hp: 1, cost: 1, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#c9a96a', glyph: '猫' },
  spider:      { name: '墓穴蛛',   atk: 1, hp: 1, cost: 1, costType: 'bone', sigils: [],    bloodValue: 1, color: '#4a3a4a', glyph: '蜘' },
  bat:         { name: '骨翼蝠',   atk: 1, hp: 1, cost: 1, costType: 'bone', sigils: ['airborne'],       bloodValue: 1, color: '#3a2b3a', glyph: '蝠' },
  skeleton:    { name: '骷髅武士', atk: 2, hp: 1, cost: 2, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#d8d8d0', glyph: '骷' },
  corpse:      { name: '腐尸',     atk: 1, hp: 3, cost: 2, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#6a7a5a', glyph: '尸' },
  crab:        { name: '尸壳蟹',   atk: 1, hp: 2, cost: 2, costType: 'bone', sigils: ['sharp_quills'],  bloodValue: 1, color: '#c06a4a', glyph: '蟹' },
  scorpion:    { name: '毒骨蝎',   atk: 2, hp: 1, cost: 2, costType: 'bone', sigils: ['poison_touch'],  bloodValue: 1, color: '#a06a2a', glyph: '蝎' },
  zombie:      { name: '还魂僵尸', atk: 1, hp: 1, cost: 2, costType: 'bone', sigils: ['undying'],        bloodValue: 1, color: '#7a8a6a', glyph: '尸' },
  black_widow: { name: '幽冥寡妇', atk: 1, hp: 2, cost: 3, costType: 'bone', sigils: ['poison_touch'],  bloodValue: 1, color: '#2b1b2b', glyph: '蛛' },
  turtle:      { name: '朽甲龟',   atk: 1, hp: 4, cost: 3, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#4a7a6a', glyph: '龟' },
  bone_hound:  { name: '骸骨猎犬', atk: 2, hp: 3, cost: 3, costType: 'bone', sigils: ['pack'],           bloodValue: 1, color: '#cfcabc', glyph: '骸' },
  geck:        { name: '墓行蜥',   atk: 2, hp: 2, cost: 4, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#5a8a4a', glyph: '蜥' },

  // 新增普通卡
  lizard:      { name: '枯骨蜥', atk: 1, hp: 1, cost: 1, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#7a8a5a', glyph: '蜥' },
  snail:       { name: '墓螺',   atk: 1, hp: 2, cost: 1, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#9a8a7a', glyph: '螺' },
  moth:        { name: '尸蛾',   atk: 1, hp: 1, cost: 1, costType: 'bone', sigils: ['airborne'],       bloodValue: 1, color: '#6a5a6a', glyph: '蛾' },
  beetle:      { name: '甲虫',   atk: 1, hp: 2, cost: 1, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#5a6a3a', glyph: '甲' },
  bonesnake:   { name: '骨蛇',   atk: 2, hp: 1, cost: 2, costType: 'bone', sigils: [],                 bloodValue: 1, color: '#8a9a7a', glyph: '蛇' },

  // 新增：印记演示卡（通用级）
  bone_warden: { name: '白骨守卫', atk: 2, hp: 4, cost: 3, costType: 'bone', sigils: ['armored'],        bloodValue: 1, color: '#d8d8d0', glyph: '卫' },

  // [daily 2026-08-09] 墓苔尸
  grave_moss:  { name: '墓苔尸',   atk: 1, hp: 3, cost: 2, costType: 'bone', sigils: ['regen'],          bloodValue: 1, color: '#6a8a5a', glyph: '苔' },

  // [daily 2026-08-12] 冢卫
  tomb_guard: { name: '冢卫',     atk: 1, hp: 3, cost: 2, costType: 'bone', sigils: ['armored'],        bloodValue: 1, color: '#9aa0a8', glyph: '冢' },

  // [daily 2026-08-14] 骨弓手
  bone_archer: { name: '骨弓手', atk: 1, hp: 2, cost: 2, costType: 'bone', sigils: ['airborne'],          bloodValue: 1, color: '#cfcabc', glyph: '弓' },

  // ===================== ENERGY（能量 · 机械科技主题）=====================
  black_cat:   { name: '电池机偶', atk: 0, hp: 1, cost: 0, costType: 'energy', sigils: [],               bloodValue: 1, color: '#2b3b4b', glyph: '电' },
  magpie:      { name: '磁窃鸟',   atk: 2, hp: 1, cost: 1, costType: 'energy', sigils: [],               bloodValue: 1, color: '#3a3a4a', glyph: '磁' },
  fennec:      { name: '电路狐',   atk: 2, hp: 1, cost: 1, costType: 'energy', sigils: [],               bloodValue: 1, color: '#4a6a8a', glyph: '狐' },
  peacock:     { name: '雷达孔雀', atk: 1, hp: 3, cost: 1, costType: 'energy', sigils: [],               bloodValue: 1, color: '#2a6a9a', glyph: '雷' },
  lynx:        { name: '脉冲猞猁', atk: 3, hp: 2, cost: 2, costType: 'energy', sigils: ['double_strike'],bloodValue: 1, color: '#5a7a9a', glyph: '脉' },
  mantis:      { name: '机械螳螂', atk: 3, hp: 2, cost: 2, costType: 'energy', sigils: ['double_strike'],bloodValue: 1, color: '#4a8a7a', glyph: '械' },
  falcon:      { name: '喷射隼',   atk: 3, hp: 1, cost: 2, costType: 'energy', sigils: ['airborne'],       bloodValue: 1, color: '#5a6a8a', glyph: '隼' },
  ram:         { name: '液压撞羊', atk: 3, hp: 3, cost: 2, costType: 'energy', sigils: [],               bloodValue: 1, color: '#7a8a9a', glyph: '撞' },
  grey_jaguar: { name: '钢甲豹',   atk: 3, hp: 2, cost: 2, costType: 'energy', sigils: [],               bloodValue: 1, color: '#6a7a86', glyph: '钢' },
  eagle:       { name: '涡轮鹰',   atk: 3, hp: 3, cost: 3, costType: 'energy', sigils: ['airborne'],       bloodValue: 1, color: '#4a5a7a', glyph: '涡' },
  bison:       { name: '装甲野牛', atk: 4, hp: 4, cost: 4, costType: 'energy', sigils: [],               bloodValue: 1, color: '#5a6a76', glyph: '装' },
  bull:        { name: '蒸汽蛮牛', atk: 5, hp: 4, cost: 4, costType: 'energy', sigils: [],               bloodValue: 1, color: '#6a5a5a', glyph: '汽' },

  // 新增普通卡
  ant:         { name: '工蚁机', atk: 1, hp: 2, cost: 1, costType: 'energy', sigils: [],               bloodValue: 1, color: '#7a6a4a', glyph: '蚁' },
  cricket:     { name: '蟋蟀机', atk: 2, hp: 2, cost: 1, costType: 'energy', sigils: [],               bloodValue: 1, color: '#6a7a4a', glyph: '蟀' },
  sparrow:     { name: '麻雀机', atk: 1, hp: 2, cost: 1, costType: 'energy', sigils: ['airborne'],     bloodValue: 1, color: '#8a7a5a', glyph: '雀' },
  newt:        { name: '蝾螈机', atk: 2, hp: 3, cost: 1, costType: 'energy', sigils: [],               bloodValue: 1, color: '#4a8a6a', glyph: '螈' },
  weasel:      { name: '鼬鼠机', atk: 3, hp: 2, cost: 2, costType: 'energy', sigils: [],               bloodValue: 1, color: '#6a6a76', glyph: '鼬' },

  // 新增：印记演示卡（通用级）
  armor_tank:  { name: '装甲战车', atk: 3, hp: 4, cost: 3, costType: 'energy', sigils: ['armored'],     bloodValue: 1, color: '#6a7a86', glyph: '车' },

  // [daily 2026-08-09] 尖刺甲虫
  spike_beetle: { name: '尖刺甲虫', atk: 3, hp: 2, cost: 2, costType: 'energy', sigils: ['sharp_quills'],  bloodValue: 1, color: '#6a8a4a', glyph: '刺' },
  // [daily 2026-08-09] 自修机甲
  repair_mech: { name: '自修机甲', atk: 3, hp: 3, cost: 3, costType: 'energy', sigils: ['regen'],          bloodValue: 1, color: '#5a8a9a', glyph: '修' },

  // [daily 2026-08-14] 剧毒蜂
  venom_bee:   { name: '剧毒蜂', atk: 2, hp: 2, cost: 2, costType: 'energy', sigils: ['poison_touch'],     bloodValue: 1, color: '#4a8a3a', glyph: '蜂' },

  // [daily 2026-08-15] 齿轮犬
  gear_hound:  { name: '齿轮犬', atk: 2, hp: 2, cost: 2, costType: 'energy', sigils: ['frenzy'],            bloodValue: 1, color: '#5a7a9a', glyph: '齿' },

  // ===================== MOX（魔石）=====================
  // 魔石体系：魔石生物(ruby/emerald/sapphire) 免费上场，在场时提供对应颜色的魔石；
  // 其余法术卡 costType='gem'，需场上存在对应颜色的魔石才能召唤（召唤不消耗魔石，
  // 但魔石生物死亡即失去该颜色魔石）。cost 字段对 gem 卡无意义，统一填 0。
  ruby_mox:    { name: '红玉魔石', atk: 0, hp: 1, cost: 0, costType: 'gem', gemCost: [],                mox: 'orange', sigils: [],               bloodValue: 1, color: '#e67e22', glyph: '橙' },
  emerald_mox: { name: '翡翠魔石', atk: 0, hp: 1, cost: 0, costType: 'gem', gemCost: [],                mox: 'green',  sigils: [],               bloodValue: 1, color: '#27ae60', glyph: '绿' },
  sapphire_mox:{ name: '蓝宝魔石', atk: 0, hp: 1, cost: 0, costType: 'gem', gemCost: [],                mox: 'blue',   sigils: [],               bloodValue: 1, color: '#2980b9', glyph: '蓝' },
  imp:         { name: '炎晶小鬼', atk: 1, hp: 1, cost: 0, costType: 'gem', gemCost: ['orange'],              sigils: [],                bloodValue: 1, color: '#6a2a4a', glyph: '鬼' },
  panther:     { name: '暗影魔豹', atk: 2, hp: 2, cost: 0, costType: 'gem', gemCost: ['blue'],                sigils: ['double_strike'], bloodValue: 1, color: '#1a1a2a', glyph: '豹' },
  python:      { name: '翠鳞巨蟒', atk: 2, hp: 2, cost: 0, costType: 'gem', gemCost: ['green'],               sigils: [],                bloodValue: 1, color: '#2a5a3a', glyph: '蟒' },
  demon:       { name: '赤焰恶魔', atk: 2, hp: 2, cost: 0, costType: 'gem', gemCost: ['orange'],              sigils: ['poison_touch'],  bloodValue: 1, color: '#7a2a2a', glyph: '魔' },
  basilisk:    { name: '石化蛇怪', atk: 2, hp: 2, cost: 0, costType: 'gem', gemCost: ['green'],               sigils: ['poison_touch'],  bloodValue: 1, color: '#3a6a3a', glyph: '怪' },
  chimera:     { name: '奇美拉',   atk: 2, hp: 3, cost: 0, costType: 'gem', gemCost: ['green','blue'],        sigils: ['pack'],          bloodValue: 1, color: '#6a4a6a', glyph: '奇' },
  golem:       { name: '符文魔像', atk: 2, hp: 5, cost: 0, costType: 'gem', gemCost: ['orange','green'],      sigils: [],                bloodValue: 1, color: '#8a8a96', glyph: '像' },
  manticore:   { name: '蝎尾狮',   atk: 3, hp: 2, cost: 0, costType: 'gem', gemCost: ['orange','blue'],       sigils: ['double_strike'], bloodValue: 1, color: '#9a5a2a', glyph: '狮' },
  griffin:     { name: '苍空狮鹫', atk: 2, hp: 2, cost: 0, costType: 'gem', gemCost: ['blue'],                sigils: ['airborne'],       bloodValue: 1, color: '#caa84a', glyph: '鹫' },
  phoenix:     { name: '不灭凤凰', atk: 3, hp: 3, cost: 0, costType: 'gem', gemCost: ['green','orange','blue'], sigils: ['undying'],      bloodValue: 1, color: '#c85a2a', glyph: '凤' },
  // 新增普通法术卡（魔石卡均为 0 费，可重复）
  sprite:      { name: '焰灵',   atk: 1, hp: 1, cost: 0, costType: 'gem', gemCost: ['orange'],              sigils: [],                bloodValue: 1, color: '#e07a3a', glyph: '灵' },
  wisp:        { name: '翠灵',   atk: 1, hp: 2, cost: 0, costType: 'gem', gemCost: ['green'],               sigils: ['poison_touch'],  bloodValue: 1, color: '#3a9a5a', glyph: '翠' },
  breeze:      { name: '蓝息',   atk: 1, hp: 1, cost: 0, costType: 'gem', gemCost: ['blue'],                sigils: ['airborne'],       bloodValue: 1, color: '#4a8ad0', glyph: '息' },
  ember:       { name: '余烬',   atk: 2, hp: 1, cost: 0, costType: 'gem', gemCost: ['orange'],              sigils: ['brittle'],        bloodValue: 1, color: '#c85a2a', glyph: '烬' },

  // 新增：印记演示卡（通用级）
  soul_reaper: { name: '噬魂死神', atk: 2, hp: 2, cost: 0, costType: 'gem', gemCost: ['orange','green'],     sigils: ['death_touch'],   bloodValue: 1, color: '#7a2a4a', glyph: '死' },
  // [daily 2026-08-09] 冰晶刺客
  frost_assassin: { name: '冰晶刺客', atk: 2, hp: 2, cost: 0, costType: 'gem', gemCost: ['blue'],              sigils: ['sharp_quills'], bloodValue: 1, color: '#4a8ad0', glyph: '冰' },
  // [daily 2026-08-09] 石鳞卫
  stone_scale: { name: '石鳞卫',   atk: 1, hp: 3, cost: 0, costType: 'gem', gemCost: ['green'],               sigils: ['armored'],       bloodValue: 1, color: '#5a7a4a', glyph: '岩' },

  // [daily 2026-08-12] 霜灵
  frostling:  { name: '霜灵',     atk: 1, hp: 2, cost: 0, costType: 'gem', gemCost: ['blue'],                 sigils: ['frenzy'],        bloodValue: 1, color: '#4a8ad0', glyph: '霜' },

  // [daily 2026-08-15] 熔岩哨
  lava_sentinel: { name: '熔岩哨', atk: 1, hp: 2, cost: 0, costType: 'gem', gemCost: ['orange'],               sigils: ['regen'],         bloodValue: 1, color: '#e07a3a', glyph: '熔' },

  // ===================== 神话卡（premium / mythic）=====================
  // 仅可通过魂晶（付费货币）获取：暗夜卡包极低概率掉落 或 直购商店高价购买。
  // 设计原则：比同费用普通卡略强（+1 stat 或多一个印记），但有明确弱点（脆皮/高费/多宝石需求）。
  // 视觉特色：专属宇宙星云背景 + 金色光环 + 动画边框。
  // blood_titan: 比bear(5/4/4)多1攻1血+frenzy，但4费血肉需献祭2只单位。
  blood_titan:    { name: '血肉巨人', atk: 6, hp: 5, cost: 4, costType: 'blood', sigils: ['frenzy'],                bloodValue: 2, color: '#8a0a1a', glyph: '巨', premium: true },
  // vampire_queen: 比dire_wolf(3/3/3)多1血+双印记(回复+致死)，3费需1.5只献祭。
  vampire_queen:  { name: '吸血女王', atk: 3, hp: 4, cost: 3, costType: 'blood', sigils: ['regen','death_touch'],     bloodValue: 2, color: '#6a0a2a', glyph: '吸', premium: true },
  // lich_king: 4费骸骨（需4回合滴流），不死+回复极难杀，但攻击力偏低。
  lich_king:      { name: '巫妖之王', atk: 3, hp: 5, cost: 4, costType: 'bone',  sigils: ['regen','undying'],        bloodValue: 1, color: '#2a1a4a', glyph: '巫', premium: true },
  // bone_dragon: 4费骸骨，飞行+连击=8点直击天平，但3血很脆。
  bone_dragon:    { name: '骨龙',     atk: 4, hp: 3, cost: 4, costType: 'bone',  sigils: ['airborne','double_strike'],bloodValue: 1, color: '#d8d0c0', glyph: '龙', premium: true },
  // omega_core: 5费能量（满能才可出），铁桶+回复，终局终结者。
  omega_core:     { name: '欧米伽核心', atk: 5, hp: 5, cost: 5, costType: 'energy', sigils: ['armored','regen'],      bloodValue: 1, color: '#0a3a5a', glyph: 'Ω',  premium: true },
  // storm_harrier: 3费能量，飞行+连击=8点空袭，但2血极易被远程/法术清除。
  storm_harrier:  { name: '风暴鹞',   atk: 4, hp: 2, cost: 3, costType: 'energy', sigils: ['airborne','double_strike'],bloodValue: 1, color: '#2a6aaa', glyph: '风', premium: true },
  // archmage: 需三色全宝石，双印记(连击+回复)，终极魔石回报。
  archmage:       { name: '大法师',   atk: 4, hp: 4, cost: 0, costType: 'gem', gemCost: ['orange','green','blue'], sigils: ['double_strike','regen'], bloodValue: 1, color: '#6a2a8a', glyph: '法', premium: true },
  // void_phantom: 需2色宝石，飞行+致死，极难被地面单位处理。
  void_phantom:   { name: '虚空幻影', atk: 3, hp: 3, cost: 0, costType: 'gem', gemCost: ['orange','blue'],        sigils: ['airborne','death_touch'], bloodValue: 1, color: '#3a0a3a', glyph: '虚', premium: true },
};

// Faction metadata + the card pool the deck builder offers for each faction.
export const FACTIONS = {
  blood: {
    key: 'blood', name: '血肉', res: 'blood', color: '#b5341f',
    desc: '每回合获得 1 点「当回合血肉」（不攒、回合开始重置，可单独召唤 1 费牌）。更高费用的血肉牌需在当回合血肉基础上，额外献祭场上已召唤的单位来支付。0 费牌可直接打出，作为铺场与祭品。',
    cards: ['squirrel','stoat','raven','mole','beaver','adder','raccoon','opossum','wolf','bullfrog','vulture','cougar','dire_wolf','hound','skunk','great_white','warthog','bear','wolf_cub','field_mouse','toad','shrew','hawk','ferret','viper_king','warg','rat_king','berserker','armored_badger','hedgehog','porcupine','otter','blood_titan','vampire_queen'],
  },
  bone: {
    key: 'bone', name: '骸骨', res: 'bone', color: '#9aa0a8',
    desc: '亡灵墓地大军：你的生物死亡时积累骸骨，用骸骨召唤亡灵。用 0 费「枯骨幼犬」免费铺场、送死换取骸骨。',
    cards: ['bone_pup','rat','cat','spider','bat','skeleton','corpse','crab','scorpion','zombie','black_widow','turtle','bone_hound','geck','lizard','snail','moth','beetle','bonesnake','bone_warden','grave_moss','tomb_guard','bone_archer','lich_king','bone_dragon'],
  },
  energy: {
    key: 'energy', name: '能量', res: 'energy', color: '#3a8ad0',
    desc: '机械军团：能量每回合从 1 点爬升至 6 点封顶、整回满，指挥钢铁与电路组成的战争机器。',
    cards: ['black_cat','magpie','fennec','peacock','lynx','mantis','falcon','ram','grey_jaguar','eagle','bison','bull','ant','cricket','sparrow','newt','weasel','armor_tank','spike_beetle','repair_mech','venom_bee','gear_hound','omega_core','storm_harrier'],
  },
  mox: {
    key: 'mox', name: '魔石', res: 'mox', color: '#9a4ad0',
    desc: '魔石体系：上场「魔石生物」(红玉/翡翠/蓝宝) 即可获得对应颜色的魔石。法术卡需要场上存在对应颜色的魔石才能召唤——魔石不消耗，但魔石生物一旦死亡就会失去该魔石。',
    cards: ['ruby_mox','emerald_mox','sapphire_mox','imp','panther','python','demon','basilisk','chimera','golem','manticore','griffin','phoenix','sprite','wisp','breeze','ember','soul_reaper','frost_assassin','stone_scale','frostling','lava_sentinel','archmage','void_phantom'],
  },
};

// Ready-made decks (arrays of card ids), kept for quick-start / AI opponents.
// 规则：有费卡（含需特定魔石的魔石法术卡）每张限 1 张，0 费免费卡可重复（2 份）。
function deckCopies(id) { return isCostedCard(id) ? 1 : 2; }
// 神话卡不进入默认卡组（AI 和玩家初始牌组都不含 premium 卡）
const _nonPremium = (id) => !CARDS[id] || !CARDS[id].premium;
export const DECKS = {
  blood:  FACTIONS.blood.cards.filter(_nonPremium).flatMap((id) => Array(deckCopies(id)).fill(id)),
  bone:   FACTIONS.bone.cards.filter(_nonPremium).flatMap((id) => Array(deckCopies(id)).fill(id)),
  energy: FACTIONS.energy.cards.filter(_nonPremium).flatMap((id) => Array(deckCopies(id)).fill(id)),
  mox:    FACTIONS.mox.cards.filter(_nonPremium).flatMap((id) => Array(deckCopies(id)).fill(id)),
};

// Build a default deck for a faction (each card x2, padded to a sane size).
export function defaultDeck(factionKey) {
  const f = FACTIONS[factionKey];
  if (!f) return DECKS.blood.slice();
  const out = [];
  for (const id of f.cards) {
    if (CARDS[id] && CARDS[id].premium) continue;   // 神话卡不进入默认卡组
    const n = isCostedCard(id) ? 1 : 2;   // 有费的卡（含需魔石的法术卡）每张限 1 张
    for (let i = 0; i < n; i++) out.push(id);
  }
  return out.slice(0, CONFIG.DECK_MAX);
}

export function getCard(id) { return CARDS[id]; }

// ============================================================================
// COLLECTION / RARITY / GACHA
// ============================================================================
// Rarity tiers drive gacha drop weights, dust (coin) refunds on duplicates,
// and card-frame colors. Higher rarity = rarer & shinier.
export const RARITY = {
  common: { key: 'common', name: '普通', color: '#9aa0a8', glow: 'rgba(154,160,168,.5)', weight: 62, dust: 15 },
  rare:   { key: 'rare',   name: '稀有', color: '#3a9ad0', glow: 'rgba(58,154,208,.65)', weight: 27, dust: 35 },
  epic:   { key: 'epic',   name: '史诗', color: '#a95ad0', glow: 'rgba(169,90,208,.7)',  weight: 9,  dust: 90 },
  legend: { key: 'legend', name: '传说', color: '#e0b03a', glow: 'rgba(224,176,58,.8)',  weight: 2,  dust: 220 },
  mythic: { key: 'mythic', name: '神话', color: '#ff3366', glow: 'rgba(255,51,102,.9)',  weight: 0,  dust: 500 },
  // mythic: weight=0 → 永不出现在普通包；仅暗夜包有极低概率；直购价格极高。
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legend', 'mythic'];

// A few explicit rarity overrides for signature cards; everything else is
// derived from cost / gem complexity below.
const RARITY_OVERRIDE = {
  squirrel: 'common', bone_pup: 'common',
  bear: 'legend', phoenix: 'legend', great_white: 'epic',
  cougar: 'epic', dire_wolf: 'epic', black_widow: 'epic', turtle: 'epic',
  // Ensure every faction has enough starter (common) cards for a 10-card deck:
  grey_jaguar: 'common',                       // energy: brings commons to 5 (x2 = 10)
  imp: 'common', python: 'common', griffin: 'common', // mox: 3 generators + 1 payoff per color
  // New sigil demo cards are common so they're immediately playable & testable:
  viper_king: 'common', bone_warden: 'common', armor_tank: 'common', soul_reaper: 'common',
  warg: 'common', rat_king: 'common', berserker: 'common',
  // Mythic (premium) cards — only obtainable via Soul Crystals (魂晶)
  blood_titan: 'mythic', vampire_queen: 'mythic',
  lich_king: 'mythic', bone_dragon: 'mythic',
  omega_core: 'mythic', storm_harrier: 'mythic',
  archmage: 'mythic', void_phantom: 'mythic',
};

export function rarityOf(id) {
  if (RARITY_OVERRIDE[id]) return RARITY_OVERRIDE[id];
  const c = CARDS[id];
  if (!c) return 'common';
  if (c.costType === 'gem') {
    if (c.mox) return 'common';                 // Mox generator creatures are basic
    const n = (c.gemCost || []).length;
    return n >= 3 ? 'legend' : n === 2 ? 'epic' : 'rare';
  }
  const cost = c.cost || 0;
  return cost >= 4 ? 'legend' : cost >= 3 ? 'epic' : cost >= 2 ? 'rare' : 'common';
}

export function allCardIds() { return Object.keys(CARDS); }

// Cards a brand-new player owns for free: every "common" tier card, so each
// faction has enough basics to build a starter deck immediately. Everything
// rarer starts LOCKED and must be earned through card packs.
export function starterUnlocked() {
  return allCardIds().filter((id) => rarityOf(id) === 'common');
}

// Card pack economy.
export const PACK = {
  cost: 100,          // coins per pack
  startCoins: 800,    // coins a new profile begins with
  winReward: 120,     // coins for winning a match
  loseReward: 40,     // consolation coins
  residualDupChance: 0,    // 0 = 图鉴未集齐前绝不重复（始终从"未拥有"卡池抽取）；集齐后才会必然重复并按稀有度返还金币
};

// ============================================================================
// PREMIUM CURRENCY: 魂晶 (Soul Crystals 💎)
// ============================================================================
// 魂晶是充值获得的付费货币。金币是免费游戏货币（对战获取）。
// 魂晶用途：① 暗夜卡包（保底稀有+，更高史诗/传说概率）
//           ② 直购指定卡牌（跳过随机，按稀有度定价）
//           ③ 兑换金币（1 魂晶 = 25 金币）

// 暗夜卡包：魂晶购买，掉率大幅优于普通包（保底 rare+）
// mythic 卡仅通过暗夜包极低概率掉落或直购获得，普通包永不出。
export const GEM_PACK = {
  cost: 30,           // 魂晶 per pack
  // 掉率权重：common 被压制，epic/legend 大幅提升，mythic 极低概率
  weights: { common: 20, rare: 38, epic: 26, legend: 12, mythic: 4 },
  // 保底机制：最低稀有度 = rare（不会出 common）
  minRarity: 'rare',
  residualDupChance: 0,   // 同普通包：图鉴未集齐前不重复
};

// 直购商店：按稀有度定价（魂晶）
export const CARD_SHOP_PRICES = {
  common: 5,
  rare: 15,
  epic: 40,
  legend: 100,
  mythic: 200,   // 神话卡直购价格极高
};

// 充值档位（模拟支付，无真实交易）
export const RECHARGE_PACKAGES = [
  { id: 'r6',   price: 6,   gems: 60,   bonus: 0,   label: '入门' },
  { id: 'r30',  price: 30,  gems: 300,  bonus: 30,  label: '日常' },
  { id: 'r98',  price: 98,  gems: 980,  bonus: 150, label: '超值' },
  { id: 'r328', price: 328, gems: 3280, bonus: 600, label: '豪礼' },
];

// 魂晶兑换金币
export const GEM_EXCHANGE = {
  rate: 25,           // 1 魂晶 = 25 金币
  minGems: 1,         // 最低兑换 1 魂晶
};

// ===================== 更新日志（产品内可见，最新在前）=====================
// 每日新增卡牌自动化会在头部追加当日条目；手动重大改动也写在这里。
export const CHANGELOG = [
  {
    version: 'v0.5.2',
    date: '2026-08-15',
    title: '界面布局设置（可选紧凑模式）',
    items: [
      '新增「界面布局」开关（主菜单 🎚 按钮，设置里可调）：标准（默认）/ 紧凑。',
      '紧凑布局：选择模式菜单改为三列网格铺开；组卡界面改为「左侧阵营栏 + 右侧卡牌」真双栏（阵营栏吸顶，卡牌区独立滚动）。',
      '布局偏好随账号持久化，重新进入自动恢复；默认仍为标准布局。',
    ],
  },
  {
    version: 'v0.5.1',
    date: '2026-08-12',
    title: '排位赛 · 线上 P2P',
    items: [
      '排位赛新增「线上 P2P 对战」：双方各用自己设备与账号，房主创建房间、对方输入房间号/邀请码加入，WebRTC 直连（无需服务器）。',
      '双方段位各自独立结算——房主=玩家A、挑战者=玩家B，各自按胜负升降自己的段位，互不干扰。',
      '支持两种连接方式：一键房号（PeerJS 信令）与「邀请码」模式（原始 WebRTC + 公共 STUN，摆脱对信令服务器的依赖）。',
      '排位房主邀请链接使用 ?rjoin= 参数，对方打开即进入排位加入流程；同屏双人入口仍保留。',
    ],
  },
  {
    version: 'v0.5.0',
    date: '2026-08-12',
    title: '排位赛（PVP 段位）',
    items: [
      '新增「排位赛」模式，仅限 PVP（同屏双人对战），菜单新增入口。',
      '段位体系：共六阶（一阶最低 → 六阶最高），每阶分下 / 中 / 上三个小阶，共 18 个段位。',
      '胜 +30 晋级分、负 −30 晋级分；小阶内满 100 分晋级上一阶，归零则降级；封顶六阶·上、封底一阶·下。',
      '主菜单顶栏实时显示当前段位；排位赛界面含段位徽章、晋级进度条与排位战绩。',
    ],
  },
  {
    version: 'v0.4.0',
    date: '2026-08-11',
    title: '神话卡牌与付费货币',
    items: [
      '新增付费货币「魂晶」(💎)：充值获取，用于暗夜卡包、直购卡牌、兑换金币。',
      '新增「神话」稀有度——8 张高级卡牌（血肉巨人 / 吸血女王 / 巫妖之王 / 骨龙 / 欧米伽核心 / 风暴鹞 / 大法师 / 虚空幻影），仅可通过魂晶获取。',
      '神话卡牌拥有专属宇宙星云背景、金色光环与动画边框，强度略高于同费普通卡但有明确弱点。',
      '暗夜卡包新增 4% 神话掉率；直购商店神话卡定价 200 💎。',
      '手机端全面适配：5 个响应式断点 + 触屏优化。',
    ],
  },
  {
    version: 'v0.3.0',
    date: '2026-08-09',
    title: '内容扩展与更名',
    items: [
      '产品正式更名为「邪刻」。',
      '上线「每日新增卡牌」：现已加入 重甲獾 / 尖刺甲虫 / 冰晶刺客 三张新卡，之后每天持续扩充。',
      '新增本更新日志，记录每次重要改动。',
      '2026-08-09 每日新增：墓苔尸 / 自修机甲 / 石鳞卫',
      '2026-08-12 每日新增：刺猬 / 冢卫 / 霜灵',
      '2026-08-14 每日新增：豪猪 / 骨弓手 / 剧毒蜂',
      '2026-08-15 每日新增：水獭 / 齿轮犬 / 熔岩哨',
    ],
  },
  {
    version: 'v0.2.0',
    date: '2026-08-02',
    title: '平衡重做与修复',
    items: [
      '重做血肉机制：移除无偿发放的血肉，献祭产出可在本回合内保留并滚雪球铺场，血肉阵营强度回归正常。',
      '修复 0 攻击力卡牌（如松鼠）误触发「-0」攻击特效与扑击动画的问题。',
      '四阵营胜率校准至约 50%（普通 / 困难难度胜率差 spread ≤ 10）。',
      '部署至公网，可分享链接直接试玩。',
    ],
  },
  {
    version: 'v0.1.0',
    date: '初版',
    title: '核心玩法上线',
    items: [
      '四阵营（血肉 / 骸骨 / 能量 / 魔石），各自独立的资源与召唤方式。',
      '单机对战 AI（简单 / 普通 / 困难）、本地联机、同屏双人。',
      '新手教程、卡牌图鉴、抽卡开包、自由组卡。',
      '像素风渲染、音效、天平胜负机制，以及多种印记（飞行 / 连击 / 毒触 / 尖刺 / 不死 / 断尾 / 头狼 / 易碎 等）。',
    ],
  },
];
