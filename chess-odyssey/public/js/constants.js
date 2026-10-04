// 《残局 · 第一章》——国际象棋主题的战术 Roguelike 主线
// 战斗机制沿用《邪刻》：纵列阻挡 + 天平推分取胜（winScale=5）+ 印记系统
// 纯数据 + 纯函数，Node 与浏览器共用（ES Module）

// ---------------------------------------------------------------- 战斗常量
export const BATTLE = {
  FILES: 6,          // 棋盘宽 a-f
  RANKS: 6,          // 棋盘高 1-6（0 为最下方 = 玩家底线）
  WIN_SCALE: 5,      // 天平分差达到该值即取胜（与《邪刻》winScale 一致）
  FRENZY_CAP: 6,     // 狂热印记每回合 +1 攻的上限
};

// ---------------------------------------------------------------- 棋子类型
// move：走法标识；range：滑行类棋子的最大射程（非滑行类为 1 或跳跃固定）
export const PIECES = {
  pawn:   { name: '兵', glyph: '♟', atk: 1, hp: 2, move: 'pawn',   range: 1, desc: '前进一格；只能斜前方攻击' },
  knight: { name: '马', glyph: '♞', atk: 2, hp: 3, move: 'knight', range: 1, desc: '日字跳，可越过任何棋子' },
  bishop: { name: '象', glyph: '♝', atk: 2, hp: 2, move: 'bishop', range: 3, desc: '沿斜线滑行（最多 3 格）' },
  rook:   { name: '车', glyph: '♜', atk: 3, hp: 4, move: 'rook',   range: 3, desc: '沿直线滑行（最多 3 格）' },
  queen:  { name: '后', glyph: '♛', atk: 4, hp: 5, move: 'queen',  range: 3, desc: '直线与斜线皆可滑行（最多 3 格）' },
  king:   { name: '王', glyph: '♚', atk: 2, hp: 6, move: 'king',   range: 1, desc: '八方一格' },
};

// ---------------------------------------------------------------- 印记
export const SIGILS = {
  airborne:      { name: '飞行', desc: '无视阻挡，其攻击力始终计入天平' },
  armored:       { name: '厚甲', desc: '受到的每次伤害 -1（最低 1）' },
  regen:         { name: '回复', desc: '每回合结束恢复 1 点血' },
  frenzy:        { name: '狂热', desc: `每回合攻击力 +1（上限 ${BATTLE.FRENZY_CAP}）` },
  double_strike: { name: '双击', desc: '攻击时造成两次伤害' },
  sharp_quills:  { name: '尖刺', desc: '被攻击时反弹 1 点伤害' },
};
export const SIGIL_IDS = Object.keys(SIGILS);

// ---------------------------------------------------------------- 战役常量
export const CAMPAIGN = {
  MAP: 8,             // 章节地图 8×8
  START: [0, 0],      // 玩家王起点 a1
  THRONE: [7, 7],     // 黑王王座 h8
  CANDLES: 24,        // 本局蜡烛（步数），耗尽即死
  PARTY: ['pawn', 'pawn', 'knight'], // 初始队伍
};

// ---------------------------------------------------------------- 遭遇类型
export const ENCOUNTERS = {
  battle:  { name: '交锋', glyph: '⚔', desc: '一场棋局厮杀' },
  elite:   { name: '强手', glyph: '☗', desc: '更危险的对手，战利品更好' },
  event:   { name: '异象', glyph: '✦', desc: '棋盘外的低语' },
  promote: { name: '升变', glyph: '⬆', desc: '让一名兵完成升变' },
  rest:    { name: '休整', glyph: '✚', desc: '喘息之所' },
  boss:    { name: '王座', glyph: '♚', desc: '黑王在此等候' },
  empty:   { name: '空格', glyph: '·', desc: '什么也没有' },
};

// ---------------------------------------------------------------- 敌方编成（按地图推进深度取用）
export const ENEMY_SQUADS = {
  battle: [
    ['pawn', 'pawn'],
    ['pawn', 'pawn', 'knight'],
    ['pawn', 'knight', 'bishop'],
    ['pawn', 'pawn', 'knight', 'bishop'],
    ['knight', 'bishop', 'pawn', 'pawn'],
    ['rook', 'pawn', 'pawn', 'knight'],
  ],
  elite: [
    ['rook', 'knight', 'pawn'],
    ['bishop', 'knight', 'pawn', 'pawn'],
    ['rook', 'bishop', 'pawn', 'pawn'],
    ['queen', 'pawn', 'pawn'],
  ],
  boss: [
    ['king', 'queen', 'rook', 'rook'],
  ],
};

// Boss 专属：黑王与后各带一个印记，让终局有辨识度
export const BOSS_SIGILS = { king: ['armored'], queen: ['double_strike'], rook: [] };

// ---------------------------------------------------------------- 遗物
export const RELICS = {
  wax_seal: { name: '火漆印', glyph: '❂', desc: '每场战斗开始时，我方天平 +1' },
  gear:     { name: '铜齿轮', glyph: '⚙', desc: '每场战斗胜利后，蜡烛 +1' },
  mirror:   { name: '镜面',   glyph: '◈', desc: '每场战斗中，我方首个阵亡的棋子以半血复活' },
  tongs:    { name: '铁钳',   glyph: '⊐', desc: '我方所有单位获得「厚甲」' },
};
export const RELIC_IDS = Object.keys(RELICS);

// ---------------------------------------------------------------- 事件（Inscryption 式的低语与抉择）
// choice.effect 由 campaign.js 解释执行
export const EVENTS = [
  {
    id: 'candlestick',
    title: '烛台',
    text: '一只半燃的蜡烛立在棋盘边上，火苗朝你倾斜，像在等你先开口。',
    choices: [
      { label: '点燃它', effect: { candles: 3 }, result: '你借了它的火。蜡烛 +3。' },
      { label: '吹熄它', effect: { healAll: 1 }, result: '黑暗里，棋子们各自愈合。全队 +1 血。' },
    ],
  },
  {
    id: 'mirror_hall',
    title: '镜厅',
    text: '格子外的世界是一排镜子，里面站着你自己的棋子，动作慢了半拍。',
    choices: [
      { label: '复制一名棋子', effect: { duplicate: true }, result: '它从镜中走出，与你并肩。队伍多了一名同名棋子。' },
      { label: '让一名兵升变', effect: { promote: true }, result: '镜子里的兵戴上了冠。' },
    ],
  },
  {
    id: 'sacrifice',
    title: '弃子',
    text: '执局者把一枚兵推到你面前：「有时候，赢棋要先学会输子。」',
    choices: [
      { label: '交出一名棋子', effect: { sacrificeForAtk: 1 }, result: '棋子碎裂，其余人的刀锋更利。全队攻击 +1。' },
      { label: '拒绝', effect: { candles: -2 }, result: '你盯着他看了很久。蜡烛 -2。' },
    ],
  },
  {
    id: 'chessbox',
    title: '棋匣',
    text: '匣盖半开，里面是一件不属于这副棋的旧物。',
    choices: [
      { label: '取走', effect: { relic: true }, result: '你获得了一件遗物。' },
      { label: '合上', effect: { healAll: 2 }, result: '你什么也没拿。全队 +2 血。' },
    ],
  },
  {
    id: 'whisper',
    title: '低语',
    text: '有人在棋盘底下说话，声音像棋子互相摩擦。它说可以让你的一名棋子更强——代价是时间。',
    choices: [
      { label: '倾听', effect: { buffRandom: [1, 2], candles: -2 }, result: '一名棋子获得 +1 攻 +2 血，蜡烛 -2。' },
      { label: '掩耳', effect: { candles: 1 }, result: '你选择不听。蜡烛 +1。' },
    ],
  },
  {
    id: 'endgame_study',
    title: '残局图谱',
    text: '摊开的图谱上画着一个你还没走到过的局面，边角写着：「兵到底线，即成人。」',
    choices: [
      { label: '研读', effect: { promote: true }, result: '你学会了一件事：升变。' },
      { label: '跳过', effect: { healAll: 1 }, result: '你合上图谱，稍作休整。全队 +1 血。' },
    ],
  },
];

// ---------------------------------------------------------------- 战后三选一（战利品）
export const LOOT_KINDS = {
  recruit: { name: '招募', desc: '获得一名新棋子' },
  sharpen: { name: '磨锋', desc: '一名棋子攻击 +1' },
  temper:  { name: '淬甲', desc: '一名棋子血量 +2' },
  sigil:   { name: '授印', desc: '一名棋子获得一个印记' },
};
export const RECRUIT_POOL = ['pawn', 'knight', 'bishop', 'rook'];

// ---------------------------------------------------------------- 升变选项
export const PROMOTE_CHOICES = ['queen', 'rook', 'bishop', 'knight'];

// ---------------------------------------------------------------- 平衡旋钮
// candleBonus：在章节设定蜡烛数之上的全局补贴。用于校正「练级路线所需步数」
// 与章节设定值之间的差距（由整局蒙特卡洛回归得出，勿随意改动）。
export const TUNING = {
  candleBonus: 6,
};

// ---------------------------------------------------------------- 第一章文本（暗调叙事）
export const CHAPTER1 = {
  id: 'ch1',
  title: '第一章 · 残局',
  subtitle: 'THE ENDGAME',
  intro: [
    '你在烛火下醒来。桌上摆着一盘棋，黑方已经走完了它的第一手。',
    '一个声音从棋盘对面传来——他自称「执局者」。他说这盘棋从很久以前就在下，而你只是最新一枚被放上去的白子。',
    '「走到 h8，或者留在这里。」他把蜡烛推到你面前，「每一步都要烧掉一点时间。用完了，你就归这副棋所有。」',
  ],
  throneIntro: '黑王坐在 h8。它抬头看你，第一次露出近似微笑的表情：「你也走到这里了。」',
  winText: '黑王倒下时，烛火一起熄灭。执局者收拾棋盘，说：「第一章，你赢了。」他在棋盘边缘刻下一道痕——那是记录。',
  loseText: '蜡烛燃尽。你的棋子停在原地，慢慢变成了木头。执局者把它们一枚枚收回匣子里。',
  outOfCandles: '最后一支蜡烛烧到了底。黑暗合拢。',
};

// ---------------------------------------------------------------- 战利品/文本工具
export function pieceLabel(type) {
  const p = PIECES[type];
  return p ? `${p.glyph} ${p.name}` : type;
}
