/*
 * Boss 数据表。
 * 每个招式都是数据：档位、预瞄、判定、后摇、位移、可弹。
 * 逻辑层只解释这些字段，换 Boss 等于换这张表。
 *
 * 课程表：弹反信号（训练桩）→ 读招（哨兵）→ 位置（司炉）→ 主动权（执刃）。
 * 每个 Boss 只加一个新维度，招式语汇不重复。
 *
 * 条目按分类归组：选关页只读 meta.category，加分类改 CATEGORIES，
 * 加条目只加一条 Boss 数据。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CM = root.CM || {}).bosses = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 分类注册表。名称与说明只在这里写一次，选关页与测试都从这里读。
  const CATEGORIES = [
    { id: 'souls', name: '类魂 Boss 战斗设计', note: '读招 · 位置 · 主动权 · 机关', order: 0 }
  ];

  /*
   * 教学型守门 Boss 的结构：
   * 快档横扫教翻滚时机 → 慢档砸地教距离 → 中档突进教后摇惩罚，
   * 半血后加入二连扫，教「不要在第一段后立刻回身贪刀」。
   *
   * 方向在出招瞬间锁定：预告出现时扇形已经对着最终方向，
   * 前摇期间不再转动。玩家看到什么形状，命中就是什么形状。
   * 突进的判定形状是直道本身，身体只是沿直道移动。
   * 突进只在 200px 外抽：贴脸时身体会从玩家身上穿过去，那种命中最难读。
   *
   * 可弹的是带刃的挥砍（横扫、二连扫）；砸地是落地冲击、
   * 突进是体术，都不可弹。
   */
  const ASHEN_SENTINEL = {
    id: 'ashen-sentinel',
    name: '灰烬哨兵',
    role: '读招型',
    summary: '慢速大体量近战。三招分别教翻滚时机、距离与后摇惩罚，半血后加入二连扫。',
    r: 46,
    maxHp: 660,
    speed: 74,
    phase2Speed: 92,
    chaseTurn: 6,
    engage: 128,              // 追到这个距离就停手，不再贴脸
    phaseAt: 0.5,
    cooldownScale2: 0.85,
    intro: 45,
    phaseTicks: 36,
    spawn: { x: 710, y: 300 },
    opener: ['sweep', 'slam'],
    // 韧性：读招 Boss 的「积少成多」出口。每一刀都算数，条只涨不落，
    // 打满就失稳 120t，第一刀换一次 70 点处决。与执刃的架势分开：
    // 架势会回落、要靠重击与弹反压；韧性不回落，奖励的是把每个窗口都用上。
    posture: {
      label: '韧性',
      tone: [190, 214, 235],
      max: 80,
      light: 10,
      heavy: 22,
      parry: 26,
      decayDelay: 0,
      decay: 0,
      breakTicks: 120
    },
    meta: { order: 1, accent: '#e8b25c', category: 'souls' },
    moves: {
      sweep: {
        name: '横扫',
        tier: '快',
        pose: 'swing',
        weight: 3,
        rangeMin: 0,
        rangeMax: 170,
        recovery: 32,
        cooldown: 44,
        steps: [
          { windup: 24, active: 5, damage: 22, range: 156, angle: 104, lunge: 0, parryable: true }
        ]
      },
      slam: {
        name: '砸地',
        tier: '慢',
        pose: 'slam',
        weight: 2,
        rangeMin: 0,
        rangeMax: 164,
        recovery: 56,
        cooldown: 46,
        steps: [
          { windup: 56, active: 7, damage: 34, range: 148, angle: 216, lunge: 0 }
        ]
      },
      lunge: {
        name: '突进',
        tier: '中',
        pose: 'lunge',
        weight: 2.2,
        rangeMin: 200,
        rangeMax: 320,
        recovery: 54,
        cooldown: 44,
        steps: [
          {
            windup: 36, active: 14, damage: 26, lunge: 250,
            lane: { range: 320, angle: 36 }
          }
        ]
      },
      sweep2: {
        name: '二连扫',
        tier: '快',
        pose: 'swing',
        phaseOnly: 2,
        weight: 2.4,
        rangeMin: 0,
        rangeMax: 170,
        recovery: 34,
        cooldown: 42,
        steps: [
          { windup: 20, active: 5, damage: 22, range: 152, angle: 104, lunge: 0, parryable: true },
          { windup: 16, active: 5, damage: 20, range: 156, angle: 118, lunge: 0, parryable: true }
        ]
      }
    }
  };

  /*
   * 位置型 Boss。招式语汇与哨兵不重叠：
   * 火环考「站多近」，燃地考「站多久」，推撞考「站在哪会被推走」。
   * 环形判定中心在出招瞬间锁定；火池在出招瞬间快照，前摇里不动。
   * 二阶段同时改两件事：场地落三块不灭的炉渣，把圆形跑道切出绕路；
   * 新增「灰门」——三圈从外往里收的缺口环，缺口一圈换一个方位，
   * 玩家必须提前跑到缺口，站远、站中心、往外滚都不再是答案。
   *
   * 可弹的只有推撞（拨火棍横抡）；火环是推进的冲击波、燃地是地面，
   * 都不吃弹反。
   */
  const ASH_STOKER = {
    id: 'ash-stoker',
    name: '灰烬司炉',
    role: '位置型',
    summary: '慢速、不追人的场地型。火环划出危险圈，燃地占住地面，推撞把人送进去。',
    r: 44,
    maxHp: 600,
    speed: 62,
    phase2Speed: 76,
    chaseTurn: 5,
    engage: 150,
    phaseAt: 0.5,
    cooldownScale2: 0.85,
    intro: 45,
    phaseTicks: 30,
    spawn: { x: 720, y: 300 },
    opener: ['pools', 'ring'],
    // 二阶段把场地本身改掉：三块不灭炉渣，绕 Boss 的圆跑道被切成几段。
    // 只掉血不挡路，但每穿一次要付 4 点一跳的过路费。
    slag: {
      r: 82,
      tick: 15,
      damage: 4,
      points: [[250, 150], [710, 450], [480, 480]]
    },
    meta: { order: 2, accent: '#ff7a3c', category: 'souls' },
    moves: {
      ring: {
        name: '火环',
        tier: '慢',
        pose: 'ring',
        weight: 2.6,
        rangeMin: 0,
        rangeMax: 330,
        recovery: 28,
        cooldown: 30,
        steps: [
          {
            windup: 54, active: 44, damage: 26,
            // 判定是一圈往前推的火环，不是整段圆环同时烧。
            // 内圈 100 以里安全；外面的人可以朝 Boss 滚，从来火前一穿而过。
            // 前缘 3.2px/t：比玩家跑速慢，看得清一层一层推出去，也追不上人。
            ring: { inner: 100, outer: 240, angle: 360, speed: 3.2, thickness: 40 }
          }
        ]
      },
      pools: {
        name: '燃地',
        tier: '慢',
        pose: 'sow',
        weight: 2,
        rangeMin: 120,
        rangeMax: 520,
        recovery: 40,
        cooldown: 44,
        steps: [
          {
            windup: 44, active: 1, damage: 0,
            drop: { count: 3, spread: 64, r: 55, ttl: 150, tick: 15, damage: 5 }
          }
        ]
      },
      shove: {
        name: '推撞',
        tier: '快',
        pose: 'shove',
        weight: 2.4,
        rangeMin: 0,
        rangeMax: 190,
        recovery: 26,
        cooldown: 24,
        steps: [
          {
            // 轻击从按下到翻滚无敌要 24t，前摇 20t 时「刚出刀」必吃；30t 留 6t 余量。
            windup: 30, active: 6, damage: 14,
            range: 120, angle: 70, lunge: 110, knock: 60, parryable: true
          }
        ]
      },
      twinRing: {
        name: '双环',
        tier: '慢',
        pose: 'ring',
        phaseOnly: 2,
        weight: 2.2,
        rangeMin: 0,
        rangeMax: 330,
        recovery: 28,
        cooldown: 30,
        steps: [
          {
            windup: 54, active: 44, damage: 26,
            ring: { inner: 100, outer: 240, angle: 360, speed: 3.2, thickness: 40 }
          },
          {
            // 第二圈从场边往里收，一路收到圆心：贴脸不再是答案，
            // 要反过来朝外滚穿前缘，滚到已经扫过的那一侧。
            windup: 28, active: 43, damage: 22,
            ring: { inner: 0, outer: 240, angle: 360, speed: 5.6, thickness: 40, inward: true }
          }
        ]
      },
      gateRing: {
        // 灰门：三圈从外往里收到 Boss 脚下，每圈只留一道 66° 的缺口。
        // 起点 420 在场地外圈一带，3.2px/t 慢于玩家跑速，够看清也够跑；
        // 缺口每圈转 100°，玩家不能停在上一个门口，要沿圈跑到下一道门。
        // 判定是整条推进带，穿过缺口之外的地方都会吃一次 22。
        name: '灰门',
        tier: '慢',
        pose: 'ring',
        phaseOnly: 2,
        gate: true,
        weight: 1.9,
        rangeMin: 0,
        rangeMax: 620,
        recovery: 44,
        cooldown: 70,
        steps: [
          {
            windup: 32, active: 134, damage: 22,
            ring: { inner: 0, outer: 420, angle: 294, speed: 3.2, thickness: 46, inward: true, spin: 100 }
          },
          {
            windup: 22, active: 134, damage: 22,
            ring: { inner: 0, outer: 420, angle: 294, speed: 3.2, thickness: 46, inward: true, spin: 100 }
          },
          {
            windup: 22, active: 134, damage: 22,
            ring: { inner: 0, outer: 420, angle: 294, speed: 3.2, thickness: 46, inward: true, spin: 100 }
          }
        ]
      }
    }
  };

  /*
   * 主动权型 Boss。瘦长人形，节奏比前两个快一档，招式语汇仍然分开：
   * 刺击考弹反、回旋斩考背后、铁山靠考距离、架势考「别贪第三下」，
   * 擒拿考「贴脸是错的」。
   *
   * 血条与架势条双轨：打空血是终局，打满架势是最大的输出窗口。
   * 架势满与弹反成功都进同一种可处决窗口（120t，所有 Boss 统一）；窗口里任意攻击触发一次处决演出。
   * 重击 +24、弹反 +28，轻击只 +10。
   * 架势防御只挡正面 120°：轻击撞上去会被弹开并吃一记反刺，重击能把架势打散。
   * 擒拿无视翻滚无敌帧，唯一答案是提前离开 92px 或绕到背后。
   * 穿身刺是它的距离答案：路径在蓄力时锁死，冲过去之后留 46t 后摇。
   *
   * 二阶段换成连招：不再单招抽签，改成三动一条链，最后一动是终结技。
   * 每换一动按玩家此刻的站位重选，冲撞每链最多一次且带 300t 跨链冷却。
   * 二连冲是独立起手：只能从追击里直接出，不接在任何招式后面，打完后也不接续。
   */
  const ASHEN_EDGE = {
    id: 'ashen-edge',
    name: '灰烬执刃',
    role: '决斗型',
    summary: '瘦长人形。架势条决定主动权：重击与弹反推得快，架势满则跪地。',
    shape: 'humanoid',
    r: 30,
    maxHp: 520,
    speed: 88,
    phase2Speed: 104,
    chaseTurn: 9,
    engage: 110,
    phaseAt: 0.5,
    cooldownScale2: 0.85,
    intro: 40,
    phaseTicks: 40,
    spawn: { x: 720, y: 300 },
    opener: ['thrust', 'guard', 'spin'],
    // 可处决窗口统一走 CFG.player.parry.stagger，这里不再单独覆盖：
    // 破架同样使用这个长度，弹反与破架只靠 staggerKind 区分。
    posture: {
      label: '架势',
      tone: [255, 214, 140],
      max: 70,
      light: 10,
      heavy: 24,
      parry: 28,
      guardBreak: 30,
      decayDelay: 240,
      decay: 5,
      breakTicks: 120
    },
    meta: { order: 3, accent: '#b9a6ff', category: 'souls' },
    // 二阶段的强化 AI：三动一条链，最后一动固定终结。
    // minPhase 让一阶段继续走原来的单招池，二阶段才交给链规划器。
    chain: {
      minPhase: 2,
      maxActions: 3,
      linkGap: 12,
      turn: 1.75,
      chainCooldown: 60,
      dashCooldown: 300,
      finisherRecovery: 72,
      actions: {
        thrust: {
          pose: 'thrust', tier: '快', weight: 3,
          rangeMin: 0, rangeMax: 220, frontArc: 150,
          step: { windup: 24, active: 4, damage: 14, range: 190, lunge: 18,
                  parryable: true, capsule: { width: 32 } }
        },
        dash: {
          pose: 'lunge', tier: '慢', weight: 2.4, dash: true,
          rangeMin: 100, rangeMax: 480,
          step: { windup: 30, active: 9, damage: 18, lunge: 280, range: 330,
                  capsule: { width: 60, travel: true } }
        },
        spin: {
          pose: 'spin', tier: '中', weight: 2.2,
          rangeMin: 0, rangeMax: 140,
          // 回旋斩与终结都是宽幅横扫。不让它紧挨终结，避免读成「横扫派生横扫」。
          notBeforeFinisher: true,
          step: { windup: 26, active: 6, damage: 18, range: 118, angle: 360,
                  parryable: true }
        },
        shoulder: {
          pose: 'shove', tier: '快', weight: 2,
          rangeMin: 0, rangeMax: 130, frontArc: 100,
          step: { windup: 22, active: 5, damage: 12, range: 120, angle: 70,
                  lunge: 90, knock: 70 }
        },
        grab: {
          pose: 'grab', tier: '中', weight: 1.8,
          rangeMin: 0, rangeMax: 92, frontArc: 70,
          step: { windup: 22, active: 4, damage: 20, range: 92, angle: 50,
                  grab: true, knock: 120, hurtTicks: 20 }
        }
      },
      finisher: {
        pose: 'finish',
        step: { windup: 36, active: 8, damage: 30, range: 150, angle: 240,
                parryable: false }
      },
      // 二连冲：只作独立起手。两段都锁路径，第二段按玩家此刻位置重画；
      // 两段打完直接进后摇，不追加任何动作。
      doubleDash: {
        chance: 0.35,
        windup: 30,
        gap: 32,
        active: 9,
        damage: 18,
        lunge: 280,
        range: 330,
        width: 60,
        recovery: 52,
        cooldown: 60
      }
    },
    moves: {
      thrust: {
        name: '刺击',
        tier: '快',
        pose: 'thrust',
        weight: 3,
        rangeMin: 90,
        rangeMax: 230,
        recovery: 24,
        cooldown: 24,
        steps: [
          // 28t 前摇：正在出刀时也来得及取消成翻滚（按键到无敌约 24t）。
          // 胶囊宽 32：刀身扫过的走廊，比身体瘦一圈，宽度不随距离变。
          { windup: 28, active: 4, damage: 18, range: 200, lunge: 24, parryable: true,
            capsule: { width: 32 } }
        ]
      },
      spin: {
        name: '回旋斩',
        tier: '中',
        pose: 'spin',
        weight: 2.4,
        rangeMin: 0,
        rangeMax: 124,
        recovery: 32,
        cooldown: 34,
        steps: [
          // 360°：站背后也不安全，这是对哨兵「绕背」答案的改写。
          // 半径对齐刀身（约 100px），不再用一个比画面大一圈的隐形圆。
          { windup: 32, active: 6, damage: 24, range: 118, angle: 360, lunge: 0, parryable: true }
        ]
      },
      shoulder: {
        name: '铁山靠',
        tier: '快',
        pose: 'shove',
        weight: 2,
        rangeMin: 0,
        rangeMax: 130,
        recovery: 26,
        cooldown: 28,
        steps: [
          // 24t：与横扫同一档，滑步再远也留得下一次翻滚。
          { windup: 24, active: 5, damage: 14, range: 120, angle: 70, lunge: 90, knock: 70 }
        ]
      },
      dash: {
        name: '穿身刺',
        tier: '慢',
        pose: 'lunge',
        weight: 2.6,
        rangeMin: 0,
        rangeMax: 430,
        phaseMax: 1,
        recovery: 46,
        cooldown: 50,
        steps: [
          // 路径在蓄力第一帧锁死：看到直道就往侧面走，冲过去之后有 46t 后摇可打。
          // 胶囊宽 60＝身体直径，宽度恒定；冲过的整条带都算，不再近窄远宽。
          { windup: 38, active: 10, damage: 24, lunge: 280, range: 330,
            capsule: { width: 60, travel: true } }
        ]
      },
      guard: {
        name: '架势',
        tier: '中',
        pose: 'guard',
        weight: 1.6,
        rangeMin: 0,
        rangeMax: 170,
        recovery: 12,
        cooldown: 18,
        steps: [
          // 不是攻击：正面举架 30t，轻击撞上去吃反刺，重击才能打散。
          {
            windup: 8, active: 30, damage: 0,
            range: 90, angle: 120, lunge: 0,
            guard: { arc: 120, range: 90, counter: 'riposte', counter2: 'riposte' }
          }
        ]
      },
      grab: {
        name: '擒拿',
        tier: '中',
        pose: 'grab',
        weight: 1.8,
        rangeMin: 0,
        rangeMax: 92,
        recovery: 40,
        cooldown: 40,
        steps: [
          // grab 绕过翻滚无敌帧：滚进来照样被抓，拉开距离或绕背才是答案。
          {
            windup: 24, active: 4, damage: 26,
            range: 92, angle: 50, lunge: 0,
            grab: true, knock: 120, hurtTicks: 20
          }
        ]
      },
      riposte: {
        name: '反刺',
        tier: '快',
        pose: 'thrust',
        hidden: true,
        weight: 0,
        rangeMin: 0,
        rangeMax: 200,
        recovery: 22,
        cooldown: 30,
        // 举架被轻击弹开后接的反刺：给 16t，玩家有时间放下第二刀改翻滚。
        steps: [
          { windup: 16, active: 4, damage: 20, range: 200, lunge: 30, parryable: true,
            capsule: { width: 32 } }
        ]
      }
    }
  };
  /*
   * 终局型 Boss：一人一剑，三幕换三次打法。
   * 一幕决斗：控距、2–3 动、收招长，讲礼数。
   * 二幕压迫：烧掉王袍，全距离，固定 2 动按站位分支，链尾留给玩家。
   * 三幕燃尽：剑尖拖地，火从剑上落到地面，招式负责改写落脚点。
   *
   * 全程常驻霸体：轻击与重击都不打断动作，只有韧性条打满才跪 120t。
   * 韧性分幕上限 120／160／80，破韧与弹反都给 120t 可处决窗口（任意一击结算 70）。
   * 三幕破韧额外清空全部燃地。
   *
   * 三幕不是单招池：每一幕都有自己的连招规划器，链长与分支各自一套。
   * 二幕按玩家站位与状态改权重（背后、喝血、刚翻滚），三幕多读一条燃地分布。
   */
  const ASHEN_KING = {
    id: 'ashen-king',
    name: '灰烬之王',
    names: ['灰烬之王', '无名的战士', '燃尽的王'],
    role: '终局型',
    summary: '一人一剑，三幕换三次打法。常驻霸体，轻击压不住；破韧跪 120t，末幕把场地烧成火。',
    shape: 'king',
    r: 34,
    maxHp: 720,
    speed: 86,
    phase2Speed: 118,
    speeds: [86, 118, 104],
    chaseTurn: 7,
    turns: [7, 9, 6.5],
    engage: 120,
    engages: [120, 80, 90],
    phaseAt: 0.5,
    phaseAt2: 0.25,
    phaseTicks: 40,
    cooldownScale2: 0.9,
    cooldownScales: [1, 0.9, 0.88],
    intro: 40,
    spawn: { x: 720, y: 300 },
    opener: [],
    meta: { order: 5, accent: '#ff8a4c', category: 'souls' },

    // 转场两段：50% 烧王袍放一圈冲击，25% 把剑钉进地里、火从剑下铺开。
    // 冲击在固定 tick 结算一次，环的内外径直接对应「站哪安全」。
    transitions: {
      2: {
        ticks: 40,
        name: '无名的战士',
        ring: { at: 32, inner: 0, outer: 180, damage: 20 }
      },
      3: {
        ticks: 30,
        name: '燃尽的王',
        ring: { at: 20, inner: 90, outer: 300, damage: 18 },
        clearEmbers: true
      }
    },

    posture: {
      label: '韧性',
      tone: [190, 214, 235],
      max: 120,
      // 手感对齐执刃：轻 10 / 重 24 / 弹 28，停手 4s 后才按 5/s 回落，
      // 打满的路径是持续压刀和弹反，轻击流也能磨上来。
      // 分幕上限保留（120 / 160 / 80），转场只截断到新上限，已积累的部分保留。
      phaseCaps: [120, 160, 80],
      light: 10,
      heavy: 24,
      parry: 28,
      decayDelay: 240,
      decay: 5,
      breakTicks: 120
    },

    // 三幕的燃地：全场最多 8 块，超过上限最早一块熄灭；每块 420t（7 秒）后自己烧尽。
    // 只滚不弹的玩家没有弹反取消，也没有破韧清场，永久火等于逼他在火里还手。
    embers: { r: 46, tick: 15, damage: 4, max: 8, ttl: 420 },

    // 每一幕一套连招配置。链长由 min/max 在起手时抽，
    // 每一动的组合按距离与状态抽；收尾只从 finishers 里取，且只放在链尾。
    // 一幕横斩/踏地，二幕跳劈/踏地，三幕焰踏。链身抽不到收尾招，
    // 玩家看到金色刻度环就知道「这是最后一动，打完该还手」。
    // 宽扇扫空要过刀（whiffGap）再续链：扫空的那一下就是玩家的回合，
    // 不必等整条链自然结束才有还手。滚一次能躲开的宽扇也不再满速追人。
    chains: {
      1: {
        // 一幕是决斗：两到三动，链尾固定收招。收招 48 + 冷却 28 = 76t，
        // 够从翻滚落点走回来打一刀，读完任何一条链都有一次确定的还手。
        // 空刀 36t 从判定结束算起，正好盖住一次翻滚的尾巴加一刀的 31t。
        minActions: 2, maxActions: 3, linkGap: 14, turn: 1.5,
        chainCooldown: 28, recovery: 48, whiffGap: 36,
        actions: {
          sweep: {
            // 160° / 150px：判定打到 164（150 + 身体 14），翻滚 165 从贴身处
            // 往任何方向滚都出得去。原来 180 时贴脸侧滚只到 183，差一点被刮到，
            // 玩家会觉得「一次翻滚出不去，必须滚两次」。扇形靠站定与不滚收钱，
            // 不靠逼出二连滚。
            pose: 'swing', tier: '中', weight: 3,
            rangeMin: 0, rangeMax: 165,
            step: { windup: 32, active: 6, damage: 26, range: 150, angle: 160, parryable: true }
          },
          turnSweep: {
            // 回身横斩：起手时满转，链中换动只按 turn 上限转（86°），
            // 所以滚到背后能真正扫空。前摇 26t 留出侧移的余地，
            // 扇形 180°，侧后仍有安全楔；判定半径与横斩同档（150 + 身体）。
            pose: 'spin', tier: '快', weight: 1.8, snap: true, behindBonus: 2.6,
            rangeMin: 0, rangeMax: 165,
            step: { windup: 26, active: 5, damage: 20, range: 150, angle: 180, parryable: true }
          },
          thrust: {
            pose: 'thrust', tier: '快', weight: 2.6,
            rangeMin: 100, rangeMax: 320,
            step: { windup: 28, active: 5, damage: 22, range: 300,
                    capsule: { width: 34 }, parryable: true }
          },
          lunge: {
            pose: 'lunge', tier: '慢', weight: 2, dash: true,
            rangeMin: 0, rangeMax: 360,
            step: { windup: 30, active: 6, damage: 24, lunge: 220, range: 340,
                    capsule: { width: 40, travel: true } }
          },
          stomp: {
            // 近身震地：0–120 的实心圈，退一步就出去；场地宽的环留给二、三幕。
            pose: 'ring', tier: '慢', weight: 2,
            rangeMin: 0, rangeMax: 150,
            step: { windup: 40, active: 18, damage: 20,
                    ring: { inner: 0, outer: 120, angle: 360, thickness: 40 } }
          },
          grab: {
            pose: 'grab', tier: '慢', weight: 1.6, frontArc: 100,
            rangeMin: 0, rangeMax: 100,
            step: { windup: 30, active: 4, damage: 30, range: 100, angle: 60,
                    grab: true, knock: 140, hurtTicks: 20 }
          }
        },
        finishers: ['sweep', 'stomp']
      },
      2: {
        // 二幕压强：链长固定 2，比一幕短、比一幕紧。链尾留一次还手：
        // 48 + 冷却 30×0.9 = 75t，和一幕同一档。读招时常常已经被推到 130px 外，
        // 走回来 35t 再出一刀 31t，刚好塞进这个窗口。
        // 所有招式的前摇不低于 24t（400ms）：人的反应加上起步要这么久，
        // 18t 以下的近身招等于「看见就已经吃到」。
        // 三动链表演 3.5–4 秒只还一刀，滚过去也只剩一刀的时间；
        // 压到两动，穿招贴身能塞两刀。
        // 链身与终结之间留 20t 空拍：躲链身那一下玩家还在翻滚后摇里，
        // 终结紧跟着起手时前摇有一大截藏在后摇里。空拍之后金色环的
        // 前摇完整落在自由时间内，读得到再滚。
        minActions: 2, maxActions: 2, linkGap: 8, finisherGap: 20, turn: 1.35,
        chainCooldown: 30, recovery: 48, whiffGap: 28,
        actions: {
          slash: {
            pose: 'swing', tier: '快', weight: 3,
            rangeMin: 0, rangeMax: 170,
            step: { windup: 24, active: 4, damage: 16, range: 160, angle: 120, parryable: true }
          },
          double: {
            // 二连斩：第一刀滚掉之后，30t 的翻滚后摇要到第一刀命中后 26t
            // 才走完。26t 起手里只有 4t 露在自由时间内，不够人反应
            // （300ms 加起步 3t），等于「知道有两刀也躲不开」。46t 留出 24t。
            pose: 'swing', tier: '中', weight: 2.4,
            rangeMin: 0, rangeMax: 170,
            steps: [
              { windup: 24, active: 4, damage: 14, range: 160, angle: 120, parryable: true },
              { windup: 46, active: 4, damage: 16, range: 160, angle: 120, parryable: true }
            ]
          },
          turnSlash: {
            pose: 'spin', tier: '快', weight: 1.8, snap: true, behindBonus: 3,
            rangeMin: 0, rangeMax: 140,
            step: { windup: 24, active: 4, damage: 16, range: 140, angle: 160, parryable: true }
          },
          leap: {
            // 跳劈：身体前压，落点再补一圈冲击。落点圈在前摇里画死。
            pose: 'slam', tier: '中', weight: 2.2, healBonus: 3,
            rangeMin: 0, rangeMax: 260,
            steps: [
              { windup: 26, active: 6, damage: 22, lunge: 150, range: 150, angle: 100, knock: 60 },
              // 落点圈前摇 46t：第一段跳劈的翻滚后摇要到命中后 26t 才走完，
              // 24t 时圈的前摇只有 4t 露在自由时间内，只滚不弹等于必吃第二下。
              { windup: 46, active: 6, damage: 10,
                ring: { inner: 0, outer: 120, angle: 360 } }
            ]
          },
          charge: {
            pose: 'lunge', tier: '快', weight: 2, healBonus: 3,
            rangeMin: 0, rangeMax: 280,
            step: { windup: 24, active: 5, damage: 18, range: 130, angle: 70,
                    lunge: 120, knock: 80 }
          },
          stomp: {
            // 近身踏地：0–120 的实心圈，一步就出去。二幕原来用 80–280 的
            // 宽环，贴身处唯一的安全答案反而是站着不动，与其余七招的
            // 「往外滚」相反；连段里换规则等于没有规则。近身统一成往外滚。
            pose: 'ring', tier: '快', weight: 2, dodgeBonus: 3,
            rangeMin: 0, rangeMax: 150,
            step: { windup: 28, active: 18, damage: 20,
                    ring: { inner: 0, outer: 120, angle: 360, thickness: 40 } }
          },
          flurry: {
            pose: 'shove', tier: '快', weight: 1.8,
            rangeMin: 0, rangeMax: 100,
            step: { windup: 24, active: 4, damage: 10, range: 100, angle: 70,
                    lunge: 40, knock: 70 }
          },
          wave: {
            // 剑气：只治一直退到屏幕边的人。可弹，弹中取消这一发。
            pose: 'thrust', tier: '中', weight: 2,
            rangeMin: 180, rangeMax: 600,
            step: { windup: 24, active: 4, damage: 16,
                    projectile: { speed: 560, r: 9, ttl: 90, parryable: true } }
          },
          grab: {
            // 擒拿两拍：抓住先砸，玩家不滚开就接一记踏地。
            // 第二段 followIfHit：空手没碰到人就不追这一下。
            pose: 'grab', tier: '快', weight: 1.8, frontArc: 100,
            rangeMin: 0, rangeMax: 100,
            steps: [
              { windup: 26, active: 4, damage: 30, range: 100, angle: 60,
                grab: true, knock: 100, hurtTicks: 20 },
              // 第二拍前摇 46t：被抓住后 20t 站不起来，恢复到 26t 才交还操作，
              // 24t 时整圈前摇有 20t 看不见，46t 才在恢复之后完整露出来。
              { windup: 46, active: 18, damage: 20, followIfHit: true,
                ring: { inner: 0, outer: 120, angle: 360, thickness: 40 } }
            ]
          }
        },
        finishers: ['leap', 'stomp']
      },
      3: {
        // 末幕照样烧地，但链尾留 46 + 冷却 30×0.88 = 72t：
        // 走回火线之外再砍一刀，也有时间挪一次脚。
        minActions: 1, maxActions: 3, linkGap: 4, turn: 1.2,
        chainCooldown: 30, recovery: 46, whiffGap: 26,
        actions: {
          fireSlash: {
            // 火斩：剑从地上划过，外沿留三块燃地。弹中整招取消，这三块也一起没有。
            pose: 'swing', tier: '中', weight: 3, emberBonus: 3,
            rangeMin: 0, rangeMax: 200,
            step: { windup: 24, active: 5, damage: 20, range: 190, angle: 150,
                    parryable: true,
                    embers: { count: 3, radius: 175, spread: 62 } }
          },
          fireTurn: {
            pose: 'spin', tier: '快', weight: 1.8, snap: true, behindBonus: 4,
            rangeMin: 0, rangeMax: 180,
            step: { windup: 24, active: 4, damage: 16, range: 180, angle: 200,
                    parryable: true,
                    embers: { count: 2, radius: 150, spread: 80 } }
          },
          flameStomp: {
            // 焰踏：内圈 70 安全，环缘落三块燃地。钻内圈的代价是出来时脚下已经有火。
            pose: 'ring', tier: '慢', weight: 2.2, emberBonus: 3, dodgeBonus: 3,
            rangeMin: 0, rangeMax: 260,
            step: { windup: 30, active: 26, damage: 24,
                    ring: { inner: 70, outer: 260, angle: 360, speed: 6, thickness: 46 },
                    embersRing: { count: 3, radius: 175, spread: 80 } }
          },
          fireCharge: {
            // 焚身冲：短冲切开一条干净地面，身后留一条燃地，越追越窄。
            pose: 'lunge', tier: '快', weight: 2.4, healBonus: 2.5,
            rangeMin: 0, rangeMax: 260,
            step: { windup: 24, active: 5, damage: 18, lunge: 200, range: 240,
                    capsule: { width: 60, travel: true },
                    emberTrail: 3 }
          },
          fireLine: {
            // 火线：地面先亮一条红线 20t，然后整条立起 1.2s。封退路用。
            pose: 'sow', tier: '中', weight: 2, healBonus: 2.5,
            rangeMin: 180, rangeMax: 600,
            step: { windup: 20, active: 1, damage: 0,
                    wall: { len: 400, width: 60, ttl: 72, tick: 30, damage: 16, offset: 90 } }
          },
          grab: {
            // 擒拿扔火：落点选最近的燃地。没火的时候只把人推开。
            pose: 'grab', tier: '快', weight: 1.8, frontArc: 100,
            rangeMin: 0, rangeMax: 120,
            step: { windup: 26, active: 4, damage: 30, range: 100, angle: 60,
                    grab: true, knock: 80, hurtTicks: 20,
                    throwEmber: true, throwDamage: 8 }
          },
          lastStand: {
            // 最后一搏：40 血以下才进池，600t 冷却。扑空力竭 90t，是这一幕最大的窗口。
            pose: 'grab', tier: '终', weight: 3, snap: true,
            minBossHp: 40, cdKey: 'lastStandCd', cdTicks: 600, endsChain: true,
            rangeMin: 0, rangeMax: 300,
            step: { windup: 40, active: 6, damage: 40, range: 300, angle: 50,
                    grab: true, knock: 80, hurtTicks: 30, lunge: 220,
                    missExhaust: 90, hitRecovery: 30 }
          }
        },
        finishers: ['flameStomp']
      }
    },

    // 连招之外不抽单招；这两个字段留给通用代码读，不参与出招。
    moves: {}
  };

  /*
   * 训练桩：站定不追人，只交替出「可弹横扫」与「不可弹砸地」，
   * 让两套信号并排出现，玩家对照着认。伤害压到 10，打错只疼一下。
   * 弹反成功 3 次由 sim 记在 world.training 上，练完自动停手。
   * 血量给得很大：这一关的通关条件是弹反次数，不是把桩打烂。
   */
  const TRAINING_DUMMY = {
    id: 'training-dummy',
    name: '训练桩',
    role: '教学',
    summary: '站桩交替出两种招：平滑青环的横扫能弹，锯齿暖环的砸地只能躲。弹反 3 次收工。',
    training: true,
    r: 46,
    maxHp: 9999,
    speed: 0,
    phase2Speed: 0,
    chaseTurn: 8,
    engage: 150,
    phaseAt: 0,
    intro: 60,
    phaseTicks: 30,
    spawn: { x: 600, y: 300 },
    opener: ['sweep'],
    meta: { order: 0, accent: '#8fe8ff', category: 'souls' },
    moves: {
      sweep: {
        name: '横扫',
        tier: '快',
        pose: 'swing',
        weight: 1,
        rangeMin: 0,
        rangeMax: 190,
        recovery: 44,
        cooldown: 90,
        steps: [
          { windup: 30, active: 5, damage: 10, range: 156, angle: 104, lunge: 0, parryable: true }
        ]
      },
      slam: {
        name: '砸地',
        tier: '慢',
        pose: 'slam',
        weight: 1,
        rangeMin: 0,
        rangeMax: 190,
        recovery: 50,
        cooldown: 90,
        steps: [
          { windup: 50, active: 7, damage: 10, range: 148, angle: 216, lunge: 0 }
        ]
      }
    }
  };

  /*
   * 机制型 Boss。大体型、慢，招式负责把人赶离熔钉，伤害来源不在本体身上。
   *
   * 本体铁甲：除断链与处决外，任何命中都是 0，只冒火星。
   * 场上四根熔钉用锁链连着它：打碎一根，锁链断，本体掉 30 血。
   * 掀甲只有弹反扫臂一条路：弹反同时把本体打进 120t 硬直，
   * 这 120t 是玩家贴上去砍本体的唯一窗口。熔钉 12s 重生（二阶段 9s），带 1.5s 裂纹预告。
   * 循环就是「躲招 → 打碎熔钉 → 等一次可弹的扫臂 → 跪地时贴上去砍 → 熔钉重生」。
   *
   * 空手砍本体只冒火星。这一关考的是路线与优先级：钉子负责推进，
   * 弹反负责把推进换成一次能动的窗口。
   *
   * 四招各管一段空间：扫臂管中距离、跺脚管脚下与远处、
   * 灰雨赶人离开熔钉、攫取惩罚站在原地不动。
   */
  const ASHEN_IDOL = {
    id: 'ashen-idol',
    name: '灰烬铸像',
    role: '机制型',
    summary: '大型铸像。本体铁甲免伤：打碎熔钉断链扣血，弹反掀甲才砍得动本体；熔钉会重生。',
    shape: 'idol',
    r: 76,
    maxHp: 240,
    speed: 66,
    phase2Speed: 84,
    chaseTurn: 4,
    phase2Turn: 5.2,
    engage: 150,
    phaseAt: 0.5,
    cooldownScale2: 0.85,
    intro: 50,
    phaseTicks: 40,
    spawn: { x: 720, y: 300 },
    opener: ['sweep', 'stomp'],
    props: {
      count: 4,
      r: 20,
      hp: 50,             // 轻击 19×3 或重击 40+19
      bossDamage: 30,     // 断链一次本体掉 30；240 血纯断链正好 8 次，弹反窗口是唯一的加速
      expose: 120,        // 弹反掀甲后的窗口；同一段里本体跪着，与所有 Boss 的可处决窗口同长
      respawn: 720,       // 12s 后长回
      respawn2: 540,      // 二阶段 9s
      tele: 90,           // 重生前 1.5s 裂纹预告
      ring: 250,          // 距场地中心 250px，四个斜角
      angles: [45, 135, 225, 315]
    },
    // 断链解封：锁链本来就是封印。每断一根，本体松一格，招式与移速跟着长。
    // 索引是「断掉的根数」0–4；锁链长回来会重新封住，所以这张表是双向的。
    unseal: {
      speed: [66, 70, 74, 78, 84],
      turn: [4, 4.4, 4.8, 5.2, 5.6],
      cooldown: [1, 0.97, 0.94, 0.91, 0.88]
    },
    // 双 Boss：铸像与它的锁匠同场。锁匠只随这一场出场，不在选关页单列。
    duo: { id: 'ash-locksmith', spawn: { x: 610, y: 300 } },
    meta: { order: 4, accent: '#c9b27c', category: 'souls' },
    moves: {
      sweep: {
        name: '扫臂',
        tier: '慢',
        pose: 'swing',
        weight: 3,
        rangeMin: 0,
        rangeMax: 260,
        recovery: 42,
        cooldown: 48,
        steps: [
          // 210°、210px：熔钉在 250 之外，扫臂够不到，但去熔钉的路上会经过。
          { windup: 38, active: 8, damage: 24, range: 210, angle: 210, parryable: true }
        ]
      },
      stomp: {
        name: '跺脚',
        tier: '慢',
        pose: 'ring',
        weight: 2.6,
        rangeMin: 0,
        rangeMax: 320,
        recovery: 48,
        cooldown: 54,
        steps: [
          {
            // 内圈 120 以里安全＝贴着身体站（本体半径 76 + 玩家 14 正好 90）。
            // 波以 6px/t 推到 320；站在熔钉旁会被扫过，必须贴到脚下或提前撤出。
            // 断掉三根后外沿推到 400，退得再远也会被扫到，安全区收缩到脚下。
            windup: 46, active: 44, damage: 26,
            ring: { inner: 120, outer: 320, outerUnsealed: 400, angle: 360, speed: 6, thickness: 48 }
          }
        ]
      },
      chain: {
        name: '甩链',
        tier: '中',
        pose: 'swing',
        weight: 2.4,
        rangeMin: 0,
        rangeMax: 620,
        recovery: 34,
        cooldown: 38,
        unsealAt: 1,
        chainLash: true,
        steps: [
          // 沿本体到「离玩家最近的存活熔钉」甩出去；范围在起手时按链长算。
          // 站在熔钉旁不动会被抽中，让开锁链线才是答案。
          { windup: 30, active: 6, damage: 20, range: 420, capsule: { width: 30 } }
        ]
      },
      crush: {
        name: '塌步',
        tier: '慢',
        pose: 'lunge',
        weight: 1.8,
        rangeMin: 140,
        rangeMax: 620,
        recovery: 46,
        cooldown: 60,
        unsealAt: 2,
        steps: [
          // 蹲身一步压上来：身体沿 60px 宽的胶囊前移 240px，判定跟着身体走。
          // 远端 340px，站着不动会被踩到；侧移出走廊才是答案。
          { windup: 40, active: 5, damage: 24, range: 340, capsule: { width: 60, travel: true }, lunge: 240 }
        ]
      },
      rain: {
        name: '灰雨',
        tier: '中',
        pose: 'sow',
        weight: 2.2,
        rangeMin: 0,
        rangeMax: 600,
        recovery: 40,
        cooldown: 52,
        steps: [
          // 落点在出招瞬间快照，三块并排盖住站位；站在熔钉旁要挪一步。
          {
            windup: 34, active: 6, damage: 22,
            drop: { count: 3, spread: 64, r: 44, ttl: 150, tick: 15, damage: 6 }
          }
        ]
      },
      seize: {
        name: '攫取',
        tier: '中',
        pose: 'grab',
        weight: 1.8,
        rangeMin: 0,
        rangeMax: 190,
        recovery: 44,
        cooldown: 56,
        steps: [
          // 穿翻滚无敌：站在熔钉前不动的人要付出代价，答案只有走开或提前滚。
          { windup: 34, active: 5, damage: 24, range: 170, angle: 55,
            grab: true, knock: 140, hurtTicks: 20 }
        ]
      }
    }
  };

  /*
   * 干预型随从。它不负责把玩家打死，负责让玩家手上的事做不成：
   * 护钉断拆钉、焊甲断输出窗口、断药断回复。三招都只把人从任务上赶开。
   *
   * 站位常驻玩家 90–150px，速度 110 低于玩家 232，不转身逃跑；
   * 牵引绳系在铸像身上，最多离本体 340px。被贴到 60px 以内才后撤一步 70px，
   * 四秒一次；这不是马拉松，只是重新拉开挥链的距离。
   *
   * 走路追不上人，所以远钉用「挂链」补位：玩家在活钉 130px 内、锁匠离钉超过
   * 150px 时，甩链把自己拽到护钉位。无伤害，只抢位置；前摇里画链与落点，
   * 被打中即取消。护钉期间暂停牵引绳，结束后走回 340，不瞬移。
   *
   * 单独打它没有意义，所以 helper: true，选关页与通关记录都不收它。
   */
  const ASH_LOCKSMITH = {
    id: 'ash-locksmith',
    name: '锁匠',
    role: '干预型',
    summary: '铸像的随从。不追命，专拆玩家手上的活：护钉、焊甲、断药。',
    shape: 'locksmith',
    helper: true,
    r: 22,
    maxHp: 160,
    speed: 110,
    phase2Speed: 132,
    chaseTurn: 10,
    engage: 96,
    phaseAt: 0,              // 没有血量二阶段；只有同伴倒下才会愤怒
    intro: 40,
    phaseTicks: 30,
    spawn: { x: 610, y: 300 },
    meta: { order: 5, accent: '#7fd4c8', category: 'souls' },
    // 牵引绳只防「拖成全图马拉松」：340 让锁匠追得上退到外圈喝药的玩家，
    // 又不会让它把人一路拽到场地角落。
    leash: 340,
    // 三种干预的时间账。approach 只用来走到位，channel 才是真正的引导。
    // 挂链是远钉补位：range 覆盖到场地另一侧，minDist 以内照常走过去。
    support: {
      nail: { approach: 80, channel: 120, after: 45, cooldown: 90, repair: 0.5,
              nearPlayer: 130, nearNail: 320, guardGap: 44 },
      dash: { range: 620, minDist: 150, windup: 16, settle: 14,
              cooldown: 210, nearPlayer: 130, guardGap: 44 },
      armor: { approach: 90, channel: 55, cooldown: 240, nearIdol: 300, minLeft: 20 },
      flask: { range: 260 }
    },
    moves: {
      whip: {
        name: '挥链',
        tier: '快',
        pose: 'swing',
        weight: 3,
        rangeMin: 0,
        rangeMax: 130,
        recovery: 26,
        cooldown: 28,
        steps: [
          // 短链横抽，射程比身体长一截。可以弹：链子是钝器，挡得住。
          { windup: 24, active: 5, damage: 12, range: 118, angle: 110,
            lunge: 0, knock: 40, parryable: true }
        ]
      },
      snare: {
        name: '缠足',
        tier: '快',
        pose: 'sow',
        weight: 2.2,
        rangeMin: 0,
        rangeMax: 150,
        recovery: 30,
        cooldown: 36,
        steps: [
          // 低伤害，命中把脚锁 0.6 秒。铸像正在出招时这一下才是真惩罚。
          { windup: 20, active: 4, damage: 6, range: 132, angle: 90, lunge: 0, root: 36 }
        ]
      },
      chainfire: {
        name: '链火',
        tier: '慢',
        pose: 'slam',
        weight: 1.8,
        rangeMin: 60,
        rangeMax: 170,
        recovery: 34,
        cooldown: 44,
        steps: [
          // 近身拍地，落点固定在出招瞬间的站位，留一块 2 秒的燃烧地面。
          { windup: 30, active: 4, damage: 0,
            drop: { count: 1, spread: 0, r: 40, ttl: 120, tick: 15, damage: 4, kind: 'chainfire' } }
        ]
      },
      cut: {
        name: '断药',
        tier: '快',
        pose: 'lunge',
        hidden: true,
        weight: 0,
        rangeMin: 0,
        rangeMax: 260,
        recovery: 30,
        cooldown: 40,
        steps: [
          // 只在玩家进入饮血前摇时起手：扑上来打断，不参与常规抽签。
          { windup: 18, active: 5, damage: 10, range: 150, angle: 80, lunge: 190, knock: 30 }
        ]
      }
    }
  };

  const REGISTRY = [TRAINING_DUMMY, ASHEN_SENTINEL, ASH_STOKER, ASHEN_EDGE, ASHEN_IDOL, ASHEN_KING, ASH_LOCKSMITH];

  function get(id) {
    const found = REGISTRY.find((b) => b.id === id);
    if (!found) throw new Error(`未知 Boss：${id}`);
    return found;
  }

  function list() {
    return REGISTRY.slice();
  }

  function categories() {
    return CATEGORIES.slice();
  }

  return { get, list, categories, REGISTRY };
});
