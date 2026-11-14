/*
 * 俯视角类魂战斗模型 · 纯逻辑层
 * 不碰 DOM，Node 可直接 require 做无头断言。
 * 时间单位：tick（60Hz）。所有时长都用 tick，避免浮点漂移。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./bosses.js'));
  } else {
    (root.CM = root.CM || {}).sim = factory(root.CM.bosses);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (bosses) {
  'use strict';

  if (!bosses) throw new Error('sim.js 需要先加载 bosses.js');

  const TICK = 1 / 60;

  /*
   * 数值取向：魂 3 / 法环，而不是魂 1。
   * 差别不在单次伤害，在预算：翻滚便宜、回复延迟短、后摇短，
   * 防御权不再稀缺，难度交给敌方读牌与连段。
   */
  const CFG = {
    arena: { w: 960, h: 600 },
    player: {
      r: 14,
      speed: 232,
      maxHp: 100,
      maxStamina: 100,
      staminaRegen: 48,          // 每秒
      staminaDelay: 16,          // 动作结束后约 0.27s 开始回复
      exhaustTicks: 14,
      bufferTicks: 7,
      hurtTicks: 12,
      hurtInvulnTicks: 14,
      deathTicks: 72,
      spawn: { x: 250, y: 300 },
      light: {
        windup: 10, active: 6, recovery: 15,
        damage: 19, stamina: 16, angle: 100, range: 80,
        lunge: 10, dodgeCancel: 5, hitstop: 4
      },
      heavy: {
        windup: 25, active: 7, recovery: 29,
        damage: 40, stamina: 27, angle: 120, range: 94,
        lunge: 16, dodgeCancel: 10, hitstop: 6
      },
      dodge: {
        ticks: 30, iframeStart: 3, iframeEnd: 19,
        distance: 165, backstep: 96, stamina: 15
      },
      // 弹反与血瓶是通用机制：任何 Boss 战都按同一套规则。
      // 可处决窗口对所有 Boss 统一 120t（2s）：够从两三步外走近，
      // 也容得下一次下意识的后滚再折返。
      parry: {
        windup: 3, active: 8, recovery: 22,
        stamina: 18, angle: 120,
        stagger: 120
      },
      // 处决是独立动作：可处决窗口里任意一次攻击命中都会触发，
      // 固定伤害、带演出，演出结束后把玩家退回安全距离。
      execution: {
        damage: 70,
        ticks: 54,
        hitTick: 16,
        push: 190,
        retreatTicks: 8,
        recover: 36,
        invuln: 12
      },
      flask: {
        max: 2, heal: 40,
        windup: 6, pour: 18, moveScale: 0.5
      }
    }
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function normalize(x, y) {
    const l = Math.hypot(x, y);
    if (l < 1e-6) return { x: 0, y: 0, len: 0 };
    return { x: x / l, y: y / l, len: l };
  }

  // 环形判定：内径以内安全，外径以外安全；整圈时不做角度判定。
  // inner = 0 时退化成原来的扇形，所有命中都走这一条。
  function shapeHitsCircle(px, py, dx, dy, inner, outer, halfAngle, cx, cy, cr) {
    const vx = cx - px;
    const vy = cy - py;
    const dist = Math.hypot(vx, vy);
    if (dist > outer + cr) return false;
    if (dist < inner - cr) return false;
    if (halfAngle >= Math.PI - 1e-6) return true;
    if (dist <= cr) return true;
    const dot = (vx * dx + vy * dy) / dist;
    const ang = Math.acos(clamp(dot, -1, 1));
    const allow = Math.asin(clamp(cr / dist, 0, 1));
    return ang <= halfAngle + allow;
  }

  function sectorHitsCircle(px, py, dx, dy, radius, halfAngle, cx, cy, cr) {
    return shapeHitsCircle(px, py, dx, dy, 0, radius, halfAngle, cx, cy, cr);
  }

  // 胶囊判定：从起点沿方向拉出 len、半宽 halfWidth 的圆头走廊。
  // 宽度不随距离变化——身体或刀身扫过哪一条带就命中哪一条带，
  // 末端的圆头由「目标圆到线段端点」的距离决定，不需要单独补角。
  function capsuleHitsCircle(px, py, dx, dy, len, halfWidth, cx, cy, cr) {
    const rx = cx - px;
    const ry = cy - py;
    const along = clamp(rx * dx + ry * dy, 0, len);
    const qx = px + dx * along;
    const qy = py + dy * along;
    return Math.hypot(cx - qx, cy - qy) <= halfWidth + cr;
  }

  function createBossState(def) {
    return {
      def,
      x: def.spawn.x,
      y: def.spawn.y,
      r: def.r,
      hp: def.maxHp,
      maxHp: def.maxHp,
      dir: { x: -1, y: 0 },
      phase: 1,
      state: 'intro',          // intro | chase | attack | phase | stagger | executing | dead
      t: 0,
      cooldown: 0,
      ai: true,
      move: null,              // { id, def, step, phase, t, hit, drop }
      flash: 0,
      lastMove: null,
      openerIndex: 0,
      openerWait: 0,
      deadT: 0,
      hitsTaken: 0,
      history: [],
      posture: 0,              // 架势值：0 到 def.posture.max
      postureDelay: 0,
      staggerTicks: 120,       // 可处决窗口长度（所有 Boss 统一）
      staggerKind: null,       // 'parry' | 'break'
      executed: false,         // 一次窗口只兑换一次处决
      forceMove: null,         // 架势反击指定的下一招
      dashCooldown: 0,         // 连招里的冲撞冷却：跨链也生效，不能连续两条链都靠冲撞起手
      postureBreaks: 0,        // 本局破架次数，机器人复核用
      exposeTicks: 0,          // 脱甲剩余时间：机制型 Boss 的铁甲被掀开的窗口
      unseal: 0,               // 已断锁链数：0 封印，4 全解；熔钉长回会回落
      // 随从专用：support 是正在做的干预，supportCd 是两次干预之间的冷却，
      // weldTried 记「这个脱甲窗口已经焊过一次」，rage 是同伴倒下后的愤怒。
      support: null,
      supportCd: 0,
      dashCd: 0,               // 挂链冷却：两次远钉补位之间的最短间隔
      weldTried: false,
      rage: false,
      backstep: null,
      backstepCd: 0,
      lastStandCd: 0          // 终局型 Boss 的最后一搏冷却
    };
  }

  // 场地机关：熔钉用锁链连着本体，打碎才算有效伤害。
  // 位置由场地中心与数据里的角度算出来，换场地尺寸不用改坐标。
  function makeProps(def, arena) {
    const conf = def.props;
    if (!conf) return [];
    const cx = arena.w / 2;
    const cy = arena.h / 2;
    return conf.angles.slice(0, conf.count).map((deg, i) => {
      const a = deg * Math.PI / 180;
      return {
        id: i,
        x: cx + Math.cos(a) * conf.ring,
        y: cy + Math.sin(a) * conf.ring,
        r: conf.r,
        hp: conf.hp,
        maxHp: conf.hp,
        state: 'alive',      // alive | down | growing
        t: 0,
        flash: 0,
        weldTicks: 0         // 锁匠正在焊这根钉：大于 0 时打不掉
      };
    });
  }

  // 断链解封：数「断掉的根数」。锁链就是封印，断一根松一格；
  // 熔钉长回来会重新接上，所以这个数会回退，解封是双向的。
  function unsealLevel(w) {
    if (!w.props || !w.props.length) return 0;
    let alive = 0;
    for (const pr of w.props) if (pr.state === 'alive') alive++;
    return w.props.length - alive;
  }

  function unsealValue(w, key) {
    const table = w.boss.def.unseal;
    if (!table || !table[key]) return null;
    return table[key][Math.min(unsealLevel(w), table[key].length - 1)];
  }

  // 甩链要打在玩家正在拆的那根钉上：取离玩家最近的存活熔钉。
  function nearestPropGap(w) {
    let gap = Infinity;
    for (const pr of w.props) {
      if (pr.state !== 'alive') continue;
      gap = Math.min(gap, Math.hypot(pr.x - w.player.x, pr.y - w.player.y));
    }
    return gap;
  }

  function pickChainTarget(w) {
    let best = null;
    let bestGap = Infinity;
    for (const pr of w.props) {
      if (pr.state !== 'alive') continue;
      const gap = Math.hypot(pr.x - w.player.x, pr.y - w.player.y);
      if (gap < bestGap) { best = pr; bestGap = gap; }
    }
    return best;
  }

  // 分幕上限与衰减：没有分幕表的 Boss 退回单一值。
  // 弹性条会回落，破韧给的是普通输出窗；分幕表只服务终局型 Boss。
  function postureCap(b) {
    const def = b.def.posture;
    if (!def) return 0;
    return def.phaseCaps ? def.phaseCaps[b.phase - 1] : def.max;
  }

  function postureDecay(b) {
    const def = b.def.posture;
    if (!def) return 0;
    return def.phaseDecay ? def.phaseDecay[b.phase - 1] : def.decay;
  }

  // 连招配置：终局型每幕一套（chains），执刃只有二阶段一套（chain + minPhase）。
  function currentChain(b) {
    if (b.def.chains) return b.def.chains[b.phase] || null;
    const c = b.def.chain;
    if (!c) return null;
    return b.phase >= (c.minPhase || 1) ? c : null;
  }

  // 燃地：上限由数据给；超过上限时最早一块熄灭。寿命也由数据给。
  function emberAt(w, x, y) {
    for (const h of w.hazards) {
      if (!h.ember) continue;
      if (Math.hypot(x - h.x, y - h.y) <= h.r) return h;
    }
    return null;
  }

  function emberCount(w) {
    let n = 0;
    for (const h of w.hazards) if (h.ember) n++;
    return n;
  }

  function clearEmbers(w) {
    for (let i = w.hazards.length - 1; i >= 0; i--) {
      if (w.hazards[i].ember) w.hazards.splice(i, 1);
    }
  }

  // 燃地在数据给了 ttl 时按寿命熄灭：只滚不弹的玩家没有弹反取消与破韧清场，
  // 永久火会把末幕变成「想还手就得站在火里」。留一段寿命，脚下这块会自己灭，
  // 拉开等两秒就能拿回干净地面；上限之外的淘汰顺序不变，最早一块先熄。
  function spawnEmber(w, x, y) {
    const conf = w.boss.def.embers;
    if (!conf) return;
    const margin = conf.r * 0.4;
    const life = conf.ttl != null ? conf.ttl : 1e9;
    w.hazards.push({
      x: clamp(x, conf.r + margin, w.cfg.arena.w - conf.r - margin),
      y: clamp(y, conf.r + margin, w.cfg.arena.h - conf.r - margin),
      r: conf.r,
      ttl: life, maxTtl: life,
      age: 0, tick: conf.tick, damage: conf.damage,
      kind: 'ember', owner: 'king', permanent: life > 1e6, ember: true
    });
    while (emberCount(w) > conf.max) {
      const i = w.hazards.findIndex((h) => h.ember);
      if (i < 0) break;
      w.hazards.splice(i, 1);
    }
    w.events.push({ type: 'emberSpawn', count: emberCount(w) });
  }

  // 沿 Boss 当前朝向的弧外沿放一圈燃地。方向在出招时已锁死，
  // 玩家看到剑往哪边划，火就往哪边落。
  function spawnArcEmbers(w, b, conf) {
    const base = Math.atan2(b.dir.y, b.dir.x);
    for (let i = 0; i < conf.count; i++) {
      const off = (i - (conf.count - 1) / 2) * conf.spread * Math.PI / 180;
      spawnEmber(w, b.x + Math.cos(base + off) * conf.radius,
                    b.y + Math.sin(base + off) * conf.radius);
    }
  }

  // 身后留一条燃地：从起手点沿反方向铺，切断刚刚走过的那条路。
  function spawnTrailEmbers(w, b, mv, count) {
    const bx = mv.ox;
    const by = mv.oy;
    for (let i = 0; i < count; i++) {
      const back = 44 + i * 62;
      spawnEmber(w, bx - b.dir.x * back, by - b.dir.y * back);
    }
  }

  function clearWalls(w) {
    w.walls.length = 0;
  }

  // 火线：一条横在 Boss 身前的线段。前摇期间只画红线，立起来才算判定。
  // 线段方向垂直于 Boss 朝向，偏移由数据给，长度以 Boss 为中线左右各一半。
  function makeWall(w, b, conf) {
    const cx = b.x + b.dir.x * (conf.offset || 0);
    const cy = b.y + b.dir.y * (conf.offset || 0);
    const hx = -b.dir.y * conf.len / 2;
    const hy = b.dir.x * conf.len / 2;
    return {
      x1: cx - hx, y1: cy - hy,
      x2: cx + hx, y2: cy + hy,
      width: conf.width,
      ttl: conf.ttl,
      maxTtl: conf.ttl,
      tick: conf.tick,
      damage: conf.damage,
      age: 0
    };
  }

  // 点到线段的距离：火线判定的唯一几何。
  function segDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }

  // 剑气：沿出招瞬间的朝向直飞，不拐弯。可弹的那一发弹中即灭。
  function spawnProjectile(w, b, step) {
    const c = step.projectile;
    w.projectiles.push({
      x: b.x + b.dir.x * (b.r + 6),
      y: b.y + b.dir.y * (b.r + 6),
      vx: b.dir.x * c.speed,
      vy: b.dir.y * c.speed,
      r: c.r,
      ttl: c.ttl,
      damage: step.damage,
      parryable: !!c.parryable,
      owner: b === w.boss ? 'king' : 'helper'
    });
    w.events.push({ type: 'projectile', x: b.x, y: b.y });
  }

  // 擒拿扔火：落点取离本体最近的燃地；没有燃地就只把人推开。
  function throwToEmber(w, b, step) {
    const p = w.player;
    let best = null;
    let bestGap = Infinity;
    for (const h of w.hazards) {
      if (!h.ember) continue;
      const gap = Math.hypot(h.x - b.x, h.y - b.y);
      if (gap < bestGap) { best = h; bestGap = gap; }
    }
    if (!best) return;
    p.x = best.x;
    p.y = best.y;
    p.knock = null;
    clampPlayer(w);
    w.events.push({ type: 'thrown', x: p.x, y: p.y });
    if (step.throwDamage > 0) {
      // 落地这一下不被擒拿自带的无敌吃掉：否则「30 + 8」只到账 30。
      damagePlayer(w, step.throwDamage, best.x, best.y, null,
        { who: b === w.boss ? 'king' : 'helper', chip: true, ignoreInvuln: true });
    }
  }

  function createWorld(opts) {
    opts = opts || {};
    const cfg = JSON.parse(JSON.stringify(CFG));
    const def = JSON.parse(JSON.stringify(bosses.get(opts.boss || 'ashen-sentinel')));

    const p = cfg.player;
    const w = {
      cfg,
      tick: 0,
      rng: mulberry32(opts.seed == null ? 20261111 : opts.seed),
      arena: cfg.arena,
      player: {
        x: p.spawn.x,
        y: p.spawn.y,
        r: p.r,
        hp: p.maxHp,
        maxHp: p.maxHp,
        stamina: p.maxStamina,
        maxStamina: p.maxStamina,
        facing: { x: 1, y: 0 },
        state: 'idle',            // idle | move | attack | dodge | parry | heal | hurt | execute | retreat | dead
        action: null,             // { kind, phase, t, dir, hit }
        dodge: null,              // { t, dir, backstep }
        parry: null,              // { t, dir, success }
        execute: null,            // { t, hit }
        retreat: null,            // { t, ticks, dir, dist }
        healT: 0,
        flasks: p.flask.max,
        buffer: null,             // { kind, t }
        staminaDelay: 0,
        exhaust: 0,
        hurt: 0,
        invuln: 0,
        knock: null,
        snare: 0,                 // 缠足：大于 0 时不能走位，翻滚可以挣脱
        deadT: 0,
        attacksStarted: 0,
        dodgesStarted: 0,
        parriesStarted: 0,
        flasksUsed: 0
      },
      boss: createBossState(def),
      // 双 Boss：铸像带一个只随它出场的锁匠。duo:false 可以退回单挑，
      // 断言与旧机器人要靠这个开关对照。
      helper: null,
      actor: null,               // 令牌持有者：同一 tick 只有一方在出招或干预
      props: makeProps(def, cfg.arena),
      hazards: [],               // { x, y, r, ttl, maxTtl, age, tick, damage }
      walls: [],                 // 火线：线段判定，{ x1, y1, x2, y2, w, ttl, damage }
      projectiles: [],           // 剑气：{ x, y, vx, vy, r, damage, ttl, parryable }
      hitstop: 0,
      attempts: 0,
      deaths: 0,
      outcome: null,             // null | victory
      // 训练桩只记弹反：3 次算练完，不靠打空血量。
      training: def.training ? { parries: 0, need: 3, done: false } : null,
      events: []
    };

    const d = normalize(w.player.x - w.boss.x, w.player.y - w.boss.y);
    w.boss.dir = { x: d.x || -1, y: d.y };
    w.boss.ai = opts.ai !== false;

    if (def.duo && opts.duo !== false) {
      const hdef = JSON.parse(JSON.stringify(bosses.get(def.duo.id)));
      w.helper = createBossState(hdef);
      if (def.duo.spawn) {
        w.helper.x = def.duo.spawn.x;
        w.helper.y = def.duo.spawn.y;
      }
      const hd = normalize(w.player.x - w.helper.x, w.player.y - w.helper.y);
      w.helper.dir = { x: hd.x || -1, y: hd.y };
      w.helper.ai = opts.ai !== false;
    }
    return w;
  }

  function clampPlayer(w) {
    const p = w.player;
    p.x = clamp(p.x, p.r, w.cfg.arena.w - p.r);
    p.y = clamp(p.y, p.r, w.cfg.arena.h - p.r);
  }

  function clampBoss(w, b) {
    b = b || w.boss;
    b.x = clamp(b.x, b.r, w.cfg.arena.w - b.r);
    b.y = clamp(b.y, b.r, w.cfg.arena.h - b.r);
  }

  function isInvulnerable(w) {
    const p = w.player;
    const c = w.cfg.player.dodge;
    if (p.state === 'dodge' && p.dodge) {
      return p.dodge.t >= c.iframeStart && p.dodge.t < c.iframeEnd;
    }
    return p.invuln > 0;
  }

  function canAct(w, cost) {
    const p = w.player;
    return p.exhaust <= 0 && p.stamina >= cost;
  }

  function spend(w, cost) {
    const p = w.player;
    p.stamina = Math.max(0, p.stamina - cost);
    p.staminaDelay = w.cfg.player.staminaDelay;
    if (p.stamina <= 0) p.exhaust = w.cfg.player.exhaustTicks;
  }

  function tryStartAttack(w, kind) {
    const p = w.player;
    const c = w.cfg.player[kind];
    if (!canAct(w, c.stamina)) return false;
    spend(w, c.stamina);
    p.state = 'attack';
    p.action = {
      kind,
      phase: 'windup',
      t: 0,
      dir: { x: p.facing.x, y: p.facing.y },
      hit: false
    };
    p.buffer = null;
    p.attacksStarted++;
    w.events.push({ type: 'swingStart', kind });
    return true;
  }

  function tryStartDodge(w, input) {
    const p = w.player;
    const c = w.cfg.player.dodge;
    if (!canAct(w, c.stamina)) return false;

    let dir = normalize(input.moveX || 0, input.moveY || 0);
    let backstep = false;
    if (dir.len === 0) {
      dir = { x: -p.facing.x, y: -p.facing.y };
      backstep = true;
    }
    spend(w, c.stamina);
    p.state = 'dodge';
    p.action = null;
    p.dodge = {
      t: 0,
      dir: { x: dir.x, y: dir.y },
      backstep
    };
    // 缠足锁的是脚：翻滚是挣脱它的答案，代价是一份体力。
    p.snare = 0;
    p.buffer = null;
    p.dodgesStarted++;
    w.events.push({ type: 'dodgeStart', backstep });
    return true;
  }

  function tryStartParry(w) {
    const p = w.player;
    const c = w.cfg.player.parry;
    if (!canAct(w, c.stamina)) return false;
    spend(w, c.stamina);
    p.state = 'parry';
    p.action = null;
    p.parry = { t: 0, dir: { x: p.facing.x, y: p.facing.y }, success: false };
    p.buffer = null;
    p.parriesStarted++;
    w.events.push({ type: 'parryStart' });
    return true;
  }

  function tryStartFlask(w) {
    const p = w.player;
    const c = w.cfg.player.flask;
    if (p.flasks <= 0 || p.hp >= p.maxHp) return false;
    p.flasks--;
    p.flasksUsed++;
    p.state = 'heal';
    p.action = null;
    p.healT = 0;
    p.buffer = null;
    w.events.push({ type: 'flaskStart', left: p.flasks });
    return true;
  }

  function consumeBuffer(w, input) {
    const p = w.player;
    if (!p.buffer) return false;
    const kind = p.buffer.kind;
    p.buffer = null;
    if (kind === 'light' || kind === 'heavy') return tryStartAttack(w, kind);
    if (kind === 'dodge') return tryStartDodge(w, input);
    return false;
  }

  // 架势：只有带 posture 配置的 Boss 才有。
  // 满值统一进 stagger（可处决窗口），窗口长度由数据给，弹反也走同一种窗口。
  function addPosture(w, amount) {
    const b = w.boss;
    const def = b.def.posture;
    if (!def || amount <= 0) return false;
    if (b.state === 'dead' || b.state === 'stagger' || b.state === 'executing' || b.state === 'phase') return false;
    const cap = postureCap(b);
    b.posture = Math.min(cap, b.posture + amount);
    b.postureDelay = def.decayDelay;
    w.events.push({ type: 'posture', value: b.posture, max: cap });

    if (b.posture < cap) return false;
    b.posture = 0;
    b.postureDelay = 0;
    b.state = 'stagger';
    b.staggerKind = 'break';
    b.staggerTicks = def.breakTicks;
    // 破韧也吃处决：破韧窗口从此不再只是「站着砍」。
    b.executed = false;
    b.t = 0;
    b.move = null;
    b.cooldown = 0;
    b.flash = 12;
    b.postureBreaks++;
    // 三幕破韧灭火：这是这一幕唯一的场地重置手段。
    if (b.phase >= 3 && b.def.embers) {
      clearEmbers(w);
      w.events.push({ type: 'embersCleared' });
    }
    w.hitstop = Math.max(w.hitstop, 10);
    w.events.push({ type: 'postureBreak', x: b.x, y: b.y, label: def.label || '架势' });
    return true;
  }

  function updatePosture(w) {
    const b = w.boss;
    const def = b.def.posture;
    if (!def || b.state === 'dead' || b.state === 'stagger' || b.state === 'executing' || b.state === 'phase') return;
    if (b.posture <= 0) return;
    if (b.postureDelay > 0) {
      b.postureDelay--;
      return;
    }
    b.posture = Math.max(0, b.posture - postureDecay(b) * TICK);
  }

  // 举架中的 Boss 只在正面挡：绕到背后照样吃满。
  function activeGuard(w) {
    const b = w.boss;
    if (b.state !== 'attack' || !b.move || b.move.phase !== 'active') return null;
    return b.move.def.steps[b.move.step].guard || null;
  }

  function recoilPlayer(w, b, guard) {
    const p = w.player;
    p.stamina = Math.max(0, p.stamina - 20);
    p.staminaDelay = w.cfg.player.staminaDelay;
    p.state = 'hurt';
    p.hurt = 10;
    p.action = null;
    p.dodge = null;
    p.buffer = null;
    const dir = normalize(p.x - b.x, p.y - b.y);
    p.knock = { x: dir.x, y: dir.y, t: 4, step: 10 };
    b.move = null;
    b.state = 'chase';
    b.t = 0;
    b.cooldown = 10;
    b.forceMove = b.phase === 2 ? (guard.counter2 || guard.counter) : guard.counter;
  }

  // 阶段线：普通 Boss 只有一条（phaseAt），终局型多一条（phaseAt2）。
  function nextPhaseOf(b) {
    if (b.phase === 1) return 2;
    if (b.phase === 2 && b.def.phaseAt2 != null) return 3;
    return null;
  }

  function phaseThreshold(b) {
    const frac = b.phase === 1 ? b.def.phaseAt : b.def.phaseAt2;
    return b.maxHp * frac;
  }

  // 进入下一幕：截断韧性到新上限、清掉不该留的场地，再把名字交给事件。
  // 韧性只截断不重置，已经攒下的部分保留。
  function enterBossPhase(w, b, phase) {
    b.phase = phase;
    b.state = 'phase';
    b.t = 0;
    b.move = null;
    b.cooldown = 0;
    b.forceMove = null;
    b.staggerKind = null;
    b.executed = false;
    b.staggerTicks = w.cfg.player.parry.stagger;
    if (b.def.posture) b.posture = Math.min(b.posture, postureCap(b));
    if (b.def.slag && phase === 2) spawnSlag(w, b.def.slag);
    if (b.def.embers) {
      clearEmbers(w);
      clearWalls(w);
      w.projectiles.length = 0;
    }
    const tr = b.def.transitions && b.def.transitions[phase];
    w.events.push({
      type: 'bossPhase', phase,
      name: tr && tr.name,
      x: b.x, y: b.y
    });
  }

  function damageBoss(w, amount, kind) {
    const b = w.boss;
    if (b.state === 'dead' || w.outcome === 'victory') return false;

    // 机制型 Boss 的铁甲：断链与处决之外，命中只冒火星。
    // 脱甲窗口里铁甲失效，打本体才走正常伤害。
    if (b.def.props && kind !== 'prop' && kind !== 'execute' && b.exposeTicks <= 0) {
      b.flash = 4;
      w.hitstop = Math.max(w.hitstop, 3);
      w.events.push({ type: 'bossArmored', x: b.x, y: b.y - b.r - 10 });
      return false;
    }

    const guard = activeGuard(w);
    if (guard && kind !== 'execute' && kind !== 'prop') {
      const v = normalize(w.player.x - b.x, w.player.y - b.y);
      const dot = v.len > 1e-6 ? v.x * b.dir.x + v.y * b.dir.y : 1;
      if (dot >= Math.cos(guard.arc * Math.PI / 360)) {
        if (kind === 'heavy') {
          // 重击不打血，只砸架势。砸满它自己就跪，破不了它继续举着。
          const broke = addPosture(w, b.def.posture ? b.def.posture.guardBreak : 30);
          w.hitstop = Math.max(w.hitstop, 6);
          w.events.push({ type: 'guardHit', broken: broke, x: b.x, y: b.y - b.r - 10 });
          return true;
        }
        // 轻击被弹开：掉体力、短暂失控，它立刻回一刺。
        recoilPlayer(w, b, guard);
        w.events.push({ type: 'guardRecoil', x: w.player.x, y: w.player.y - 24 });
        return false;
      }
    }

    const dealt = Math.round(amount);
    b.hp = Math.max(0, b.hp - dealt);
    b.flash = 10;
    b.hitsTaken++;
    const stop = kind === 'execute' ? 10 : kind === 'heavy' ? 6 : 4;
    w.hitstop = Math.max(w.hitstop, stop);
    w.events.push({
      type: 'bossHit',
      kind,
      damage: dealt,
      x: b.x,
      y: b.y - b.r - 10
    });

    if (b.hp <= 0) {
      b.state = 'dead';
      b.move = null;
      b.deadT = 0;
      b.support = null;
      w.hitstop = Math.max(w.hitstop, 10);
      w.events.push({ type: 'bossDeath' });
      // 双 Boss：倒下的一方不再算胜利，活着的一方进愤怒阶段；
      // 两边都倒下才收场。铸像的地面危险随本体一起熄灭。
      clearHazards(w, 'idol');
      if (b.def.embers) clearEmbers(w);
      if (b.def.chains) { clearWalls(w); w.projectiles.length = 0; }
      if (w.helper && w.helper.state !== 'dead') {
        enrage(w, w.helper);
        w.events.push({ type: 'partnerDown', who: 'idol' });
      } else {
        w.outcome = 'victory';
        w.hazards.length = 0;
        w.events.push({ type: 'victory' });
      }
      return true;
    }

    // 处决伤害不触发转阶段：半血切换要等演出结束，否则动画会被打断。
    // 终局型有两条线（50% / 25%），其余 Boss 只有 phaseAt 一条。
    if (kind !== 'execute' && nextPhaseOf(b) != null && b.hp <= phaseThreshold(b)) {
      enterBossPhase(w, b, nextPhaseOf(b));
      return true;
    }

    // 架势只在还有 hp 时积累；处决不叠架势，转阶段这一下也不叠。
    const post = b.def.posture;
    if (post && kind !== 'execute') addPosture(w, kind === 'heavy' ? post.heavy : post.light);
    return true;
  }

  function clearHazards(w, owner) {
    for (let i = w.hazards.length - 1; i >= 0; i--) {
      if (w.hazards[i].owner === owner) w.hazards.splice(i, 1);
    }
  }

  // 同伴倒下：活着的一方进愤怒。一阶段直接翻二阶段，已经二阶段就再压一次冷却。
  // 两种顺序都要让玩家感觉到「先杀谁」有代价。
  function enrage(w, b) {
    if (!b || b.state === 'dead') return;
    b.rage = true;
    b.flash = 14;
    if (b.state === 'attack' || b.state === 'support') b.move = null;
    b.support = null;
    b.phase = 2;
    b.state = 'phase';
    b.t = 0;
    b.cooldown = 0;
    b.lastMove = null;
    w.events.push({
      type: 'bossPhase', phase: 2, rage: true,
      who: b === w.boss ? 'idol' : 'helper',
      x: b.x, y: b.y
    });
  }

  function damageHelper(w, amount, kind) {
    const h = w.helper;
    if (!h || h.state === 'dead' || w.outcome === 'victory') return false;
    const dealt = Math.round(amount);
    h.hp = Math.max(0, h.hp - dealt);
    h.flash = 10;
    h.hitsTaken++;
    const stop = kind === 'execute' ? 10 : kind === 'heavy' ? 6 : 4;
    w.hitstop = Math.max(w.hitstop, stop);
    w.events.push({
      type: 'bossHit', who: 'helper', kind, damage: dealt,
      x: h.x, y: h.y - h.r - 10
    });

    // 打断引导：这一下同时取消了钉子的保护与焊甲。
    if (h.support) {
      h.support = null;
      h.state = 'chase';
      h.t = 0;
      h.cooldown = 18;
      h.supportCd = Math.max(h.supportCd, 60);
      w.events.push({ type: 'supportBreak', x: h.x, y: h.y });
    }

    if (h.hp <= 0) {
      h.state = 'dead';
      h.move = null;
      h.deadT = 0;
      h.support = null;
      w.hitstop = Math.max(w.hitstop, 10);
      clearHazards(w, 'helper');
      w.events.push({ type: 'helperDeath', x: h.x, y: h.y });
      if (w.boss.state !== 'dead') {
        enrage(w, w.boss);
        w.events.push({ type: 'partnerDown', who: 'helper' });
      } else {
        w.outcome = 'victory';
        w.hazards.length = 0;
        w.events.push({ type: 'victory' });
      }
    }
    return true;
  }

  function damagePlayer(w, amount, sx, sy, knockPx, opts) {
    opts = opts || {};
    const p = w.player;
    if (p.state === 'dead') return false;

    // 擒拿穿翻滚无敌：翻滚仍然是答案，但要滚出圈，不能滚在原地。
    if (opts.grab) {
      if (p.invuln > 0) return false;
    } else if (!opts.ignoreInvuln && isInvulnerable(w)) {
      // 擒拿落地这类「本人已经被抓住」的追加伤害要越过后摇无敌，否则白扣。
      return false;
    }

    if (p.state === 'heal') {
      p.healT = 0;
      w.events.push({ type: 'flaskBreak' });
    }

    // 地面持续伤害是磨血，不是硬控：站进火里会被烫，但还能自己走出去。
    // 若这里也进 hurt 并击退，火池每 15t 一跳会把玩家锁在原地，
    // 一排灰雨就能把人钉死在与本体之间的夹缝里。硬控只留给招式。
    if (opts.chip) {
      p.hp = Math.max(0, p.hp - amount);
      p.invuln = Math.max(p.invuln, w.cfg.player.hurtInvulnTicks);
      // 只给一小段位移，不给失控：被烫着会往外挪一点，手还在自己手上。
      const dir = normalize(p.x - sx, p.y - sy);
      p.x += dir.x * 12;
      p.y += dir.y * 12;
      clampPlayer(w);
      w.events.push({ type: 'playerHit', x: p.x, y: p.y, damage: amount, who: opts.who || null, chip: true });
      if (p.hp <= 0) {
        p.state = 'dead';
        p.deadT = w.cfg.player.deathTicks;
        p.knock = null;
        w.deaths++;
        w.events.push({ type: 'death' });
      }
      return true;
    }

    // 招式命中才打散架式。放在 chip 之后：踩火不该收掉已经举起的弹反。
    if (p.state === 'parry') {
      p.parry = null;
      w.events.push({ type: 'parryFail' });
    }

    p.hp = Math.max(0, p.hp - amount);
    p.invuln = w.cfg.player.hurtInvulnTicks;
    p.state = 'hurt';
    p.hurt = opts.hurtTicks || w.cfg.player.hurtTicks;
    p.action = null;
    p.dodge = null;
    p.buffer = null;

    const dir = normalize(p.x - sx, p.y - sy);
    const px = knockPx == null ? 30 : knockPx;
    const kt = opts.knockTicks || 6;
    p.knock = { x: dir.x, y: dir.y, t: kt, step: px / kt };
    if (opts.root) {
      p.snare = Math.max(p.snare, opts.root);
      w.events.push({ type: 'snared', ticks: p.snare });
    }

    w.hitstop = Math.max(w.hitstop, 4);
    w.events.push({ type: 'playerHit', x: p.x, y: p.y, damage: amount, who: opts.who || null });

    if (p.hp <= 0) {
      p.state = 'dead';
      p.deadT = w.cfg.player.deathTicks;
      p.knock = null;
      w.deaths++;
      w.events.push({ type: 'death' });
    }
    return true;
  }

  // 单个战斗单位的复位：主 Boss 与随从共用，随从只是多带一份干预状态。
  function resetFighter(w, b, spawn) {
    const def = b.def;
    b.x = spawn ? spawn.x : def.spawn.x;
    b.y = spawn ? spawn.y : def.spawn.y;
    b.hp = def.maxHp;
    b.phase = 1;
    b.state = 'intro';
    b.t = 0;
    b.cooldown = 0;
    b.move = null;
    b.flash = 0;
    b.lastMove = null;
    b.openerIndex = 0;
    b.openerWait = 0;
    b.deadT = 0;
    b.hitsTaken = 0;
    b.history = [];
    b.posture = 0;
    b.postureDelay = 0;
    b.staggerTicks = w.cfg.player.parry.stagger;
    b.staggerKind = null;
    b.executed = false;
    b.forceMove = null;
    b.dashCooldown = 0;
    b.exposeTicks = 0;
    b.unseal = 0;
    b.support = null;
    b.supportCd = 0;
    b.dashCd = 0;
    b.weldTried = false;
    b.rage = false;
    b.backstep = null;
    b.backstepCd = 0;
    b.lastStandCd = 0;
    const d = normalize(w.player.x - b.x, w.player.y - b.y);
    b.dir = { x: d.x || -1, y: d.y };
  }

  function resetBoss(w) {
    const def = w.boss.def;
    resetFighter(w, w.boss);
    if (w.helper) resetFighter(w, w.helper, def.duo && def.duo.spawn);
    w.actor = null;
    w.hazards.length = 0;
    w.walls.length = 0;
    w.projectiles.length = 0;
    w.props = makeProps(def, w.cfg.arena);
    w.outcome = null;
  }

  function respawn(w) {
    const p = w.player;
    const c = w.cfg.player;

    p.x = c.spawn.x;
    p.y = c.spawn.y;
    p.hp = c.maxHp;
    p.stamina = c.maxStamina;
    p.state = 'idle';
    p.action = null;
    p.dodge = null;
    p.parry = null;
    p.execute = null;
    p.retreat = null;
    p.healT = 0;
    p.flasks = c.flask.max;
    p.buffer = null;
    p.staminaDelay = 0;
    p.exhaust = 0;
    p.hurt = 0;
    p.invuln = 0;
    p.knock = null;
    p.snare = 0;
    p.deadT = 0;
    p.facing = { x: 1, y: 0 };

    resetBoss(w);
    w.attempts++;
    w.events.push({ type: 'respawn' });
  }

  function resetRun(w) {
    respawn(w);
    w.attempts = 0;
    w.deaths = 0;
  }

  function updateStamina(w) {
    const p = w.player;
    const c = w.cfg.player;
    if (p.state === 'attack' || p.state === 'dodge' || p.state === 'parry' ||
        p.state === 'execute' || p.state === 'retreat') return;
    if (p.staminaDelay > 0) return;
    p.stamina = Math.min(c.maxStamina, p.stamina + c.staminaRegen * TICK);
  }

  // 熔钉：打碎它不是掉血，是断链。断链一次本体固定掉 30，本体照样披着铁甲。
  // 掀甲只有弹反一条路：弹反把本体打进 120t 硬直，脱甲窗口同时开着。
  // 重生分两段：先在地上留 12s 焦痕（down），再长 1.5s 裂纹（growing）。
  // growing 期间不可打，避免「提前站在落点连打」把机关压成没有节奏。
  function damageProp(w, pr, amount) {
    const conf = w.boss.def.props;
    if (!conf || pr.state !== 'alive') return false;
    // 锁匠正在焊这根钉：刀落上去只有火花，这一段拆不动。
    if (pr.weldTicks > 0) {
      pr.flash = 4;
      w.hitstop = Math.max(w.hitstop, 2);
      w.events.push({ type: 'propWeld', id: pr.id, x: pr.x, y: pr.y });
      return false;
    }
    const dealt = Math.round(amount);
    pr.hp = Math.max(0, pr.hp - dealt);
    pr.flash = 8;
    w.hitstop = Math.max(w.hitstop, amount >= 30 ? 5 : 3);
    w.events.push({ type: 'propHit', id: pr.id, damage: dealt, hp: pr.hp, x: pr.x, y: pr.y });
    if (pr.hp > 0) return true;

    pr.state = 'down';
    pr.t = 0;
    pr.weldTicks = 0;
    const b = w.boss;
    b.flash = 12;
    w.hitstop = Math.max(w.hitstop, 8);
    w.events.push({ type: 'propBreak', id: pr.id, x: pr.x, y: pr.y });
    damageBoss(w, conf.bossDamage, 'prop');
    return true;
  }

  function updateProps(w) {
    const conf = w.boss.def.props;
    if (!conf) return;
    for (const pr of w.props) {
      if (pr.flash > 0) pr.flash--;
      if (pr.weldTicks > 0) pr.weldTicks--;
      if (w.boss.state === 'dead') continue;
      if (pr.state === 'alive') continue;
      pr.t++;
      if (pr.state === 'down') {
        const wait = w.boss.phase === 2 ? conf.respawn2 : conf.respawn;
        if (pr.t >= wait) {
          pr.state = 'growing';
          pr.t = 0;
          w.events.push({ type: 'propGrowing', id: pr.id, x: pr.x, y: pr.y, tele: conf.tele });
        }
      } else if (pr.state === 'growing' && pr.t >= conf.tele) {
        pr.state = 'alive';
        pr.hp = pr.maxHp;
        pr.t = 0;
        pr.weldTicks = 0;
        w.events.push({ type: 'propAlive', id: pr.id, x: pr.x, y: pr.y });
      }
    }

    // 断链数变了一格：HUD 与文案靠这一条报「解封 n/4」。
    // 锁链长回来同样会减一格，所以事件是双向的。
    const freed = unsealLevel(w);
    if (freed !== w.boss.unseal) {
      w.boss.unseal = freed;
      w.events.push({
        type: 'bossUnseal',
        level: freed,
        total: w.props.length,
        x: w.boss.x,
        y: w.boss.y - w.boss.r - 18
      });
    }
  }

  function updateAttack(w, input, pressed) {
    const p = w.player;
    const a = p.action;
    const c = w.cfg.player[a.kind];

    if (pressed.light) p.buffer = { kind: 'light', t: w.cfg.player.bufferTicks };
    else if (pressed.heavy) p.buffer = { kind: 'heavy', t: w.cfg.player.bufferTicks };
    else if (pressed.dodge) p.buffer = { kind: 'dodge', t: w.cfg.player.bufferTicks };

    if (a.phase === 'windup') {
      a.t++;
      if (a.t >= c.windup) {
        a.phase = 'active';
        a.t = 0;
      }
      return;
    }

    if (a.phase === 'active') {
      const stepDist = c.lunge / c.active;
      p.x += a.dir.x * stepDist;
      p.y += a.dir.y * stepDist;
      clampPlayer(w);

      if (!a.hit) {
        // 一刀只命中一个目标：本体、随从与熔钉同时在弧里时打最近的那个。
        // 锁匠挡在玩家与熔钉之间时，这一刀就会落在它身上——这就是护钉。
        const half = c.angle * Math.PI / 360;
        let best = null;
        const consider = (kind, obj) => {
          if (!sectorHitsCircle(p.x, p.y, a.dir.x, a.dir.y, c.range, half,
                               obj.x, obj.y, obj.r)) return;
          const gap = Math.hypot(obj.x - p.x, obj.y - p.y) - obj.r;
          if (!best || gap < best.gap) best = { kind, obj, gap };
        };
        if (w.boss.state !== 'dead') consider('boss', w.boss);
        if (w.helper && w.helper.state !== 'dead') consider('helper', w.helper);
        for (const pr of w.props) {
          if (pr.state === 'alive') consider('prop', pr);
        }

        if (best) {
          a.hit = true;
          if (best.kind === 'prop') {
            damageProp(w, best.obj, c.damage);
          } else if (best.kind === 'helper') {
            damageHelper(w, c.damage, a.kind);
          } else if (w.boss.state === 'stagger' && !w.boss.executed) {
            // 可处决窗口里任意一次命中都进处决演出；窗口只兑换一次。
            startExecution(w);
          } else {
            damageBoss(w, c.damage, a.kind);
          }
        }
      }

      a.t++;
      if (a.t >= c.active) {
        a.phase = 'recovery';
        a.t = 0;
      }
      return;
    }

    a.t++;
    if (p.buffer && p.buffer.kind === 'dodge' && a.t >= c.dodgeCancel &&
        canAct(w, w.cfg.player.dodge.stamina)) {
      tryStartDodge(w, input);
      return;
    }
    if (a.t >= c.recovery) {
      p.state = 'idle';
      p.action = null;
      consumeBuffer(w, input);
    }
  }

  // 处决：可处决窗口里任意一次攻击命中都走这里。
  // 玩家锁进演出，Boss 保持跪地；伤害在命中帧一次性结算，演出结束双方分开。
  function startExecution(w) {
    const b = w.boss;
    const p = w.player;
    if (b.state !== 'stagger' || b.executed) return false;
    const c = w.cfg.player.execution;

    b.executed = true;
    b.state = 'executing';
    b.t = 0;
    b.move = null;
    b.flash = 0;

    const dir = normalize(b.x - p.x, b.y - p.y);
    if (dir.len > 1e-6) {
      p.facing = { x: dir.x, y: dir.y };
    }

    p.state = 'execute';
    p.action = null;
    p.dodge = null;
    p.parry = null;
    p.healT = 0;
    p.buffer = null;
    p.knock = null;
    p.retreat = null;
    p.invuln = Math.max(p.invuln, c.ticks + c.retreatTicks + c.invuln);
    p.execute = { t: 0, hit: false };

    w.hitstop = Math.max(w.hitstop, 6);
    w.events.push({ type: 'executionStart', x: b.x, y: b.y });
    return true;
  }

  function updateExecute(w) {
    const p = w.player;
    const e = p.execute;
    const c = w.cfg.player.execution;
    e.t++;
    if (!e.hit && e.t >= c.hitTick) {
      e.hit = true;
      damageBoss(w, c.damage, 'execute');
    }
    if (e.t >= c.ticks) finishExecution(w);
  }

  function finishExecution(w) {
    const p = w.player;
    const b = w.boss;
    const c = w.cfg.player.execution;

    p.execute = null;
    const d = normalize(p.x - b.x, p.y - b.y);
    let dir = d.len > 1e-6 ? d : { x: -p.facing.x, y: -p.facing.y };
    const gap = Math.max(0, c.push - d.len);
    p.retreat = { t: 0, ticks: c.retreatTicks, dir: { x: dir.x, y: dir.y }, dist: gap };
    p.state = gap > 1 ? 'retreat' : 'idle';
    if (gap <= 1) {
      p.invuln = Math.max(p.invuln, c.invuln);
      p.facing = { x: -dir.x, y: -dir.y };
    }

    if (b.state !== 'executing') return;
    b.state = 'chase';
    b.t = 0;
    b.cooldown = c.recover;
    b.staggerKind = null;
    b.executed = false;
    b.staggerTicks = w.cfg.player.parry.stagger;
    if (nextPhaseOf(b) != null && b.hp <= phaseThreshold(b)) {
      enterBossPhase(w, b, nextPhaseOf(b));
    }
  }

  function updateRetreat(w) {
    const p = w.player;
    const r = p.retreat;
    const c = w.cfg.player.execution;
    const ease = (x) => 1 - (1 - x) * (1 - x);
    const p0 = ease(r.t / r.ticks);
    const p1 = ease((r.t + 1) / r.ticks);
    p.x += r.dir.x * r.dist * (p1 - p0);
    p.y += r.dir.y * r.dist * (p1 - p0);
    clampPlayer(w);
    r.t++;
    if (r.t >= r.ticks) {
      p.retreat = null;
      p.state = 'idle';
      p.invuln = Math.max(p.invuln, c.invuln);
      p.facing = { x: -r.dir.x, y: -r.dir.y };
    }
  }

  function updateDodge(w, input, pressed) {
    const p = w.player;
    const d = p.dodge;
    const c = w.cfg.player.dodge;

    if (pressed.light) p.buffer = { kind: 'light', t: w.cfg.player.bufferTicks };
    else if (pressed.heavy) p.buffer = { kind: 'heavy', t: w.cfg.player.bufferTicks };
    else if (pressed.dodge) p.buffer = { kind: 'dodge', t: w.cfg.player.bufferTicks };

    const dist = d.backstep ? c.backstep : c.distance;
    const p0 = d.t / c.ticks;
    const p1 = (d.t + 1) / c.ticks;
    const ease = (x) => 1 - (1 - x) * (1 - x);
    const move = dist * (ease(p1) - ease(p0));

    p.x += d.dir.x * move;
    p.y += d.dir.y * move;
    clampPlayer(w);

    d.t++;
    if (d.t >= c.ticks) {
      p.state = 'idle';
      p.dodge = null;
      consumeBuffer(w, input);
    }
  }

  function updateParry(w) {
    const p = w.player;
    const c = w.cfg.player.parry;
    p.parry.t++;
    if (p.parry.t >= c.windup + c.active + c.recovery) {
      p.state = 'idle';
      p.parry = null;
    }
  }

  function updateHeal(w, input) {
    const p = w.player;
    const c = w.cfg.player.flask;
    const mv = normalize(input.moveX || 0, input.moveY || 0);
    if (mv.len > 0) {
      p.x += mv.x * w.cfg.player.speed * c.moveScale * TICK;
      p.y += mv.y * w.cfg.player.speed * c.moveScale * TICK;
      clampPlayer(w);
    }
    p.healT++;
    if (p.healT >= c.windup + c.pour) {
      p.hp = Math.min(p.maxHp, p.hp + c.heal);
      p.state = 'idle';
      p.healT = 0;
      w.events.push({ type: 'flask', heal: c.heal });
    }
  }

  function updateHurt(w) {
    const p = w.player;
    if (p.knock && p.knock.t > 0) {
      const stepDist = p.knock.step || 5;
      p.x += p.knock.x * stepDist;
      p.y += p.knock.y * stepDist;
      p.knock.t--;
      clampPlayer(w);
    }
    p.hurt--;
    if (p.hurt <= 0) {
      p.state = 'idle';
      p.knock = null;
    }
  }

  function updateDead(w) {
    const p = w.player;
    p.deadT--;
    if (p.deadT <= 0) respawn(w);
  }

  // ---------- 弹反 ----------

  // 只在某一段判定的第一帧检查；成功就取消整招，出手方进入硬直。
  function tryParryHit(w, b, step) {
    const p = w.player;
    const pp = p.parry;
    const c = w.cfg.player.parry;
    if (p.state !== 'parry' || !pp) return false;
    if (!step.parryable) return false;
    if (pp.t < c.windup || pp.t >= c.windup + c.active) return false;

    const v = normalize(b.x - p.x, b.y - p.y);
    if (v.len < 1e-6) return false;
    if (v.x * pp.dir.x + v.y * pp.dir.y < Math.cos(c.angle * Math.PI / 360)) return false;

    const reach = step.lane ? step.lane.range : (step.range || 0);
    if (v.len > reach + 20) return false;

    if (b.def.props) {
      // 铸像没有架势条：弹反不进处决，但会把铁甲掀开，并让本体跪满整个窗口。
      // 这是它唯一的掀甲入口——破钉只掉血，玩家得靠弹反换来能砍本体的 120t。
      b.exposeTicks = Math.max(b.exposeTicks, b.def.props.expose);
      b.weldTried = false;
      b.state = 'stagger';
      b.staggerKind = 'parry';
      b.staggerTicks = b.def.props.expose;
      b.executed = true;      // 机关型不进处决：窗口里每次命中都走普通伤害
      b.t = 0;
      b.move = null;
      b.support = null;
      b.cooldown = 0;
      b.flash = 8;
      w.hitstop = Math.max(w.hitstop, 8);
      w.events.push({ type: 'bossExposed', ticks: b.def.props.expose, via: 'parry' });
    } else if (b.def.helper) {
      // 随从没有架势，也没有处决：弹反只把它打停 40t。
      // 这 40t 就是打断护钉/焊甲的窗口，不用再叠一套架势条。
      b.state = 'stagger';
      b.staggerKind = 'parry';
      b.staggerTicks = 40;
      b.executed = true;
      b.t = 0;
      b.move = null;
      b.support = null;
      b.cooldown = 0;
      b.flash = 8;
      b.supportCd = Math.max(b.supportCd, 60);
      w.hitstop = Math.max(w.hitstop, 8);
    } else {
      // 弹反一律给完整的可处决窗口，Boss 有没有韧性条都一样。
      // 弹反本身也砸架势；恰好把条砸满时按弹反结算（120t、可处决），
      // 不让一次弹反换来更短的破韧窗口。
      if (b.def.posture) addPosture(w, b.def.posture.parry);
      b.state = 'stagger';
      b.staggerKind = 'parry';
      b.staggerTicks = w.cfg.player.parry.stagger;
      b.executed = false;
      b.t = 0;
      b.move = null;
      b.cooldown = 0;
      b.flash = 8;
      w.hitstop = Math.max(w.hitstop, 8);
    }
    // 弹反成功立刻收架式：硬直就是还手窗口，不能让收势吃掉它。
    p.state = 'idle';
    p.parry = null;
    p.buffer = null;
    w.events.push({ type: 'parry', x: b.x, y: b.y - b.r });

    if (w.training && !w.training.done) {
      w.training.parries++;
      if (w.training.parries >= w.training.need) {
        w.training.done = true;
        // 练完就收工：桩停手，玩家不用在结算浮层后面继续挨打。
        b.ai = false;
        b.cooldown = 9999;
        w.events.push({ type: 'trainingDone' });
      }
    }
    return true;
  }

  // ---------- Boss ----------

  function turnToward(b, tx, ty, rate) {
    const target = Math.atan2(ty - b.y, tx - b.x);
    const cur = Math.atan2(b.dir.y, b.dir.x);
    let d = target - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const a = cur + clamp(d, -rate * TICK, rate * TICK);
    b.dir.x = Math.cos(a);
    b.dir.y = Math.sin(a);
  }

  function inBand(d, m) {
    return d >= (m.rangeMin || 0) && d <= (m.rangeMax || Infinity);
  }

  // ---------- 连招（三号 Boss 二阶段的强化 AI） ----------
  //
  // 把招式拆成动作模块，一条链最多 maxActions 动，最后一动固定是终结技。
  // 每换一动按玩家此刻的站位重选：远处只剩冲撞，正面贴身才给擒拿，
  // 回旋不看朝向。选完把朝向锁过去，预告出现后不再转。
  // 弹反或破架取消整条链；终结技之后是固定长后摇，那一整段都是玩家的回合。
  //
  // 朝向不瞬间贴住玩家：每次换动最多转 chain.turn 弧度，链中换动不再瞬转。
  // 滚到背后就是安全位：宽扇按当下的朝向扫，转不满 180° 就扫空，
  // 玩家不必为同一招连滚两次。
  function chainAim(w, mv, maxTurn) {
    const b = w.boss;
    const p = w.player;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const len = Math.hypot(dx, dy) || 1;
    const target = Math.atan2(dy, dx);
    const cur = Math.atan2(b.dir.y, b.dir.x);
    let d = target - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (maxTurn != null) d = clamp(d, -maxTurn, maxTurn);
    const a = cur + d;
    b.dir.x = Math.cos(a);
    b.dir.y = Math.sin(a);
    // 下一动的胶囊从身体当下位置重新画，冲撞的起点不会留在上一动的落点。
    mv.ox = b.x;
    mv.oy = b.y;
    mv.traveled = 0;
    mv.front = 0;
  }

  // 按距离与正面夹角筛模块，再按权重抽。抽签走 world.rng，同一种子结果固定。
  // 终局型多两条读法：玩家在背后（behindBonus）、在喝血或刚翻滚（heal/dodgeBonus）、
  // 脚下有火（emberBonus）。权重只是在原本的招式池上加票，不改可达范围。
  function pickChainAction(w, used, opts) {
    const b = w.boss;
    const c = currentChain(b);
    if (!c) return null;
    const p = w.player;
    // 这一动之后就是终结：标了 notBeforeFinisher 的模块不进池。
    const beforeFinisher = !!(opts && opts.beforeFinisher);
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const front = (dx / d) * b.dir.x + (dy / d) * b.dir.y;
    const onEmber = !!emberAt(w, p.x, p.y);
    const pool = [];
    let total = 0;
    for (const id of Object.keys(c.actions)) {
      const a = c.actions[id];
      if (used.ids.includes(id)) continue;
      // 收尾招只留在链尾：链身抽不到，玩家看到金色刻度环就知道该还手了。
      if (c.finishers && c.finishers.includes(id)) continue;
      if (beforeFinisher && a.notBeforeFinisher) continue;
      if (a.dash && (used.dashes >= 1 || b.dashCooldown > 0)) continue;
      if (a.minBossHp != null && b.hp > a.minBossHp) continue;
      if (a.cdKey && b[a.cdKey] > 0) continue;
      if (d < (a.rangeMin || 0) || d > (a.rangeMax || Infinity)) continue;
      if (a.frontArc && front < Math.cos(a.frontArc * Math.PI / 360)) continue;
      let weight = a.weight == null ? 1 : a.weight;
      if (a.behindBonus && front < 0) weight *= a.behindBonus;
      if (a.healBonus && p.state === 'heal') weight *= a.healBonus;
      if (a.dodgeBonus && (p.state === 'dodge' || p.invuln > 0)) weight *= a.dodgeBonus;
      if (a.emberBonus && onEmber) weight *= a.emberBonus;
      pool.push({ id, weight });
      total += weight;
    }
    if (!pool.length) return null;

    let r = w.rng() * total;
    for (const o of pool) {
      r -= o.weight;
      if (r <= 0) return o.id;
    }
    return pool[pool.length - 1].id;
  }

  // 复制模块的 step，补上段间停顿与终结标记。原始数据不改。
  // 一个模块可以带多段（二幕的二连斩、擒拿接踏地），整段算「一动」。
  function chainStepDefs(a, linkGap, finisher) {
    const src = a.steps && a.steps.length ? a.steps : [a.step];
    return src.map((s, i) => {
      const step = JSON.parse(JSON.stringify(s));
      if (!finisher && linkGap && i === 0) step.windup = s.windup + linkGap;
      step.pose = a.pose;
      step.tier = finisher ? '终结' : (a.tier || '中');
      step.finisher = !!finisher;
      // 宽扇：一次性扫过 ≥140° 的扇形。扫空要结算过刀，这类招才有「空刀」可言。
      // 环、胶囊与旧直道是另一种躲法，不按宽扇处理。
      step.wide = !step.ring && !step.capsule && !step.lane && (step.angle || 0) >= 140;
      return step;
    });
  }

  // 终结技：执刃只有一个固定模块；终局型从 finishers 里按距离抽，
  // 抽不到够得着的就退回普通动作，不留一条打不中的终结。
  function pickFinisher(w, ch) {
    const b = w.boss;
    const c = currentChain(b);
    if (!c) return null;
    if (c.finisher) return { a: c.finisher, id: 'finisher' };
    const p = w.player;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    const reachable = (c.finishers || []).filter((id) => {
      const a = c.actions[id];
      return a && d >= (a.rangeMin || 0) && d <= (a.rangeMax || Infinity);
    });
    if (!reachable.length) return null;
    // 同招不连出：上一动刚刚用过的那一招，如果还有别的可抽就不重复。
    const last = ch.ids[ch.ids.length - 1];
    const noRepeat = reachable.filter((id) => id !== last);
    const arr = noRepeat.length ? noRepeat : reachable;
    const id = arr[Math.floor(w.rng() * arr.length)];
    return { a: c.actions[id], id };
  }

  // 带冷却的动作（最后一搏）在选中时登记一次，之后 600t 不再进池。
  function noteChainAction(b, a) {
    if (a && a.cdKey) b[a.cdKey] = a.cdTicks || 600;
  }

  function startBossChain(w) {
    const b = w.boss;
    const c = currentChain(b);
    if (!c) return false;
    if (!tokenFree(w, b)) return false;
    // 链长：执刃固定 maxActions，终局型在 min–max 之间抽，
    // 玩家不能靠数「第几下结束」，只能看姿态。
    const max = c.minActions != null
      ? c.minActions + Math.floor(w.rng() * (c.maxActions - c.minActions + 1))
      : c.maxActions;
    const used = { ids: [], dashes: 0 };
    const hasFinisher = !!(c.finisher || (c.finishers && c.finishers.length));
    // 单动链也以收尾招结束：金色刻度环永远是「最后一动」的信号。
    let firstId = null;
    let first = null;
    let openerFinisher = false;
    if (max === 1 && hasFinisher) {
      const pick = pickFinisher(w, { ids: [] });
      if (pick) {
        firstId = pick.id;
        first = pick.a;
        openerFinisher = true;
      }
    }
    if (!first) {
      firstId = pickChainAction(w, used, { beforeFinisher: max === 2 && hasFinisher });
      if (!firstId) return false;
      first = c.actions[firstId];
    }
    used.ids.push(firstId);
    if (first.dash) used.dashes++;
    noteChainAction(b, first);
    const firstSteps = chainStepDefs(first, 0, openerFinisher);
    for (const s of firstSteps) s.action = openerFinisher ? 'finisher' : firstId;
    const m = {
      name: '连招',
      tier: '中',
      pose: first.pose,
      recovery: c.recovery != null ? c.recovery : (c.finisherRecovery || 60),
      cooldown: c.chainCooldown != null ? c.chainCooldown : 60,
      steps: firstSteps
    };

    claimToken(w, b);
    b.state = 'attack';
    b.t = 0;
    b.move = {
      id: 'chain',
      def: m,
      step: 0,
      phase: 'windup',
      t: 0,
      hit: false,
      ox: b.x,
      oy: b.y,
      traveled: 0,
      front: 0,
      inner: 0,
      outer: 0,
      drop: null,
      wall: null,
      chain: {
        max: first.endsChain ? 1 : max,
        used: 1,
        ids: used.ids,
        dashes: used.dashes,
        ended: !!first.endsChain
      }
    };
    chainAim(w, b.move, first.snap ? null : c.turn);
    if (firstSteps[0].wall) b.move.wall = makeWall(w, b, firstSteps[0].wall);
    if (first.dash) b.dashCooldown = c.dashCooldown || 120;
    b.lastMove = 'chain';
    b.history.push('chain:' + (openerFinisher ? 'finisher' : firstId));
    w.events.push({ type: 'bossSwing', move: 'chain', name: m.name, tier: m.tier });
    w.events.push({ type: 'chainStart', action: openerFinisher ? 'finisher' : firstId, max, actions: 1 });
    return true;
  }

  // 二连冲：独立起手，只能从追击里直接出。
  // 它不接在任何招式后面（规划器不会产出它），打完后也不追加动作：
  // 两段走完直接进入后摇，下一招仍要重新从追击里开始。
  // 第二段换段时按玩家此刻位置重画整条走廊，躲开第一段原地站着会被穿到。
  function startDoubleDash(w) {
    const b = w.boss;
    const c = b.def.chain;
    const dd = c && c.doubleDash;
    if (!dd) return false;
    if (!tokenFree(w, b)) return false;
    if (b.phase < (c.minPhase || 1)) return false;
    if (b.dashCooldown > 0) return false;
    if (w.rng() >= dd.chance) return false;

    const base = {
      active: dd.active,
      damage: dd.damage,
      lunge: dd.lunge,
      range: dd.range,
      capsule: { width: dd.width, travel: true }
    };
    const first = Object.assign({}, base, { windup: dd.windup });
    const second = Object.assign({}, base, { windup: dd.gap, reaim: true });
    const m = {
      name: '二连冲',
      tier: '慢',
      pose: 'lunge',
      recovery: dd.recovery,
      cooldown: dd.cooldown,
      steps: [first, second]
    };

    claimToken(w, b);
    b.state = 'attack';
    b.t = 0;
    b.move = {
      id: 'double-dash',
      def: m,
      step: 0,
      phase: 'windup',
      t: 0,
      hit: false,
      ox: b.x,
      oy: b.y,
      traveled: 0,
      front: 0,
      inner: 0,
      outer: 0,
      drop: null
    };
    chainAim(w, b.move, null);
    b.dashCooldown = c.dashCooldown || 120;
    b.lastMove = 'double-dash';
    b.history.push('double-dash');
    w.events.push({ type: 'bossSwing', move: 'double-dash', name: m.name, tier: m.tier });
    w.events.push({ type: 'doubleDash', gap: dd.gap });
    return true;
  }


  // 当前这一动结束：还没到链长就补下一动，到数就补终结。
  // 终局型的链尾不一定有终结：抽不到够得着的终结就收招，不留一条打不中的招。
  function appendChainStep(w, mv) {
    const b = w.boss;
    const c = currentChain(b);
    const ch = mv.chain;
    if (!c || !ch || ch.ended || ch.used >= ch.max) return false;

    const hasFinisher = !!(c.finisher || (c.finishers && c.finishers.length));
    const last = ch.used === ch.max - 1;
    let finisher = last && hasFinisher;
    let a = null;
    let id = null;

    if (!finisher) {
      id = pickChainAction(w, ch, { beforeFinisher: ch.used === ch.max - 2 && hasFinisher });
      if (id) a = c.actions[id];
      else if (hasFinisher) finisher = true;
      else return false;
    }
    if (finisher) {
      const pick = pickFinisher(w, ch);
      if (!pick) return false;
      a = pick.a;
      id = pick.id;
    }

    // 瞬转只给链首那一动（起手由 startBossChain 直接锁朝向），
    // 链中换动一律按 c.turn 上限转。否则回身横扫贴住玩家的新站位，
    // 滚到背后也白滚，宽扇就成了躲不开的招。
    chainAim(w, mv, c.turn);
    const steps = chainStepDefs(a, c.linkGap || 0, finisher);
    // 链尾终结与链身之间留一段空拍。玩家躲链身那一下时还在翻滚后摇里
    // （30t 里只剩 6t 是自由时间），终结如果紧接着起手，前摇有一大半
    // 藏在后摇里，看见也来不及。空拍让终结的前摇完整露在自由时间之后。
    if (finisher && c.finisherGap) steps[0].windup += c.finisherGap;
    for (const s of steps) s.action = finisher ? 'finisher' : id;
    const at = mv.def.steps.length;
    for (const s of steps) mv.def.steps.push(s);

    // 起手第一段建过的火线引用清掉：新一段没有火线就不要再画上一段的预告。
    if (steps[0].wall) mv.wall = makeWall(w, b, steps[0].wall);
    else mv.wall = null;

    ch.used++;
    ch.ids.push(finisher ? 'finisher' : id);
    b.history.push('chain:' + (finisher ? 'finisher' : id));
    if (a.dash) {
      ch.dashes++;
      b.dashCooldown = c.dashCooldown || 120;
    }
    noteChainAction(b, a);
    if (a.endsChain) ch.ended = true;
    return at;
  }

  function pickBossMove(w) {
    const b = w.boss;
    const d = Math.hypot(w.player.x - b.x, w.player.y - b.y);

    // 架住轻击后的反刺不走抽签：冷却一过就出，玩家读得到。
    if (b.forceMove) {
      const forced = b.forceMove;
      b.forceMove = null;
      const fm = b.def.moves[forced];
      if (fm && inBand(d, fm)) return forced;
    }

    // 开场固定顺序：横扫 → 砸地。先教两个贴身答案，突进留给玩家自己拉开距离时出现。
    if (b.openerIndex < b.def.opener.length) {
      const id = b.def.opener[b.openerIndex];
      if (inBand(d, b.def.moves[id])) {
        b.openerIndex++;
        b.openerWait = 0;
        return id;
      }
      // 还在接近就先走过去；到了 engage 还打不到，等半秒就跳过，免得站着不出招。
      if (d > b.def.engage + 1) {
        b.openerWait = 0;
        return null;
      }
      if (++b.openerWait > 24) {
        b.openerIndex++;
        b.openerWait = 0;
      }
      return null;
    }

    const pool = [];
    let total = 0;
    const freed = unsealLevel(w);
    for (const id of Object.keys(b.def.moves)) {
      const m = b.def.moves[id];
      if (m.hidden) continue;
      if (m.phaseOnly && b.phase < m.phaseOnly) continue;
      if (m.phaseMax && b.phase > m.phaseMax) continue;
      // 解封招：断掉的锁链不够多就不进池子。
      if (m.unsealAt && freed < m.unsealAt) continue;
      // 甩链只惩罚「站在熔钉旁」的站位；玩家不在任何熔钉附近时不出这招。
      if (m.chainLash && nearestPropGap(w) > 150) continue;
      if (!inBand(d, m)) continue;
      // 同一招不连出。只剩这一招可选时返回空，让 Boss 先走近再说。
      if (id === b.lastMove) continue;
      const weight = m.weight == null ? 1 : m.weight;
      pool.push({ id, weight });
      total += weight;
    }
    if (!pool.length) return null;

    let r = w.rng() * total;
    for (const o of pool) {
      r -= o.weight;
      if (r <= 0) return o.id;
    }
    return pool[pool.length - 1].id;
  }

  // 落点在出招瞬间快照：前摇里标记不动，走位才是正解。
  function snapshotDrop(w, b, drop) {
    const d = normalize(w.player.x - b.x, w.player.y - b.y);
    const px = -d.y;
    const py = d.x;
    const points = [];
    for (let i = 0; i < drop.count; i++) {
      const off = (i - (drop.count - 1) / 2) * drop.spread;
      points.push({ x: w.player.x + px * off, y: w.player.y + py * off });
    }
    return points;
  }

  function cloneMove(m) {
    return Object.assign({}, m, {
      steps: m.steps.map((s) => JSON.parse(JSON.stringify(s)))
    });
  }

  function startBossMoveOn(w, b, id) {
    // 连招型 Boss（终局王）没有独立招式表，招式挂在当前幕的 chains 里。
    // 调试入口 ?move= 也要能定格这些招式，所以按「本站→当前幕」的顺序查。
    const act = b.def.chains && b.def.chains[b.phase];
    const source = b.def.moves[id] || (act && act.actions[id]);
    if (!source) throw new Error(`Boss ${b.def.id} 没有招式 ${id}`);
    if (!tokenFree(w, b)) return false;
    // 每次起手拿一份自己的段数据：解封外沿与甩链长度会按当下状态改写，
    // 不能动共享的招式表，否则下一局或另一条时间线会继承上一局的值。
    const m = source === b.def.moves[id]
      ? cloneMove(source)
      : {
        name: id,
        tier: source.tier,
        pose: source.pose,
        recovery: act.recovery != null ? act.recovery : 30,
        cooldown: 0,
        steps: chainStepDefs(source, 0, false)
      };
    const first = m.steps[0];

    if (first.ring && first.ring.outerUnsealed != null && b.def.unseal && unsealLevel(w) >= 3) {
      first.ring.outer = first.ring.outerUnsealed;
    }

    // 灰门：每圈缺口的位置在起手时一次排好，圈与圈之间转 spin 度。
    // 缺口是弧的背面，玩家要跑的方向永远是 aim + π；起点随机，避免背下固定舞步。
    if (m.gate) {
      let aim = w.rng() * Math.PI * 2;
      for (const s of m.steps) {
        if (!s.ring) continue;
        s.ring.aim = aim;
        aim += (s.ring.spin || 100) * Math.PI / 180;
      }
    }

    // 甩链：起手瞬间把方向锁到「离玩家最近的存活熔钉」，长度按链长算。
    // 方向定死之后前摇里不再跟人，让开锁链线才是答案。
    let chainTarget = null;
    if (m.chainLash) {
      const target = pickChainTarget(w);
      if (target) {
        const dx = target.x - b.x;
        const dy = target.y - b.y;
        const len = Math.hypot(dx, dy) || 1;
        b.dir = { x: dx / len, y: dy / len };
        first.range = len + 80;
        chainTarget = target.id;
      }
    }

    // 方向在这里锁定：用 Boss 当前朝向出招，不吸附玩家。
    // 预告出现时扇形已经定死，前摇期间不再转。
    claimToken(w, b);
    b.state = 'attack';
    b.t = 0;
    b.move = {
      id,
      def: m,
      step: 0,
      phase: 'windup',
      t: 0,
      hit: false,
      ox: b.x,
      oy: b.y,
      traveled: 0,
      front: 0,
      inner: 0,
      outer: 0,
      drop: null,
      chainTarget
    };
    if (first.drop) b.move.drop = snapshotDrop(w, b, first.drop);
    if (first.wall) b.move.wall = makeWall(w, b, first.wall);
    b.lastMove = id;
    b.history.push(id);
    w.events.push({ type: 'bossSwing', move: id, name: m.name, tier: m.tier, who: b === w.boss ? 'idol' : 'helper' });
    return true;
  }

  function startBossMove(w, id) {
    return startBossMoveOn(w, w.boss, id);
  }

  // 令牌：同一 tick 只允许一方出招或做干预。另一方只走位，
  // 这样玩家不会同时被两套判定夹在中间。先更新的一方先拿，铸像排在前面。
  function tokenFree(w, b) {
    return !w.actor || w.actor === b || w.actor.state === 'dead';
  }

  function claimToken(w, b) {
    w.actor = b;
  }

  function spawnHazards(w, drop, points, owner) {
    for (const pt of points) {
      w.hazards.push({
        x: pt.x, y: pt.y, r: drop.r,
        ttl: drop.ttl, maxTtl: drop.ttl,
        age: 0, tick: drop.tick, damage: drop.damage,
        kind: drop.kind || 'fire',
        owner: owner || 'idol'
      });
    }
    // 炉渣是场地本身，不参与轮换：先从旧火池开始淘汰。
    while (w.hazards.length > 9) {
      const i = w.hazards.findIndex((h) => !h.permanent);
      if (i < 0) break;
      w.hazards.splice(i, 1);
    }
    w.events.push({ type: 'hazardSpawn', kind: drop.kind || 'fire' });
  }

  // 二阶段把炉膛烧穿：三块不灭炉渣留在地面，绕 Boss 的圆跑道被切成几段。
  // 只烫人不挡路，穿一次付 4 点一跳的过路费，路线本身变成取舍。
  function spawnSlag(w, def) {
    for (const pt of def.points) {
      w.hazards.push({
        x: pt[0], y: pt[1], r: def.r,
        ttl: 1e9, maxTtl: 1e9,
        age: 0, tick: def.tick, damage: def.damage,
        kind: 'slag', owner: 'stove', permanent: true
      });
    }
    w.events.push({ type: 'slagSpawn', count: def.points.length });
  }

  // 进入下一段：静态多段与连招追加共用。
  // 重瞄只对数据里标了 reaim 的段生效；连招在追加时已经锁过朝向。
  function enterBossStep(w, mv, index) {
    const b = w.boss;
    const next = mv.def.steps[index];
    mv.step = index;
    mv.phase = 'windup';
    mv.t = 0;
    mv.hit = false;
    mv.dealt = false;
    mv.traveled = 0;
    mv.front = 0;
    mv.wall = next.wall ? makeWall(w, b, next.wall) : null;
    if (next.drop) mv.drop = snapshotDrop(w, b, next.drop);
    if (next.reaim) {
      mv.ox = b.x;
      mv.oy = b.y;
      const rx = w.player.x - b.x;
      const ry = w.player.y - b.y;
      const rl = Math.hypot(rx, ry) || 1;
      b.dir = { x: rx / rl, y: ry / rl };
      w.events.push({ type: 'bossReaim', move: mv.id, step: mv.step });
    }
  }

  // 一段判定真正开始时才落场地效果：弹反取消整招时，这一招的燃地与火线一起消失。
  function applyStepEffects(w, b, mv, step) {
    if (step.embers) spawnArcEmbers(w, b, step.embers);
    if (step.embersRing) {
      // 环缘落火：沿一圈均匀摆开，钻内圈安全，代价是出来时圈上已经有火。
      const conf = step.embersRing;
      const base = Math.atan2(b.dir.y, b.dir.x);
      for (let i = 0; i < conf.count; i++) {
        const a = base + (i / conf.count) * Math.PI * 2;
        spawnEmber(w, b.x + Math.cos(a) * conf.radius, b.y + Math.sin(a) * conf.radius);
      }
    }
    if (step.emberTrail) spawnTrailEmbers(w, b, mv, step.emberTrail);
    if (step.projectile) spawnProjectile(w, b, step);
    if (step.wall && mv.wall) {
      w.walls.push(mv.wall);
      w.events.push({ type: 'wallUp' });
      mv.wall = null;
    }
  }

  function updateBossAttack(w, b) {
    const mv = b.move;
    const step = mv.def.steps[mv.step];

    if (mv.phase === 'windup') {
      mv.t++;
      if (mv.t >= step.windup) {
        mv.phase = 'active';
        mv.t = 0;
        mv.hit = false;
        mv.dealt = false;
        if (step.drop && mv.drop) {
          spawnHazards(w, step.drop, mv.drop, b === w.boss ? 'idol' : 'helper');
        }
        w.events.push({ type: 'bossActive', move: mv.id, step: mv.step });
      }
      return;
    }

    if (mv.phase === 'active') {
      if (step.lunge > 0) {
        const per = step.lunge / step.active;
        b.x += b.dir.x * per;
        b.y += b.dir.y * per;
        mv.traveled += per;
        clampBoss(w, b);
      }

      // 弹反只在判定的第一帧成立；成功就地取消整招。
      if (mv.t === 0 && tryParryHit(w, b, step)) return;
      // 场地效果排在弹反之后：弹中的那一刀不会留下燃地。
      if (mv.t === 0) applyStepEffects(w, b, mv, step);

      // 突进的判定跟着身体走：伤害前端 = 已冲距离 + 身体半径 + 武器长度。
      // 站得近先吃伤害，站得远要等身体冲到才吃；判定范围就是画出来的那条直道。
      let fx = b.x;
      let fy = b.y;
      let reach = step.range;
      let arc = step.angle;
      if (step.capsule && step.capsule.travel) {
        // 沿路径推进的胶囊：起点锁在出招位置，前端跟着身体走。
        fx = mv.ox;
        fy = mv.oy;
        mv.front = Math.min(step.range, mv.traveled + b.r + 24);
        reach = mv.front;
      } else if (step.lane) {
        // 旧的扇形直道（一号 Boss 仍在使用）：少了一条返工，形状保持原样。
        fx = mv.ox;
        fy = mv.oy;
        mv.front = Math.min(step.lane.range, mv.traveled + b.r + 24);
        reach = mv.front;
        arc = step.lane.angle;
      }

      // 推进环的判定带每帧都在动，和「这一招已经打中过」无关：
      // 前者给渲染与机器人读位置，后者只决定还要不要结算伤害。
      let ringIn = step.ring ? step.ring.inner : 0;
      let ringOut = step.ring ? step.ring.outer : 0;
      if (step.ring && step.ring.speed) {
        const rg = step.ring;
        const travel = rg.speed * mv.t;
        if (rg.inward) {
          ringOut = Math.max(rg.inner, rg.outer - travel);
          ringIn = Math.max(rg.inner, ringOut - rg.thickness);
        } else {
          ringIn = Math.min(rg.outer, rg.inner + travel);
          ringOut = Math.min(rg.outer, ringIn + rg.thickness);
        }
        mv.inner = ringIn;
        mv.outer = ringOut;
        mv.front = rg.inward ? ringIn : ringOut;
      }

      if (!mv.hit && step.damage > 0) {
        // 推进环：判定只是前缘后面那一条带着火的环，整段同时烧是旧做法。
        // 已经推过去的、还没推到的都安全；站着不动会被推过一次。
        // 灰门的瞄准独立于 Boss 朝向：弧的背面就是缺口，玩家要跑到那边。
        const ringAim = step.ring && step.ring.aim != null
          ? { x: Math.cos(step.ring.aim), y: Math.sin(step.ring.aim) }
          : b.dir;
        const hit = step.ring
          ? shapeHitsCircle(
              mv.ox, mv.oy, ringAim.x, ringAim.y,
              ringIn, ringOut,
              step.ring.angle * Math.PI / 360,
              w.player.x, w.player.y, w.player.r
            )
          : step.capsule
            ? capsuleHitsCircle(
                fx, fy, b.dir.x, b.dir.y,
                reach, step.capsule.width / 2,
                w.player.x, w.player.y, w.player.r
              )
            : sectorHitsCircle(
                fx, fy, b.dir.x, b.dir.y,
                reach, arc * Math.PI / 360,
                w.player.x, w.player.y, w.player.r
              );
        if (hit) {
          mv.hit = true;
          const opts = { who: b === w.boss ? 'idol' : 'helper' };
          if (step.grab) {
            opts.grab = true;
            opts.hurtTicks = step.hurtTicks;
            opts.knockTicks = 10;
          }
          if (step.root) opts.root = step.root;
          const dealt = damagePlayer(w, step.damage, mv.ox, mv.oy, step.knock, opts);
          // dealt 才算真正挨上：几何上蹭到、被无敌帧穿过去都不算。
          // 宽扇的过刀按这个判，不然滚穿和站在刀外都拿不到窗口。
          if (dealt) mv.dealt = true;
          // 翻滚无敌盖住的擒拿算扑空：不接后续拍子，也不把人扔进火里。
          if (step.grab) mv.hit = dealt;
          // 扔进火里：落点直接换成最近的燃地，落地再吃 8。没火就只是被推开。
          if (dealt && step.throwEmber) throwToEmber(w, b, step);
        }
      }

      mv.t++;
      if (mv.t >= step.active) {
        // 擒拿扑空就别追后续拍子：第二段标着 followIfHit。
        if (step.grab) {
          if (!mv.hit) mv.followMiss = true;
        }
        let next = mv.step + 1;
        while (next < mv.def.steps.length &&
               mv.def.steps[next].followIfHit && mv.followMiss) next++;
        // 追加段落在数组末尾，入口是追加前的段数，不是「当前段 + 1」：
        // 擒拿扑空跳过的第二拍仍在数组里，按 +1 会重进被跳过的拍子。
        let resume = next < mv.def.steps.length ? next : null;
        if (resume == null && mv.chain) {
          const appended = appendChainStep(w, mv);
          if (appended !== false) resume = appended;
        }
        // 宽扇没打到人（刀被滚穿、或者人已经离开扇面）：先把刀抡完（whiffGap），
        // 再接下一动。判定结束就立刻换招等于空刀没有代价，玩家只能一直躲；
        // 过刀这段就是玩家的回合。
        const conf = currentChain(b);
        if (resume != null && step.wide && !mv.dealt && conf && conf.whiffGap) {
          mv.whiff = resume;
          mv.whiffTicks = conf.whiffGap;
          mv.phase = 'recovery';
          mv.t = 0;
          w.events.push({ type: 'bossWhiff', move: mv.id, step: mv.step });
          return;
        }
        if (resume != null) {
          // 连招在段末才决定下一动：位置是玩家此刻的位置，不是出招前预判的。
          enterBossStep(w, mv, resume);
        } else {
          // 收招长度按命中改写：扑空的力竭比命中的收势长得多。
          if (step.missExhaust != null && !mv.hit) mv.def.recovery = step.missExhaust;
          else if (step.hitRecovery != null && mv.hit) mv.def.recovery = step.hitRecovery;
          mv.phase = 'recovery';
          mv.t = 0;
        }
      }
      return;
    }

    mv.t++;
    // 空刀过刀：这段后摇结束后接着走链里已经抽好的下一动，不回追击。
    const rec = mv.whiff != null ? mv.whiffTicks : mv.def.recovery;
    if (mv.t >= rec) {
      if (mv.whiff != null) {
        const at = mv.whiff;
        mv.whiff = null;
        mv.whiffTicks = 0;
        enterBossStep(w, mv, at);
        return;
      }
      b.state = 'chase';
      b.move = null;
      b.t = 0;
      b.cooldown = Math.round(mv.def.cooldown * bossCooldownScale(w, b));
    }
  }

  // 分幕参数：终局型用数组（每幕一格），其余 Boss 只有单值与二阶段值。
  function phaseIndex(b) {
    return Math.max(0, Math.min(2, b.phase - 1));
  }

  function bossCooldownScale(w, b) {
    let scale;
    if (b.def.cooldownScales) scale = b.def.cooldownScales[phaseIndex(b)];
    else scale = b.phase === 2 ? (b.def.cooldownScale2 == null ? 0.85 : b.def.cooldownScale2) : 1;
    if (b.def.unseal) {
      const u = unsealValue(w, 'cooldown');
      if (u != null) scale = Math.min(scale, u);
    }
    if (b.rage) scale *= 0.85;
    return scale;
  }

  function bossSpeed(w, b) {
    let spd;
    if (b.def.speeds) spd = b.def.speeds[phaseIndex(b)];
    else spd = b.phase === 2 ? b.def.phase2Speed : b.def.speed;
    if (b.def.unseal) {
      const u = unsealValue(w, 'speed');
      if (u != null) spd = Math.max(spd, u);
    }
    if (b.rage) spd += 12;
    return spd;
  }

  function bossTurn(w, b) {
    let turn;
    if (b.def.turns) turn = b.def.turns[phaseIndex(b)];
    else {
      turn = b.def.chaseTurn;
      if (b.phase === 2) turn = Math.max(turn, b.def.phase2Turn || turn);
    }
    if (b.def.unseal) {
      const u = unsealValue(w, 'turn');
      if (u != null) turn = Math.max(turn, u);
    }
    if (b.rage) turn += 1.5;
    return turn;
  }

  function bossEngage(w, b) {
    if (b.def.engages) return b.def.engages[phaseIndex(b)];
    return b.def.engage == null ? b.r + w.player.r + 16 : b.def.engage;
  }

  function updateBossChase(w, b) {
    const p = w.player;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    const engage = bossEngage(w, b);

    // 冷却期站定不追。收招这一段就是玩家的出手窗口，
    // 也让「它现在打完了」变成看得见的信号。
    if (b.cooldown <= 0 && d > engage + 1) {
      const spd = bossSpeed(w, b);
      b.x += dx / d * spd * TICK;
      b.y += dy / d * spd * TICK;
      clampBoss(w, b);
    }
    turnToward(b, p.x, p.y, bossTurn(w, b));

    if (b.cooldown > 0) {
      b.cooldown--;
      return;
    }
    // 连招 Boss 不走单招抽签：起手与后续都交给链规划器。
    // 执刃只有二阶段进链；终局型每一幕都有一套链。
    if (currentChain(b)) {
      if (startDoubleDash(w)) return;
      if (startBossChain(w)) return;
      b.cooldown = 12;
      return;
    }
    if (!tokenFree(w, b)) return;
    const id = pickBossMove(w);
    if (id) startBossMoveOn(w, b, id);
  }

  // ---------- 随从：锁匠 ----------

  // 常规三招只按距离抽。hidden 的断药不进池子，只在玩家喝药时直接起手。
  function pickHelperMove(w, b) {
    const p = w.player;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    const pool = [];
    let total = 0;
    for (const id of Object.keys(b.def.moves)) {
      const m = b.def.moves[id];
      if (m.hidden) continue;
      if (!inBand(d, m)) continue;
      if (id === b.lastMove) continue;
      const weight = m.weight == null ? 1 : m.weight;
      pool.push({ id, weight });
      total += weight;
    }
    if (!pool.length) return null;
    let r = w.rng() * total;
    for (const o of pool) {
      r -= o.weight;
      if (r <= 0) return o.id;
    }
    return pool[pool.length - 1].id;
  }

  // 护钉的目标：玩家正在拆、而且锁匠够得着的那根活钉。
  // nearNail 可放宽：走路够不着时改用挂链，射程由 support.dash.range 决定。
  function pickGuardNail(w, b, nearNail) {
    const conf = b.def.support.nail;
    const maxHd = nearNail == null ? conf.nearNail : nearNail;
    const p = w.player;
    let best = null;
    let bestGap = Infinity;
    for (const pr of w.props) {
      if (pr.state !== 'alive' || pr.weldTicks > 0) continue;
      const pd = Math.hypot(pr.x - p.x, pr.y - p.y);
      if (pd > conf.nearPlayer) continue;
      const hd = Math.hypot(pr.x - b.x, pr.y - b.y);
      if (hd > maxHd) continue;
      if (pd < bestGap) { best = pr; bestGap = pd; }
    }
    return best;
  }

  // 牵引绳系在铸像身上：离本体超过 leash 就被拉回边界，防止锁匠把人拖成全图马拉松。
  // 挂链会让它短暂越界，所以回拉按移速走，不瞬移。
  function clampToLeash(w, b) {
    const idol = w.boss;
    if (!b.def.leash || idol.state === 'dead') return;
    const dx = b.x - idol.x;
    const dy = b.y - idol.y;
    const d = Math.hypot(dx, dy);
    if (d > b.def.leash) {
      const over = d - b.def.leash;
      const step = Math.min(over, bossSpeed(w, b) * TICK * 2);
      b.x -= dx / d * step;
      b.y -= dy / d * step;
      clampBoss(w, b);
    }
  }

  function startHelperSupport(w, b, kind, opt) {
    if (!tokenFree(w, b)) return false;
    const conf = b.def.support;
    claimToken(w, b);
    b.state = 'support';
    b.t = 0;
    b.move = null;
    b.backstep = null;

    if (kind === 'nail') {
      const pr = w.props.find((x) => x.id === opt.id);
      if (!pr || pr.state !== 'alive') {
        b.state = 'chase';
        w.actor = null;
        return false;
      }
      // 挡在玩家与熔钉之间：玩家要拆，先得越过锁匠。
      const dx = w.player.x - pr.x;
      const dy = w.player.y - pr.y;
      const l = Math.hypot(dx, dy) || 1;
      const dash = !!(opt && opt.dash);
      const gap = pr.r + (dash ? conf.dash.guardGap : conf.nail.guardGap);
      const gx = pr.x + dx / l * gap;
      const gy = pr.y + dy / l * gap;
      b.support = {
        kind: 'nail', id: pr.id, phase: dash ? 'dashWindup' : 'approach',
        t: 0, approach: 0, gx, gy,
        ticks: conf.nail.channel,
        dashTravel: 0
      };
      b.supportCd = conf.nail.cooldown;
      if (dash) {
        // 位移按距离定长：近处 8t，最远 20t。链线在前摇里就画出来，落地无伤害。
        const dist = Math.hypot(gx - b.x, gy - b.y);
        b.support.dashTravel = Math.max(8, Math.min(20, Math.round(dist / 30)));
        b.dashCd = conf.dash.cooldown;
        w.events.push({
          type: 'helperDash', x: b.x, y: b.y, gx, gy, id: pr.id,
          windup: conf.dash.windup, travel: b.support.dashTravel
        });
      }
      w.events.push({
        type: 'supportStart', kind: 'nail', id: pr.id, x: pr.x, y: pr.y, dash
      });
    } else {
      const idol = w.boss;
      b.support = {
        kind: 'armor', phase: 'approach', t: 0, approach: 0, ticks: conf.armor.channel
      };
      b.supportCd = conf.armor.cooldown;
      // 每个脱甲窗口只尝试一次：打断它，这个窗口就归玩家。
      idol.weldTried = true;
      w.events.push({ type: 'supportStart', kind: 'armor', x: idol.x, y: idol.y });
    }
    return true;
  }

  function endSupport(w, b, cooldown) {
    b.support = null;
    b.state = 'chase';
    b.t = 0;
    b.cooldown = cooldown || 20;
  }

  function updateHelperSupport(w, b) {
    const s = b.support;
    const conf = b.def.support;
    if (!s) {
      b.state = 'chase';
      b.t = 0;
      return;
    }

    if (s.kind === 'nail') {
      const pr = w.props.find((x) => x.id === s.id);
      if (!pr || pr.state !== 'alive') {
        endSupport(w, b, 30);
        return;
      }
      // 挂链：前摇画链与落点，位移沿直线拽到护钉位，落地站稳后进入引导。
      if (s.phase === 'dashWindup') {
        s.t++;
        turnToward(b, s.gx, s.gy, 10);
        if (s.t >= conf.dash.windup) {
          s.phase = 'dashTravel';
          s.t = 0;
        }
        return;
      }
      if (s.phase === 'dashTravel') {
        const dx = s.gx - b.x;
        const dy = s.gy - b.y;
        const d = Math.hypot(dx, dy);
        if (d < 1.5) {
          b.x = s.gx;
          b.y = s.gy;
          clampBoss(w, b);
          s.phase = 'dashSettle';
          s.t = 0;
          w.events.push({ type: 'helperDashLand', x: b.x, y: b.y });
          return;
        }
        const remain = Math.max(1, s.dashTravel - s.t);
        const step = d / remain;
        b.x += dx / d * step;
        b.y += dy / d * step;
        clampBoss(w, b);
        turnToward(b, s.gx, s.gy, 12);
        s.t++;
        if (s.t >= s.dashTravel) {
          b.x = s.gx;
          b.y = s.gy;
          clampBoss(w, b);
          s.phase = 'dashSettle';
          s.t = 0;
          w.events.push({ type: 'helperDashLand', x: b.x, y: b.y });
        }
        return;
      }
      if (s.phase === 'dashSettle') {
        s.t++;
        turnToward(b, pr.x, pr.y, 8);
        if (s.t >= conf.dash.settle) {
          s.phase = 'channel';
          s.t = 0;
          w.events.push({ type: 'supportChannel', kind: 'nail', id: pr.id, x: pr.x, y: pr.y });
        }
        return;
      }
      if (s.phase === 'approach') {
        const dx = s.gx - b.x;
        const dy = s.gy - b.y;
        const d = Math.hypot(dx, dy);
        if (d > 8) {
          const spd = bossSpeed(w, b);
          b.x += dx / d * spd * TICK;
          b.y += dy / d * spd * TICK;
          clampBoss(w, b);
          clampToLeash(w, b);
          turnToward(b, pr.x, pr.y, 8);
          s.approach++;
          if (s.approach > conf.nail.approach) endSupport(w, b, 40);
          return;
        }
        s.phase = 'channel';
        s.t = 0;
        w.events.push({ type: 'supportChannel', kind: 'nail', id: pr.id, x: pr.x, y: pr.y });
      }
      s.t++;
      pr.weldTicks = Math.max(pr.weldTicks, 6);
      // 焊的同时补钉：封住刀口，也把打掉的血量一点点补回来。
      // 打断得越晚，补回去的越多；放着不管，2 秒就能补满。
      if (conf.nail.repair && pr.hp < pr.maxHp) {
        pr.hp = Math.min(pr.maxHp, pr.hp + conf.nail.repair);
      }
      turnToward(b, pr.x, pr.y, 8);
      if (s.t >= conf.nail.channel) {
        pr.weldTicks = Math.max(pr.weldTicks, conf.nail.after);
        w.events.push({ type: 'nailWeld', id: pr.id, x: pr.x, y: pr.y });
        endSupport(w, b, 26);
      }
      return;
    }

    // 焊甲：跑到本体旁边，引导 55t 把脱甲窗口直接掐掉。
    const idol = w.boss;
    if (idol.state === 'dead' || idol.exposeTicks <= 0) {
      endSupport(w, b, 30);
      return;
    }
    if (s.phase === 'approach') {
      const dx = idol.x - b.x;
      const dy = idol.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > idol.r + b.r + 6) {
        const spd = bossSpeed(w, b);
        b.x += dx / d * spd * TICK;
        b.y += dy / d * spd * TICK;
        clampBoss(w, b);
        turnToward(b, idol.x, idol.y, 8);
        s.approach++;
        if (s.approach > conf.armor.approach) endSupport(w, b, 60);
        return;
      }
      s.phase = 'channel';
      s.t = 0;
      w.events.push({ type: 'supportChannel', kind: 'armor', x: idol.x, y: idol.y });
    }
    s.t++;
    turnToward(b, idol.x, idol.y, 8);
    if (idol.exposeTicks <= 0) {
      endSupport(w, b, 40);
      return;
    }
    if (s.t >= conf.armor.channel) {
      idol.exposeTicks = 0;
      w.events.push({ type: 'armorWelded', x: idol.x, y: idol.y });
      endSupport(w, b, 20);
    }
  }

  // 锁匠的追击：常驻玩家 90px 上下，不逃。被贴到 60px 以内才后撤一步。
  // 出手前先看玩家的任务：喝药就扑，脱甲就跑去焊甲，站在钉旁就插进去护钉。
  function updateHelperChase(w, b) {
    const p = w.player;
    const conf = b.def.support;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy) || 1;

    if (b.backstepCd > 0) b.backstepCd--;
    if (b.dashCd > 0) b.dashCd--;
    if (b.backstep) {
      const st = b.backstep;
      b.x += st.dx * (70 / st.ticks);
      b.y += st.dy * (70 / st.ticks);
      clampBoss(w, b);
      clampToLeash(w, b);
      st.t++;
      if (st.t >= st.ticks) b.backstep = null;
    } else if (b.backstepCd <= 0 && d < 60) {
      b.backstep = { t: 0, ticks: 12, dx: -dx / d, dy: -dy / d };
      b.backstepCd = 240;
      w.events.push({ type: 'helperBackstep', x: b.x, y: b.y });
    }

    if (!b.backstep && b.cooldown <= 0 && d > 96) {
      const spd = bossSpeed(w, b);
      b.x += dx / d * spd * TICK;
      b.y += dy / d * spd * TICK;
      clampBoss(w, b);
      clampToLeash(w, b);
    } else {
      clampToLeash(w, b);
    }
    turnToward(b, p.x, p.y, bossTurn(w, b));

    if (b.cooldown > 0) {
      b.cooldown--;
      return;
    }
    if (!tokenFree(w, b)) return;

    if (p.state === 'heal' && d <= conf.flask.range) {
      startBossMoveOn(w, b, 'cut');
      return;
    }

    const idol = w.boss;
    if (idol.state !== 'dead' && idol.exposeTicks > conf.armor.minLeft &&
        !idol.weldTried && b.supportCd <= 0) {
      const id = Math.hypot(idol.x - b.x, idol.y - b.y);
      if (id <= conf.armor.nearIdol) {
        startHelperSupport(w, b, 'armor');
        return;
      }
    }

    // 玩家站在钉旁：近处走过去挡，远处甩链拽过去。走路赶不上的距离不硬追，
    // 免得站在原地走 80t 再放弃；挂链在冷却时就先留着这一发。
    const guardNail = pickGuardNail(w, b, conf.dash.range);
    if (guardNail && b.supportCd <= 0) {
      const nd = Math.hypot(guardNail.x - b.x, guardNail.y - b.y);
      if (nd > conf.dash.minDist) {
        if (b.dashCd <= 0) {
          startHelperSupport(w, b, 'nail', { id: guardNail.id, dash: true });
          return;
        }
      } else if (nd <= conf.nail.nearNail) {
        startHelperSupport(w, b, 'nail', { id: guardNail.id });
        return;
      }
    }

    const id = pickHelperMove(w, b);
    if (id) startBossMoveOn(w, b, id);
  }

  // 两个实体不许叠在一起。玩家被推出去，锁匠也被推离铸像，
  // 免得两个圆压在同一点、招式预告糊成一片。
  function pushApart(ax, ay, ar, bx, by, br) {
    const dx = ax - bx;
    const dy = ay - by;
    const d = Math.hypot(dx, dy);
    const min = ar + br;
    if (d >= min || d <= 1e-6) return null;
    return { x: dx / d * (min - d), y: dy / d * (min - d) };
  }

  function separate(w) {
    const b = w.boss;
    const p = w.player;
    const live = [];
    if (b.state !== 'dead') live.push(b);
    if (w.helper && w.helper.state !== 'dead') live.push(w.helper);

    if (p.state !== 'dead') {
      for (const f of live) {
        const push = pushApart(p.x, p.y, p.r, f.x, f.y, f.r);
        if (!push) continue;
        p.x += push.x;
        p.y += push.y;
        clampPlayer(w);
      }
    }

    if (w.helper && w.helper.state !== 'dead' && b.state !== 'dead') {
      const push = pushApart(w.helper.x, w.helper.y, w.helper.r, b.x, b.y, b.r);
      if (push) {
        w.helper.x += push.x;
        w.helper.y += push.y;
        clampBoss(w, w.helper);
      }
    }
  }

  function updateHazards(w) {
    const p = w.player;
    for (const h of w.hazards) {
      h.age++;
      h.ttl--;
      if (p.state === 'dead') continue;
      if (h.age % h.tick !== 0) continue;
      if (Math.hypot(p.x - h.x, p.y - h.y) <= h.r + p.r) {
        damagePlayer(w, h.damage, h.x, h.y, null, { who: h.owner, chip: true });
      }
    }
    for (let i = w.hazards.length - 1; i >= 0; i--) {
      if (w.hazards[i].ttl <= 0) w.hazards.splice(i, 1);
    }
  }

  // 火线：立起来才烧人，每 tick 间隔结一次。线段不挡路，只收过路费。
  function updateWalls(w) {
    const p = w.player;
    for (const wall of w.walls) {
      wall.age++;
      wall.ttl--;
      if (p.state !== 'dead' && wall.age % wall.tick === 0) {
        const gap = segDistance(p.x, p.y, wall.x1, wall.y1, wall.x2, wall.y2);
        if (gap <= wall.width / 2 + p.r) {
          damagePlayer(w, wall.damage, p.x, p.y, null, { who: 'king', chip: true });
        }
      }
    }
    for (let i = w.walls.length - 1; i >= 0; i--) {
      if (w.walls[i].ttl <= 0) w.walls.splice(i, 1);
    }
  }

  // 剑气：直线飞行。可弹的一发在命中前先看架式，弹中就把这一发熄掉。
  function updateProjectiles(w) {
    const p = w.player;
    const pc = w.cfg.player.parry;
    for (let i = w.projectiles.length - 1; i >= 0; i--) {
      const q = w.projectiles[i];
      q.x += q.vx * TICK;
      q.y += q.vy * TICK;
      q.ttl--;

      const hit = p.state !== 'dead' &&
        Math.hypot(p.x - q.x, p.y - q.y) <= q.r + p.r;
      if (hit) {
        const pp = p.parry;
        let parried = false;
        if (q.parryable && p.state === 'parry' && pp &&
            pp.t >= pc.windup && pp.t < pc.windup + pc.active) {
          const toQ = normalize(q.x - p.x, q.y - p.y);
          if (toQ.len > 1e-6 &&
              toQ.x * pp.dir.x + toQ.y * pp.dir.y >= Math.cos(pc.angle * Math.PI / 360)) {
            parried = true;
          }
        }
        if (parried) {
          const b = w.boss;
          if (b.def.posture) addPosture(w, b.def.posture.parry);
          p.state = 'idle';
          p.parry = null;
          w.hitstop = Math.max(w.hitstop, 8);
          w.events.push({ type: 'projectileParried', x: q.x, y: q.y });
        } else {
          damagePlayer(w, q.damage, q.x, q.y, null, { who: q.owner });
        }
        w.projectiles.splice(i, 1);
        continue;
      }

      if (q.ttl <= 0 ||
          q.x < 0 || q.y < 0 || q.x > w.cfg.arena.w || q.y > w.cfg.arena.h) {
        w.projectiles.splice(i, 1);
      }
    }
  }

  // 双 Boss 共用的每帧推进。铸像先更新，所以同一 tick 两边都能出招时铸像拿到令牌。
  function updateFighter(w, b) {
    if (b.flash > 0) b.flash--;
    if (b.dashCooldown > 0) b.dashCooldown--;
    if (b.supportCd > 0) b.supportCd--;
    if (b.lastStandCd > 0) b.lastStandCd--;
    // 令牌只登记「谁正在动作」。离开 attack／support 就自动释放，不会卡死。
    if (w.actor === b && b.state !== 'attack' && b.state !== 'support') w.actor = null;
    if (b.def.props) {
      if (b.exposeTicks > 0) {
        b.exposeTicks--;
        if (b.exposeTicks === 0) {
          w.events.push({ type: 'bossReArmored', x: b.x, y: b.y - b.r });
        }
      }
    }
    // 架势只属于铸像这一系，随从没有这条，别按两遍把衰减翻倍。
    if (b === w.boss) updatePosture(w);
    if (b.state === 'dead') {
      b.deadT++;
      return;
    }

    if (w.player.state === 'dead') {
      if (b.state === 'attack' || b.state === 'phase' || b.state === 'support') {
        b.state = 'chase';
        b.move = null;
        b.support = null;
        b.t = 0;
        b.cooldown = 30;
      }
      return;
    }

    switch (b.state) {
      case 'intro':
        b.t++;
        turnToward(b, w.player.x, w.player.y, b.def.chaseTurn);
        if (b.t >= b.def.intro) {
          b.state = 'chase';
          b.t = 0;
          b.cooldown = 10;
        }
        break;

      case 'phase': {
        b.t++;
        // 转场圈：固定 tick 结算一次，内圈与站定不动两种躲法都成立。
        const tr = b.def.transitions && b.def.transitions[b.phase];
        if (tr && tr.ring && b.t === tr.ring.at && w.player.state !== 'dead') {
          const gap = Math.hypot(w.player.x - b.x, w.player.y - b.y);
          if (gap >= tr.ring.inner && gap <= tr.ring.outer) {
            damagePlayer(w, tr.ring.damage, b.x, b.y, null, { who: 'king' });
          }
          w.events.push({ type: 'phaseRing', phase: b.phase });
        }
        const total = tr && tr.ticks != null ? tr.ticks : b.def.phaseTicks;
        if (b.t >= total) {
          b.state = 'chase';
          b.t = 0;
          b.cooldown = 14;
        }
        break;
      }

      case 'stagger':
        b.t++;
        turnToward(b, w.player.x, w.player.y, 2);
        if (b.t >= b.staggerTicks) {
          b.state = 'chase';
          b.t = 0;
          b.cooldown = 0;
          b.staggerKind = null;
          b.executed = false;
          b.staggerTicks = w.cfg.player.parry.stagger;
        }
        break;

      case 'executing':
        // 演出由玩家侧推进；Boss 保持跪地，不转身、不恢复。
        b.t++;
        break;

      case 'attack':
        updateBossAttack(w, b);
        break;

      case 'support':
        updateHelperSupport(w, b);
        break;

      case 'chase':
        if (b.ai) {
          if (b.def.helper) updateHelperChase(w, b);
          else updateBossChase(w, b);
        }
        break;
    }
  }

  function step(w, input) {
    input = input || {};
    w.tick++;
    if (w.hitstop > 0) {
      w.hitstop--;
      return;
    }

    const p = w.player;
    const cfg = w.cfg;

    if (p.exhaust > 0) p.exhaust--;
    if (p.invuln > 0) p.invuln--;
    if (p.snare > 0) p.snare--;
    if (p.buffer) {
      p.buffer.t--;
      if (p.buffer.t <= 0) p.buffer = null;
    }
    if (p.staminaDelay > 0 && p.state !== 'attack' && p.state !== 'dodge') {
      p.staminaDelay--;
    }

    const aim = normalize(input.aimX || 0, input.aimY || 0);
    if (aim.len > 0 && (p.state === 'idle' || p.state === 'move')) {
      p.facing.x = aim.x;
      p.facing.y = aim.y;
    }

    const pressed = {
      light: !!input.light,
      heavy: !!input.heavy,
      dodge: !!input.dodge,
      parry: !!input.parry,
      heal: !!input.heal
    };

    switch (p.state) {
      case 'idle':
      case 'move': {
        // 缠足锁脚：链子还在时走不动，但出招、翻滚、弹反都不受限。
        const mv = p.snare > 0 ? { x: 0, y: 0, len: 0 } : normalize(input.moveX || 0, input.moveY || 0);
        if (mv.len > 0) {
          p.x += mv.x * cfg.player.speed * TICK;
          p.y += mv.y * cfg.player.speed * TICK;
          p.state = 'move';
        } else {
          p.state = 'idle';
        }
        clampPlayer(w);

        if (pressed.light) tryStartAttack(w, 'light');
        else if (pressed.heavy) tryStartAttack(w, 'heavy');
        else if (pressed.dodge) tryStartDodge(w, input);
        else if (pressed.parry) tryStartParry(w);
        else if (pressed.heal) tryStartFlask(w);
        else if (p.buffer) consumeBuffer(w, input);
        break;
      }

      case 'attack':
        updateAttack(w, input, pressed);
        break;

      case 'dodge':
        updateDodge(w, input, pressed);
        break;

      case 'parry':
        updateParry(w);
        break;

      case 'heal':
        updateHeal(w, input);
        break;

      case 'execute':
        updateExecute(w);
        break;

      case 'retreat':
        updateRetreat(w);
        break;

      case 'hurt':
        updateHurt(w);
        break;

      case 'dead':
        updateDead(w);
        break;
    }

    updateStamina(w);
    updateFighter(w, w.boss);
    if (w.helper) updateFighter(w, w.helper);
    updateProps(w);
    updateHazards(w);
    updateWalls(w);
    updateProjectiles(w);
    separate(w);
  }

  return {
    TICK,
    CFG,
    createWorld,
    step,
    shapeHitsCircle,
    sectorHitsCircle,
    capsuleHitsCircle,
    isInvulnerable,
    damagePlayer,
    damageBoss,
    startBossMove,
    startBossMoveOn,
    startHelperSupport,
    startBossChain,
    startDoubleDash,
    startExecution,
    pickBossMove,
    pickChainAction,
    resetRun
  };
});
