// 《残局》——章节内容数据（4 章）
// 每章描述一张 8×8 的章节地图、蜡烛（步数）、敌方编成、修正器与叙事文本。
// 第一章文本沿用 constants.js 中的 CHAPTER1；第二至四章为本文件新写。
// 纯数据，Node 与浏览器共用（ES Module）

import { CHAPTER1 } from './constants.js';

export const CHAPTERS = [
  // ============================================================ 第一章
  {
    id: 'ch1',
    title: '第一章 · 残局',
    subtitle: 'THE ENDGAME',
    board: 8,
    start: [0, 0],
    throne: [7, 7],
    candles: 24,
    party: ['pawn', 'pawn', 'knight'],
    bossName: '黑王',
    boss: ['king', 'queen', 'rook'],
    bossSigils: { king: ['armored'], queen: ['double_strike'] },
    tiers: [
      ['pawn', 'pawn'],
      ['pawn', 'pawn', 'knight'],
      ['pawn', 'knight', 'bishop'],
      ['pawn', 'pawn', 'knight', 'bishop'],
    ],
    elitePool: [
      ['rook', 'knight', 'pawn'],
      ['bishop', 'knight', 'pawn', 'pawn'],
      ['queen', 'pawn', 'pawn'],
    ],
    tiles: { battle: 8, elite: 2, promote: 2, rest: 3, event: 6 },
    modifiers: {
      enemyAdvance: 0,
      scaleBonus: 0,
      restHeal: 999,
      battleCandleCost: 0,
    },
    theme: { name: '烛火棋室', accent: '#c9a24a', bg: '#141210' },
    intro: CHAPTER1.intro,
    throneIntro: CHAPTER1.throneIntro,
    winText: CHAPTER1.winText,
    loseText: CHAPTER1.loseText,
    outOfCandles: CHAPTER1.outOfCandles,
    events: [
      {
        id: 'ch1_candle_stub',
        title: '烛泪',
        text: '你的蜡烛烧得比想象中快。烛台上积着一洼温热的蜡，里面封着半枚指纹——不是你的。执局者说：「别心疼，时间本来就不是你的东西。」',
        choices: [
          { label: '刮下烛泪，续上火', effect: { candles: 3 }, result: '蜡重新凝成一支短烛。蜡烛 +3。' },
          { label: '让棋子就着火光歇一会', effect: { healAll: 1 }, result: '棋子们围拢过来，木纹里渗出暖意。全队 +1 血。' },
        ],
      },
      {
        id: 'ch1_wooden_box',
        title: '匣中旧物',
        text: '棋匣底层卡着一件不属于这副棋的东西：一枚磨圆了的铜齿轮，齿间还夹着干掉的蜡。执局者瞥了一眼，笑而不答。',
        choices: [
          { label: '取走', effect: { relic: true }, result: '你把它揣进袖子。你获得了一件遗物。' },
          { label: '推回匣底', effect: { healAll: 2 }, result: '你什么也没拿，棋子们松了口气。全队 +2 血。' },
        ],
      },
      {
        id: 'ch1_first_lesson',
        title: '第一课',
        text: '执局者把一枚兵推到棋盘中央：「它最弱，也最不老实。走到对面底线，它就能成为任何东西。」他顿了顿，「包括你。」',
        choices: [
          { label: '让一名兵升变', effect: { promote: true }, result: '你学会了这盘棋里唯一温柔的规则：升变。' },
          { label: '把兵退回去', effect: { healAll: 1, candles: -1 }, result: '你什么也没改变，只是多耗了一点时间。全队 +1 血，蜡烛 -1。' },
        ],
      },
    ],
  },

  // ============================================================ 第二章
  {
    id: 'ch2',
    title: '第二章 · 镜厅',
    subtitle: 'THE MIRROR HALL',
    board: 8,
    start: [7, 0],
    throne: [0, 7],
    candles: 24,
    party: ['pawn', 'knight', 'bishop'],
    bossName: '镜王',
    boss: ['king', 'queen', 'queen', 'bishop'],
    bossSigils: { king: ['armored'], queen: ['sharp_quills'], bishop: ['airborne'] },
    tiers: [
      ['pawn', 'pawn', 'knight'],
      ['pawn', 'knight', 'bishop', 'pawn'],
      ['knight', 'bishop', 'rook', 'pawn'],
      ['knight', 'rook', 'bishop', 'pawn', 'pawn'],
    ],
    elitePool: [
      ['rook', 'knight', 'pawn'],
      ['bishop', 'knight', 'pawn', 'pawn'],
      ['queen', 'knight', 'pawn'],
      ['queen', 'bishop', 'pawn', 'pawn'],
    ],
    tiles: { battle: 8, elite: 4, promote: 2, rest: 3, event: 5 },
    modifiers: {
      enemyAdvance: 1,
      scaleBonus: 0,
      restHeal: 999,
      battleCandleCost: 0,
    },
    theme: { name: '镜厅', accent: '#8fb8c9', bg: '#101418' },
    intro: [
      '第一道刻痕之后，墙塌了。塌下来的部分是一面镜子，镜子后面还有一间同样的棋室，还有一支同样的蜡烛。',
      '执局者的声音从四面八方来：「这一章的对手你已经见过了——是你。」',
      '镜子里的白王比你早半步抬手。它下的每一步都和你想的一模一样，只是更早。走到对角线的王座，别去看自己的脸太久。',
    ],
    throneIntro: '王座是一整块水银。镜王从里面浮出来，戴着和你一样的冠，脸却是空白的：「你终于肯下自己了。」',
    winText: '镜面碎成一片片，每一片里都站着一个举棋不定的你。执局者蹲下来捡了一片：「记住这种感觉。后面还有比你更像你的东西。」',
    loseText: '你的棋子碎在镜子里，碎片里也有棋子跟着碎。执局者说：「看，它连输都学得这么快。」',
    outOfCandles: '烛火在镜中反射了一千次，然后一起灭了。',
    events: [
      {
        id: 'ch2_mirror_twin',
        title: '镜中同行者',
        text: '一面立镜里站着你的骑士，它举刀的姿势和你记忆里完全一致。你向前一步，它退后一步；你停下来，它才敢动。它好像一直在等你先犯错。',
        choices: [
          { label: '伸手把它拉出来', effect: { duplicate: true }, result: '它穿过镜面，与你并肩站立，眼神却始终避开你。队伍多了一名同名棋子。' },
          { label: '朝镜子挥刀', effect: { candles: -2, healAll: 1 }, result: '镜子裂了，碎片划破你的手指，也让你的棋子清醒了一点。蜡烛 -2，全队 +1 血。' },
        ],
      },
      {
        id: 'ch2_reflection_bargain',
        title: '倒影的交易',
        text: '倒影开口了，用的是你的声音：「我替你走十步，你把脸留给我。」它伸出手，掌心是一支燃了一半的蜡烛——和你的那支一样长。',
        choices: [
          { label: '接过那支蜡烛', effect: { candles: 4, healAll: -1 }, result: '你多了一段不属于自己的时间，棋子们却变得陌生。蜡烛 +4，全队 -1 血。' },
          { label: '拒绝，并吹灭它', effect: { candles: 1 }, result: '倒影在黑暗里消失了。你保住了自己的脸。蜡烛 +1。' },
        ],
      },
      {
        id: 'ch2_cracked_glass',
        title: '裂镜',
        text: '地上有半面碎镜，每一片里都映着一枚兵的最后一步。踩上去会疼，但疼的地方正好是棋子们结痂的地方。',
        choices: [
          { label: '踩过去', effect: { sacrificeForAtk: 1 }, result: '一枚棋子被割碎，其余人踩着它的碎片，刀锋更利。全队攻击 +1。' },
          { label: '绕开', effect: { candles: -2, buffRandom: [1, 2] }, result: '你绕了远路，一名棋子在途中长出了新的形状。一名棋子 +1 攻 +2 血，蜡烛 -2。' },
        ],
      },
    ],
  },

  // ============================================================ 第三章
  {
    id: 'ch3',
    title: '第三章 · 发条',
    subtitle: 'THE CLOCKWORK',
    board: 8,
    start: [0, 0],
    throne: [7, 7],
    candles: 20,
    party: ['pawn', 'pawn', 'knight', 'bishop'],
    bossName: '发条王',
    boss: ['king', 'rook', 'rook', 'knight'],
    bossSigils: { king: ['armored'], rook: ['armored', 'regen'], knight: ['frenzy'] },
    tiers: [
      ['pawn', 'pawn', 'knight'],
      ['pawn', 'knight', 'bishop', 'pawn'],
      ['knight', 'bishop', 'rook', 'pawn', 'pawn'],
      ['knight', 'rook', 'bishop', 'pawn', 'pawn'],
    ],
    elitePool: [
      ['rook', 'knight', 'pawn', 'pawn'],
      ['bishop', 'rook', 'pawn', 'pawn'],
      ['queen', 'knight', 'pawn'],
      ['rook', 'rook', 'pawn'],
    ],
    tiles: { battle: 10, elite: 3, promote: 2, rest: 2, event: 5 },
    modifiers: {
      enemyAdvance: 0,
      scaleBonus: 0,
      restHeal: 2,
      battleCandleCost: 1,
    },
    theme: { name: '发条棋室', accent: '#b5763f', bg: '#161310' },
    intro: [
      '镜子的碎片落尽之后，是一间装满齿轮的房间。每走一步，墙里就有一枚齿咬合一次，咔哒一声，像有人在替你数心跳。',
      '执局者拧了拧自己袖口的铜钥匙：「这一章没有镜子。这里只有计数。你每走一步，都会被记下来；你每打一仗，都要多烧一支蜡烛。」',
      '蜡烛比上一章短。齿轮不等人——它们只是转。',
    ],
    throneIntro: '发条王端坐在齿轮堆成的王座上，胸口插着一把钥匙。它说：「我不需要比你强。我只需要比你准时。」',
    winText: '钥匙拔出来的时候，整间屋子停了一拍。执局者把停摆的齿轮一枚枚捡起，说：「你听见了吗？这是你自己走出来的节拍。」',
    loseText: '你的棋子卡进齿缝里，一格一格被碾成木屑。齿轮没有停，它们只是换了个方向继续转。',
    outOfCandles: '最后一支蜡烛烧到了底。齿轮咬合的声音没有停，只是不再为你数。',
    events: [
      {
        id: 'ch3_gear_oil',
        title: '油壶',
        text: '墙上挂着一只铜油壶，壶嘴上刻着一行小字：「给转动的东西上油，它会替你多走一段。」壶里剩的不多，闻起来像烧焦的蜡。',
        choices: [
          { label: '给自己上油', effect: { candles: 3 }, result: '你滑过了两段本该耗掉的路。蜡烛 +3。' },
          { label: '给棋子们上油', effect: { healAll: 2 }, result: '齿轮咬合声变柔了，棋子们的关节不再咯吱作响。全队 +2 血。' },
        ],
      },
      {
        id: 'ch3_escapement',
        title: '擒纵机构',
        text: '一枚细小的擒纵爪卡在半空，它每秒放过一个齿。执局者说：「它决定了这间屋子有多快。」他递给你一把钳子，没说该夹哪里。',
        choices: [
          { label: '掰断它', effect: { candles: -3, buffRandom: [2, 0] }, result: '屋子乱了一瞬，一名棋子趁乱长出更利的刃。一名棋子 +2 攻，蜡烛 -3。' },
          { label: '把它拧紧', effect: { candles: 2, healAll: 1 }, result: '节奏稳住了，你反而走得更快。蜡烛 +2，全队 +1 血。' },
        ],
      },
      {
        id: 'ch3_spare_spring',
        title: '备用发条',
        text: '一只抽屉里躺着一圈上紧的备用发条，旁边压着一张字条：「只够上一个人的。」你的棋子们都在看着你，谁也不动。',
        choices: [
          { label: '上给最弱的兵', effect: { promote: true }, result: '兵被上紧了，它在原地站直，然后变成了别的东西。' },
          { label: '上给自己', effect: { relic: true }, result: '你把发条缠进袖口，从此你的手不会再抖。你获得了一件遗物。' },
        ],
      },
    ],
  },

  // ============================================================ 第四章
  {
    id: 'ch4',
    title: '第四章 · 王的葬列',
    subtitle: "THE KING'S FUNERAL",
    board: 8,
    start: [0, 0],
    throne: [7, 7],
    candles: 26,
    party: ['pawn', 'knight', 'bishop', 'rook'],
    bossName: '无面之王',
    boss: ['king', 'queen', 'queen', 'rook'],
    bossSigils: { king: ['armored', 'regen'], queen: ['double_strike', 'sharp_quills'], rook: ['armored'] },
    tiers: [
      ['pawn', 'knight', 'bishop'],
      ['pawn', 'knight', 'bishop', 'pawn'],
      ['knight', 'bishop', 'rook', 'pawn', 'pawn'],
      ['knight', 'rook', 'queen', 'pawn', 'pawn'],
    ],
    elitePool: [
      ['queen', 'knight', 'pawn', 'pawn'],
      ['rook', 'bishop', 'knight', 'pawn'],
      ['queen', 'rook', 'pawn'],
      ['bishop', 'bishop', 'knight', 'pawn', 'pawn'],
    ],
    tiles: { battle: 12, elite: 4, promote: 2, rest: 2, event: 4 },
    modifiers: {
      enemyAdvance: 1,
      scaleBonus: 1,
      restHeal: 2,
      battleCandleCost: 0,
    },
    theme: { name: '王的葬列', accent: '#9a5f6b', bg: '#12100f' },
    intro: [
      '最后一间屋子很长，长得像一条送葬的队列。棋盘两边站着你的棋子，它们不再看棋局，只看你。',
      '执局者走在队列最前面，第一次背对着你：「这一章你不用猜了。队伍是为你准备的。」',
      '他停下来说：「走到 h8，把我放上去。」然后他摘下自己的冠——冠下面没有脸。',
    ],
    throneIntro: '无面之王在王座上等你，它的冠是空的。它说：「谁戴上它，谁就是下一任执局者。你走这么远，不是为了赢，是为了接班。」',
    winText: '无面之王倒下，空冠滚到你脚边。你把它捡起来，没有戴上——你把它放进了棋匣，然后吹熄了蜡烛。黑暗里，第一次没有人说话。',
    loseText: '葬列继续前行，只是抬棺的人换成了你的棋子，棺里躺着你。执局者替你合上盖：「下一局见。」',
    outOfCandles: '蜡烛烧尽。你站在队列中间，成为被送走的那一个。',
    events: [
      {
        id: 'ch4_empty_crown',
        title: '空冠',
        text: '队列中央有人捧着一只冠，里面是空的。捧冠的棋子没有头，却走得很稳。执局者说：「别急，它迟早是你的。」',
        choices: [
          { label: '试戴', effect: { buffRandom: [2, 2], candles: -3 }, result: '冠太重了，你差点没直起腰，但一名棋子替你分担了它。一名棋子 +2 攻 +2 血，蜡烛 -3。' },
          { label: '把冠放回托盘', effect: { candles: 3 }, result: '你拒绝了它，队伍走得更快了些。蜡烛 +3。' },
        ],
      },
      {
        id: 'ch4_mourners',
        title: '送葬者',
        text: '两旁的棋子低着头，手里各捏着一小截白蜡烛。它们不攻击你，只是跟着走。其中一个抬起头，问你：「你打算把我们带到哪里去？」',
        choices: [
          { label: '让它们跟上', effect: { duplicate: true }, result: '一名送葬者把蜡烛插进你的灯座，走进了队伍。队伍多了一名同名棋子。' },
          { label: '让它们各自散去', effect: { healAll: 2 }, result: '它们把蜡烛留给你，然后消失在队列后面。全队 +2 血。' },
        ],
      },
      {
        id: 'ch4_last_candle',
        title: '最后一支蜡',
        text: '棋匣底层躺着一支从未点燃的白蜡烛，蜡身上刻着你的名字——可你不记得自己告诉过任何人。点燃它，火会一直烧到这一章结束。',
        choices: [
          { label: '点燃它', effect: { candles: 5, sacrificeForAtk: 1 }, result: '火很旺，但烧的是别的东西。蜡烛 +5，一名棋子化作火光，全队攻击 +1。' },
          { label: '留着，留给下一局', effect: { relic: true }, result: '你把它收进匣子最深处。你获得了一件遗物。' },
        ],
      },
    ],
  },
];

export default CHAPTERS;
