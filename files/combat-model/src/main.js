/*
 * 组装：选关、固定步长循环、输入快照、事件转表现、HUD。
 */
(function (root) {
  'use strict';
  const CM = root.CM;
  const canvas = document.getElementById('game');
  const renderer = CM.render.createRenderer(canvas);
  const input = CM.input.create();

  const roster = CM.select.list();
  const store = CM.select.createStore(window.localStorage);
  let record = store.read();

  let world = null;
  let view = 'select';           // select | fight
  let cursor = 0;
  let savedRun = false;

  // 双 Boss 默认开；?duo=0 退回单挑，方便对照与旧截图复现。
  const params = new URLSearchParams(window.location.search);
  let duoWanted = params.get('duo') !== '0';

  const fx = { texts: [], trail: [], bossTrail: [], shake: 0 };

  const $ = (id) => document.getElementById(id);
  const hud = $('hud');
  const hpFill = $('hpFill');
  const stFill = $('stFill');
  const hpText = $('hpText');
  const stText = $('stText');
  const flasksEl = $('flasks');
  const stateText = $('stateText');
  const phaseText = $('phaseText');
  const tryText = $('tryText');
  const aiText = $('aiText');
  const bossbar = $('bossbar');
  const bossFill = $('bossFill');
  const bossName = $('bossName');
  const bossPhase = $('bossPhase');
  const duoBar = $('duoBar');
  const helperFill = $('helperFill');
  const helperName = $('helperName');
  const helperPhase = $('helperPhase');
  const deathEl = $('death');
  const victoryEl = $('victory');
  const victoryTitle = $('victoryTitle');
  const victorySub = $('victorySub');
  const postureWrap = $('postureWrap');
  const postureFill = $('postureFill');
  const selectEl = $('select');
  const cardsEl = $('cards');
  const parryHintEl = $('parryHint');
  const trainingPanel = $('trainingPanel');
  const parryCountEl = $('parryCount');

  // 第一次撞见可弹招时浮一条说明，看过一次就不再出现。
  const PARRY_HINT_KEY = 'combat-model/parry-hint/v1';
  let parryHintTimer = 0;
  let parryHintSeen = (() => {
    try { return window.localStorage.getItem(PARRY_HINT_KEY) === '1'; }
    catch (e) { return false; }
  })();

  function rememberParryHint() {
    try { window.localStorage.setItem(PARRY_HINT_KEY, '1'); } catch (e) {}
  }

  // 训练桩自带常驻面板，不再浮这条；定格截图的暂停态也不弹。
  function tickParryHint(dt) {
    if (parryHintTimer > 0) {
      parryHintTimer -= dt;
      if (parryHintTimer <= 0) parryHintEl.classList.remove('show');
      return;
    }
    if (parryHintSeen || paused || !world || world.boss.def.training) return;
    const b = world.boss;
    const mv = b.move;
    if (b.state !== 'attack' || !mv || mv.phase !== 'windup') return;
    const step = mv.def.steps[mv.step];
    if (!step.parryable) return;
    if (step.windup - mv.t > 18) return;
    parryHintTimer = 6;
    parryHintSeen = true;
    rememberParryHint();
    parryHintEl.classList.add('show');
  }

  const STATE_LABEL = {
    idle: '待机', move: '移动', attack: '出招',
    dodge: '翻滚', parry: '弹反', heal: '饮血',
    execute: '处决', retreat: '后撤',
    hurt: '受击', dead: '死亡'
  };
  const PHASE_LABEL = { windup: '前摇', active: '判定', recovery: '后摇' };

  let debug = false;
  let paused = false;            // 截图参数用：定格在某一帧
  let aim = { x: 0, y: 0 };
  let last = performance.now();
  let acc = 0;

  function buildCards() {
    cardsEl.innerHTML = '';
    for (const group of CM.select.groups(record)) {
      const section = document.createElement('section');
      section.className = 'group';

      const head = document.createElement('div');
      head.className = 'group-head';
      const title = document.createElement('span');
      title.className = 'group-name';
      title.textContent = group.name;
      head.append(title);
      if (group.note) {
        const note = document.createElement('span');
        note.className = 'group-note';
        note.textContent = group.note;
        head.append(note);
      }

      const grid = document.createElement('div');
      grid.className = 'group-cards';
      for (const b of group.items) {
        grid.appendChild(buildCard(b));
      }

      section.append(head, grid);
      cardsEl.appendChild(section);
    }
    syncCards();
  }

  function buildCard(b) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.index = String(b.index);
    card.style.setProperty('--accent', b.accent);

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = b.name;

    const role = document.createElement('span');
    role.className = 'card-role';
    role.textContent = b.role;

    const st = document.createElement('span');
    st.className = 'card-status' + (b.cleared ? ' done' : '');
    st.textContent = b.text;

    card.append(name, role, st);
    card.addEventListener('click', () => {
      cursor = b.index;
      syncCards();
      startFight();
    });
    return card;
  }

  function syncCards() {
    for (const el of cardsEl.querySelectorAll('.card')) {
      el.classList.toggle('active', Number(el.dataset.index) === cursor);
    }
  }

  function startFight() {
    const b = roster[cursor];
    world = CM.sim.createWorld({ boss: b.id, seed: 20261111 + cursor * 7919, duo: duoWanted });
    view = 'fight';
    savedRun = false;
    selectEl.style.display = 'none';
    hud.style.display = '';
    bossbar.style.display = '';
    deathEl.style.opacity = '0';
    victoryEl.style.opacity = '0';
    victoryTitle.textContent = b.id === 'training-dummy' ? '训练完成' : '敌人已倒下';
    victorySub.textContent = 'Enter 返回选关';
    trainingPanel.classList.toggle('show', !!world.training);
    parryCountEl.textContent = '0';
    parryHintTimer = 0;
    parryHintEl.classList.remove('show');
    fx.texts.length = 0;
    fx.trail.length = 0;
    fx.bossTrail.length = 0;
    fx.shake = 0;
    input.clearKeys();
    last = performance.now();
    acc = 0;
    updateHud();
  }

  function backToSelect() {
    if (view !== 'fight') return;
    view = 'select';
    world = null;
    input.clearKeys();
    trainingPanel.classList.remove('show');
    parryHintTimer = 0;
    parryHintEl.classList.remove('show');
    selectEl.style.display = 'flex';
    hud.style.display = 'none';
    bossbar.style.display = 'none';
    deathEl.style.opacity = '0';
    victoryEl.style.opacity = '0';
    buildCards();
  }

  function saveVictory() {
    if (!world || savedRun || world.boss.def.training) return;
    savedRun = true;
    const id = world.boss.def.id;
    record = CM.select.recordWin(record, id, world.tick / 60, world.deaths + 1);
    store.write(record);
  }

  // 注册回调走 setter：input.onXxx(fn)。写成赋值会把 onXxx 注册函数本身覆盖掉，
  // 按键从此静默失效；input.js 导出的对象已冻结，赋值会直接抛错。
  input.onToggleDebug(() => {
    debug = !debug;
  });

  input.onToggleBoss(() => {
    if (!world) return;
    const b = world.boss;
    b.ai = !b.ai;
    if (b.ai && b.state === 'chase') b.cooldown = Math.max(b.cooldown, 24);
  });

  input.onReset(() => {
    if (!world) return;
    CM.sim.resetRun(world);
    savedRun = false;
    fx.texts.length = 0;
    fx.trail.length = 0;
    fx.bossTrail.length = 0;
    fx.shake = 0;
  });

  input.onEscape(() => backToSelect());

  input.onConfirm(() => {
    if (view === 'select') startFight();
    else if (world && (world.outcome === 'victory' || (world.training && world.training.done))) backToSelect();
  });

  window.addEventListener('keydown', (e) => {
    if (view !== 'select') return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      cursor = CM.select.moveIndex(cursor, -1, roster.length);
      syncCards();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      cursor = CM.select.moveIndex(cursor, 1, roster.length);
      syncCards();
    }
  });

  window.addEventListener('resize', () => renderer.resize());
  renderer.resize();

  function updateHud() {
    if (!world) return;
    const p = world.player;
    const b = world.boss;

    hpFill.style.width = (Math.max(0, p.hp) / p.maxHp * 100).toFixed(1) + '%';
    stFill.style.width = (Math.max(0, p.stamina) / p.maxStamina * 100).toFixed(1) + '%';
    hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    stText.textContent = `${Math.round(p.stamina)} / ${p.maxStamina}`;

    const maxFlask = world.cfg.player.flask.max;
    let pips = '';
    for (let i = 0; i < maxFlask; i++) pips += `<i class="${i < p.flasks ? 'on' : ''}"></i>`;
    flasksEl.innerHTML = pips;

    let label = STATE_LABEL[p.state] || p.state;
    if (p.state === 'attack' && p.action) {
      label = `${p.action.kind === 'light' ? '轻击' : '重击'}·${PHASE_LABEL[p.action.phase]}`;
    } else if (p.state === 'parry' && p.parry) {
      const c = world.cfg.player.parry;
      const phase = p.parry.t < c.windup ? '起手'
        : p.parry.t < c.windup + c.active ? '架式' : '收势';
      label = `弹反·${phase}`;
    }
    stateText.textContent = label;
    phaseText.textContent = b.phase === 2 ? '二' : b.phase >= 3 ? '三' : '一';
    tryText.textContent = String(world.attempts);
    aiText.textContent = b.ai ? '开' : '关';

    // 终局型每一幕换一次名字：王 → 无名的战士 → 燃尽的王。
    const tr = b.def.transitions && b.def.transitions[b.phase];
    bossName.textContent = tr && tr.name ? tr.name : b.def.name;
    bossFill.style.width = (Math.max(0, b.hp) / b.maxHp * 100).toFixed(1) + '%';
    if (b.state === 'stagger') {
      // 机关型跪着也不进处决：报脱甲读秒，别报「可处决」。
      // 其余 Boss 的破韧与弹反都进同一种可处决窗口。
      bossPhase.textContent = b.def.props
        ? `脱甲 ${(b.exposeTicks / 60).toFixed(1)}s`
        : b.staggerKind === 'break'
          ? `${(b.def.posture && b.def.posture.label) || '架势'}崩·可处决`
          : '弹反·可处决';
    } else if (b.state === 'executing') {
      bossPhase.textContent = '处决中';
    } else if (b.def.props) {
      // 机制型：平时报锁链还剩几条，脱甲时报读秒。
      if (b.exposeTicks > 0) {
        bossPhase.textContent = `脱甲 ${(b.exposeTicks / 60).toFixed(1)}s`;
      } else {
        const alive = world.props.filter((pr) => pr.state === 'alive').length;
        const freed = world.props.length - alive;
        bossPhase.textContent =
          `铁甲 · 锁链 ${alive}/${world.props.length} · 解封 ${freed}/${world.props.length}`;
      }
    } else {
      let phaseLabel = b.phase === 2 ? '第二阶段' : b.phase >= 3 ? '第三阶段' : '第一阶段';
      // 三幕的燃地是场上数量最多的可变量，靠眼睛数不清；上限与当前块数写在这里。
      if (b.phase >= 3 && b.def.embers) {
        const n = world.hazards.filter((h) => h.ember).length;
        phaseLabel += ` · 燃地 ${n}/${b.def.embers.max}`;
        if (world.walls.length) phaseLabel += ` · 火线 ${world.walls.length}`;
      }
      bossPhase.textContent = phaseLabel;
    }
    bossPhase.classList.toggle('hot', b.phase >= 2 || b.state === 'stagger' ||
      b.state === 'executing' || b.exposeTicks > 0);

    // 第二条血条只在双 Boss 战出现。锁匠血少，但它的状态更重要：
    // 正在护哪根钉、正在掐哪次脱甲窗口，都要在这里显示出来。
    duoBar.classList.toggle('on', !!world.helper);
    if (world.helper) {
      const h = world.helper;
      helperFill.style.width = (Math.max(0, h.hp) / h.maxHp * 100).toFixed(1) + '%';
      helperName.textContent = h.def.name;
      const s = h.support;
      let note = '干预';
      let tone = '';
      if (h.state === 'dead') {
        note = '已倒下';
        tone = 'down';
      } else if (s) {
        const ticks = s.ticks || 1;
        if (s.phase === 'approach') {
          note = s.kind === 'nail' ? '扑向熔钉' : '扑向本体';
        } else if (s.phase === 'dashWindup' || s.phase === 'dashTravel') {
          note = '挂链';
          tone = 'channel';
        } else if (s.phase === 'dashSettle') {
          note = '落位';
          tone = 'channel';
        } else {
          note = `${s.kind === 'nail' ? '护钉' : '焊甲'} ${(s.t / ticks * 100).toFixed(0)}%`;
          tone = 'channel';
        }
      } else if (h.state === 'attack' && h.move) {
        note = h.move.def.name;
      } else if (h.rage) {
        note = '愤怒';
        tone = 'channel';
      }
      helperPhase.textContent = note;
      helperPhase.className = tone;
    }

    const posture = b.def.posture;
    postureWrap.classList.toggle('on', !!posture);
    if (posture) {
      const cap = posture.phaseCaps ? posture.phaseCaps[b.phase - 1] : posture.max;
      postureFill.style.width = (Math.max(0, b.posture) / cap * 100).toFixed(1) + '%';
      postureWrap.classList.toggle('broken', b.staggerKind === 'break');
      postureWrap.classList.toggle('tough', posture.label === '韧性');
    }

    deathEl.style.opacity = p.state === 'dead' ? '1' : '0';
    victoryEl.style.opacity = world.outcome === 'victory' || (world.training && world.training.done) ? '1' : '0';
    if (world.training) parryCountEl.textContent = String(world.training.parries);
  }

  function playerText(text, color, size) {
    if (!world) return;
    fx.texts.push({
      x: world.player.x,
      y: world.player.y - 26,
      text,
      color,
      life: 0.8,
      max: 0.8,
      vy: -26,
      size: size || 14
    });
  }

  function drainEvents() {
    for (const e of world.events) {
      if (e.type === 'bossHit') {
        const exec = e.kind === 'execute';
        fx.texts.push({
          x: e.x,
          y: e.y,
          text: exec ? '处决 -' + e.damage : '-' + e.damage,
          color: exec ? '#ffe08a' : e.kind === 'heavy' ? '#ffd27a' : '#eef4ff',
          life: exec ? 1.2 : 0.7,
          max: exec ? 1.2 : 0.7,
          vy: -36,
          size: exec ? 30 : e.kind === 'heavy' ? 20 : 15
        });
        fx.shake = Math.max(fx.shake, exec ? 14 : e.kind === 'heavy' ? 7 : 3.5);
      } else if (e.type === 'executionStart') {
        fx.texts.push({
          x: e.x,
          y: e.y - 62,
          text: '处决',
          color: '#ffe6a8',
          life: 0.7,
          max: 0.7,
          vy: -8,
          size: 22
        });
        fx.shake = Math.max(fx.shake, 6);
      } else if (e.type === 'bossPhase') {
        fx.texts.push({
          x: e.x,
          y: e.y - 70,
          text: e.name || (e.phase >= 3 ? '第三阶段' : '第二阶段'),
          color: '#ff9a6a',
          life: 1.2,
          max: 1.2,
          vy: -12,
          size: 22
        });
        fx.shake = Math.max(fx.shake, 10);
      } else if (e.type === 'embersCleared') {
        fx.texts.push({
          x: world.boss.x,
          y: world.boss.y - 54,
          text: '火灭了',
          color: '#ffd8a8',
          life: 1,
          max: 1,
          vy: -14,
          size: 20
        });
      } else if (e.type === 'projectileParried') {
        fx.texts.push({
          x: e.x,
          y: e.y - 20,
          text: '弹反',
          color: '#bfe9ff',
          life: 0.8,
          max: 0.8,
          vy: -18,
          size: 19
        });
        fx.shake = Math.max(fx.shake, 6);
      } else if (e.type === 'bossDeath') {
        fx.shake = Math.max(fx.shake, 12);
      } else if (e.type === 'playerHit') {
        fx.texts.push({
          x: e.x,
          y: e.y - 18,
          text: '-' + e.damage,
          color: '#ff8576',
          life: 0.85,
          max: 0.85,
          vy: -28,
          size: 17
        });
        fx.shake = Math.max(fx.shake, 9);
      } else if (e.type === 'death') {
        fx.shake = Math.max(fx.shake, 12);
      } else if (e.type === 'parry') {
        fx.texts.push({
          x: e.x,
          y: e.y,
          text: '弹反',
          color: '#bfe9ff',
          life: 0.9,
          max: 0.9,
          vy: -20,
          size: 22
        });
        fx.shake = Math.max(fx.shake, 8);
      } else if (e.type === 'postureBreak') {
        fx.texts.push({
          x: e.x,
          y: e.y - 52,
          text: `${e.label || '架势'}崩`,
          color: '#ffe6a8',
          life: 1.1,
          max: 1.1,
          vy: -16,
          size: 24
        });
        fx.shake = Math.max(fx.shake, 10);
      } else if (e.type === 'guardHit') {
        fx.texts.push({
          x: e.x,
          y: e.y,
          text: e.broken ? '破架' : '被架住',
          color: e.broken ? '#ffe6a8' : '#c3cfdd',
          life: 0.8,
          max: 0.8,
          vy: -24,
          size: 18
        });
        fx.shake = Math.max(fx.shake, 6);
      } else if (e.type === 'guardRecoil') {
        playerText('被弹开', '#c3cfdd', 14);
        fx.shake = Math.max(fx.shake, 5);
      } else if (e.type === 'flask') {
        fx.texts.push({
          x: world.player.x,
          y: world.player.y - 26,
          text: '+' + e.heal,
          color: '#8ce8a0',
          life: 0.8,
          max: 0.8,
          vy: -28,
          size: 16
        });
      } else if (e.type === 'flaskBreak') {
        playerText('饮血被打断', '#c08a72', 13);
      } else if (e.type === 'hazardSpawn') {
        fx.shake = Math.max(fx.shake, 3);
      } else if (e.type === 'bossUnseal') {
        fx.texts.push({
          x: e.x,
          y: e.y,
          text: `解封 ${e.level}/${e.total}`,
          color: '#ffd28a',
          life: 0.9,
          max: 0.9,
          vy: -14,
          size: 16
        });
        fx.shake = Math.max(fx.shake, 3);
      } else if (e.type === 'bossArmored') {
        // 铁甲挡刀：只冒火星，不给伤害数字，免得看起来像打中了。
        playerText('铁甲', '#b9b3a4', 14);
        fx.shake = Math.max(fx.shake, 2.5);
      } else if (e.type === 'bossExposed') {
        fx.texts.push({
          x: e.x,
          y: e.y - 64,
          text: '弹反·脱甲',
          color: '#ffc27a',
          life: 1,
          max: 1,
          vy: -12,
          size: 20
        });
        fx.shake = Math.max(fx.shake, 7);
      } else if (e.type === 'bossReArmored') {
        playerText('铁甲复原', '#b9b3a4', 14);
      } else if (e.type === 'propHit') {
        fx.texts.push({
          x: e.x,
          y: e.y - 12,
          text: '-' + e.damage,
          color: '#d8c79a',
          life: 0.6,
          max: 0.6,
          vy: -26,
          size: 13
        });
      } else if (e.type === 'propBreak') {
        fx.texts.push({
          x: e.x,
          y: e.y - 26,
          text: '断链',
          color: '#ffc27a',
          life: 1,
          max: 1,
          vy: -18,
          size: 18
        });
        fx.shake = Math.max(fx.shake, 6);
      }
    }
    world.events.length = 0;
  }

  function updateFx(dt) {
    if (!world) return;
    if (world.player.state === 'dodge') {
      fx.trail.push({ x: world.player.x, y: world.player.y, life: 0.24, max: 0.24 });
    }

    const b = world.boss;
    if (b.state === 'attack' && b.move && b.move.id === 'lunge' && b.move.phase === 'active') {
      fx.bossTrail.push({ x: b.x, y: b.y, life: 0.22, max: 0.22 });
    }

    for (let i = fx.trail.length - 1; i >= 0; i--) {
      fx.trail[i].life -= dt;
      if (fx.trail[i].life <= 0) fx.trail.splice(i, 1);
    }
    for (let i = fx.bossTrail.length - 1; i >= 0; i--) {
      fx.bossTrail[i].life -= dt;
      if (fx.bossTrail[i].life <= 0) fx.bossTrail.splice(i, 1);
    }

    for (let i = fx.texts.length - 1; i >= 0; i--) {
      const t = fx.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      if (t.life <= 0) fx.texts.splice(i, 1);
    }

    fx.shake *= Math.exp(-16 * dt);
    if (fx.shake < 0.05) fx.shake = 0;
  }

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    acc += dt;

    if (view === 'fight' && world) {
      aim = renderer.screenToWorld(input.mouse.x, input.mouse.y);

      let steps = 0;
      while (!paused && acc >= CM.sim.TICK && steps < 4) {
        CM.sim.step(world, input.snapshot(world.player.x, world.player.y, aim));
        input.clearEdges();
        acc -= CM.sim.TICK;
        steps++;
      }

      drainEvents();
      updateFx(dt);
      renderer.draw(world, fx, debug, aim);
      updateHud();
      tickParryHint(dt);
      if (world.outcome === 'victory') saveVictory();
    } else {
      acc = 0;
    }

    requestAnimationFrame(frame);
  }

  buildCards();
  hud.style.display = 'none';
  bossbar.style.display = 'none';

  // 方便截图与复现：?boss=ash-stoker 直接进对应的战斗。
  // 追加 move/at/px/py 可以定格某一招的某一帧，live=1 则不冻结；hp=1 用来验结算与回选关。
  const wanted = params.get('boss');
  if (wanted) {
    const idx = roster.findIndex((b) => b.id === wanted);
    if (idx >= 0) {
      cursor = idx;
      syncCards();
      startFight();

      const px = params.get('px');
      const py = params.get('py');
      if (px != null && py != null) {
        world.player.x = Math.max(14, Math.min(946, Number(px)));
        world.player.y = Math.max(14, Math.min(586, Number(py)));
      }

      const bossHp = Number(params.get('hp'));
      if (Number.isFinite(bossHp) && bossHp > 0) {
        world.boss.hp = bossHp;
        updateHud();
      }

      // 阶段预置：走真实的转场，场地改造（炉渣、灭火）才会生效。
      // phase=3 先把血量压到第一条线再压第二条，两次都走真实转场。
      const wantPhase = Math.floor(Number(params.get('phase')));
      if (Number.isFinite(wantPhase) && wantPhase >= 2 && world.boss.phase === 1) {
        world.boss.hp = world.boss.maxHp * world.boss.def.phaseAt;
        CM.sim.damageBoss(world, 1, 'light');
        for (let i = 0; i < 44; i++) CM.sim.step(world, {});
        if (wantPhase >= 3 && world.boss.phase === 2 && world.boss.def.phaseAt2 != null) {
          world.boss.hp = world.boss.maxHp * world.boss.def.phaseAt2;
          CM.sim.damageBoss(world, 1, 'light');
          for (let i = 0; i < 34; i++) CM.sim.step(world, {});
        }
        world.events.length = 0;
        updateHud();
      }

      // 架势 / 韧性预置：验破防浮层与条，不用真的打满。上限按当前幕算。
      const posture = Number(params.get('posture'));
      if (world.boss.def.posture && Number.isFinite(posture) && posture > 0) {
        const def = world.boss.def.posture;
        const cap = def.phaseCaps ? def.phaseCaps[world.boss.phase - 1] : def.max;
        world.boss.posture = Math.min(cap, posture);
        world.boss.postureDelay = 999;
        updateHud();
      }

      // 训练计数预置：?boss=training-dummy&parries=3 直接验「练完 → 完成浮层 → Enter 回选关」。
      const parries = Number(params.get('parries'));
      if (world.training && Number.isFinite(parries) && parries > 0) {
        world.training.parries = Math.min(world.training.need, Math.floor(parries));
        world.training.done = world.training.parries >= world.training.need;
        if (world.training.done) {
          world.boss.ai = false;
          world.boss.cooldown = 9999;
        }
        updateHud();
      }

      // 机关预置：?expose=120 掀开铁甲；?props=down,growing,down 按顺序摆熔钉状态。
      const expose = Number(params.get('expose'));
      if (world.boss.def.props && Number.isFinite(expose) && expose > 0) {
        world.boss.exposeTicks = Math.min(expose, world.boss.def.props.expose);
      }
      // ?stagger=1 让本体跪满整个脱甲窗口，验弹反后的姿势与「没有处决圈」。
      if (world.boss.def.props && params.get('stagger') != null) {
        const b = world.boss;
        b.ai = false;
        b.state = 'stagger';
        b.staggerKind = 'parry';
        b.staggerTicks = b.def.props.expose;
        b.executed = true;
        b.t = 0;
        b.move = null;
        b.cooldown = 0;
        if (b.exposeTicks <= 0) b.exposeTicks = b.def.props.expose;
      }
      const props = params.get('props');
      if (world.props.length && props) {
        props.split(',').forEach((st, i) => {
          const pr = world.props[i];
          if (!pr || (st !== 'down' && st !== 'growing')) return;
          pr.state = st;
          pr.hp = 0;
          pr.t = st === 'growing' ? Math.round(world.boss.def.props.tele * 0.6) : 0;
        });
      }

      // 双 Boss 预置：?helperHp=40 压锁匠血量；?support=nail|armor|dash&at=N 定格一次干预。
      const helperHp = Number(params.get('helperHp'));
      if (world.helper && Number.isFinite(helperHp) && helperHp > 0) {
        world.helper.hp = Math.min(helperHp, world.helper.maxHp);
      }
      const support = params.get('support');
      if (support && world.helper) {
        const h = world.helper;
        const b = world.boss;
        b.ai = false;
        b.state = 'chase';
        b.t = 0;
        b.cooldown = 9999;
        h.ai = false;
        h.state = 'chase';
        h.t = 0;
        h.cooldown = 9999;
        let started = false;
        if (support === 'armor') {
          b.exposeTicks = Math.max(b.exposeTicks, b.def.props ? b.def.props.expose : 120);
          const a = Math.atan2(h.y - b.y, h.x - b.x);
          h.x = b.x + Math.cos(a) * (b.r + h.r + 4);
          h.y = b.y + Math.sin(a) * (b.r + h.r + 4);
          started = CM.sim.startHelperSupport(world, h, 'armor');
        } else if (support === 'dash') {
          // 挂链定格：玩家站到钉旁，锁匠留在远端，链子横跨半个场地。
          const nail = world.props.find((pr) => pr.state === 'alive');
          if (nail) {
            world.player.x = nail.x - 92;
            world.player.y = nail.y;
            h.x = nail.x - 470;
            h.y = nail.y - 170;
            started = CM.sim.startHelperSupport(world, h, 'nail', { id: nail.id, dash: true });
          }
        } else {
          const nail = world.props.find((pr) => pr.state === 'alive');
          if (nail) started = CM.sim.startHelperSupport(world, h, 'nail', { id: nail.id });
        }
        if (started) {
          const at = Number(params.get('at') || 0);
          for (let i = 0; i < at; i++) CM.sim.step(world, {});
          world.events.length = 0;
          paused = params.get('live') == null;
        }
      }
      updateHud();

      // 锁匠招式定格：?hmove=chainfire&at=N 直接让锁匠出这一招，验冷色链火与预告。
      const hmove = params.get('hmove');
      if (hmove && world.helper) {
        const h = world.helper;
        const b = world.boss;
        b.ai = false;
        b.state = 'chase';
        b.cooldown = 9999;
        h.ai = false;
        h.state = 'chase';
        h.t = 0;
        h.cooldown = 0;
        const dx = world.player.x - h.x;
        const dy = world.player.y - h.y;
        const l = Math.hypot(dx, dy) || 1;
        h.dir = { x: dx / l, y: dy / l };
        if (CM.sim.startBossMoveOn(world, h, hmove)) {
          const at = Number(params.get('at') || 0);
          for (let i = 0; i < at; i++) CM.sim.step(world, {});
          world.events.length = 0;
          paused = params.get('live') == null;
          updateHud();
        }
      }

      const moveId = params.get('move');
      if (moveId) {
        const b = world.boss;
        b.ai = false;
        b.state = 'chase';
        b.t = 0;
        b.cooldown = 0;
        const dx = world.player.x - b.x;
        const dy = world.player.y - b.y;
        const l = Math.hypot(dx, dy) || 1;
        b.dir = { x: dx / l, y: dy / l };
        CM.sim.startBossMove(world, moveId);
        const at = Number(params.get('at') || 0);
        for (let i = 0; i < at; i++) CM.sim.step(world, {});
        world.events.length = 0;
        paused = params.get('live') == null;
        updateHud();
      }

      // 连招定格：?chain=1&at=N 从链首推进 N tick，验终结预告与收刀圈。
      // 终局型用 ?act=1|2|3 指定从哪一幕起手。
      if (params.get('chain') != null) {
        const b = world.boss;
        b.ai = false;
        b.phase = Math.max(1, Math.min(3, Number(params.get('act') || 2)));
        b.state = 'chase';
        b.t = 0;
        b.cooldown = 0;
        const dx = world.player.x - b.x;
        const dy = world.player.y - b.y;
        const l = Math.hypot(dx, dy) || 1;
        b.dir = { x: dx / l, y: dy / l };
        if (CM.sim.startBossChain(world)) {
          const at = Number(params.get('at') || 0);
          for (let i = 0; i < at; i++) CM.sim.step(world, {});
          world.events.length = 0;
          paused = params.get('live') == null;
          updateHud();
        }
      }

      // 二连冲定格：?ddash=1&at=N 从第一段推进 N tick，验两段走廊与重画。
      if (params.get('ddash') != null) {
        const b = world.boss;
        b.ai = false;
        b.phase = 2;
        b.state = 'chase';
        b.t = 0;
        b.cooldown = 0;
        b.def.chain.doubleDash.chance = 1;
        b.dashCooldown = 0;
        if (CM.sim.startDoubleDash(world)) {
          const at = Number(params.get('at') || 0);
          for (let i = 0; i < at; i++) CM.sim.step(world, {});
          world.events.length = 0;
          paused = params.get('live') == null;
          updateHud();
        }
      }

      // 处决定格：?exec=1&at=N 直接进可处决窗口并触发演出，验特写与退开。
      if (params.get('exec') != null) {
        const b = world.boss;
        b.ai = false;
        b.state = 'stagger';
        b.staggerKind = 'parry';
        b.staggerTicks = world.cfg.player.parry.stagger;
        b.executed = false;
        b.t = 0;
        b.move = null;
        b.cooldown = 0;
        const dx = world.player.x - b.x;
        const dy = world.player.y - b.y;
        const l = Math.hypot(dx, dy) || 1;
        b.dir = { x: dx / l, y: dy / l };
        if (CM.sim.startExecution(world)) {
          const at = Number(params.get('at') || 0);
          for (let i = 0; i < at; i++) CM.sim.step(world, {});
          world.events.length = 0;
          paused = params.get('live') == null;
          updateHud();
        }
      }
    }
  }

  requestAnimationFrame(frame);
})(globalThis);
