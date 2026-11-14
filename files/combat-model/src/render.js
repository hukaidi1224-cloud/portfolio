/*
 * Canvas 绘制：场地、Boss、玩家、扇形预瞄、调试层。
 */
(function (root) {
  'use strict';
  const CM = root.CM || (root.CM = {});
  const VIEW = { w: 960, h: 600 };
  const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  // 档位配色：快=琥珀，中=橙，慢=暗红。颜色本身就是读牌线索。
  const TIER = {
    '快': { fill: '255,186,96', line: '255,224,164' },
    '中': { fill: '255,132,66', line: '255,188,126' },
    '慢': { fill: '236,62,50', line: '255,126,106' },
    // 终结技：连招的最后一动，金色。和慢档的暖红分开，
    // 读法是「这一下打完它就停」，不是「更快更疼的慢招」。
    '终结': { fill: '255,210,110', line: '255,246,196' }
  };
  // 弹反专用色（青白）。三档预警全在暖色系里，可弹信号必须跳出这个家族才认得出来。
  const PARRY = '120,230,255';
  // 擒拿专用色（紫）：连翻滚都躲不掉，必须和「能滚掉的暖红」分开。
  const GRAB = '190,140,255';
  // 举架专用色（钢灰）：它现在不打算打你，只是等你出手。
  const GUARD = '176,196,220';

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    const view = { dpr: 1, scale: 1, ox: 0, oy: 0 };

    function resize() {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const cw = window.innerWidth;
      const ch = window.innerHeight;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
      const scale = Math.min(cw / VIEW.w, ch / VIEW.h);
      view.dpr = dpr;
      view.scale = scale;
      view.ox = (cw - VIEW.w * scale) / 2;
      view.oy = (ch - VIEW.h * scale) / 2;
    }

    function screenToWorld(clientX, clientY) {
      return {
        x: (clientX - view.ox) / view.scale,
        y: (clientY - view.oy) / view.scale
      };
    }

    const smooth = (x) => x * x * (3 - 2 * x);

    function setArenaTransform(shakeX, shakeY, cam) {
      const k = cam ? smooth(cam.k) : 0;
      const zoom = cam ? 1 + (cam.zoom - 1) * k : 1;
      const scale = view.scale * zoom;
      let tx = view.ox + shakeX;
      let ty = view.oy + shakeY;
      if (cam && k > 0) {
        // 目标点从场地中心连续滑向玩家与 Boss 的中点，x/y/缩放三者同一进度，
        // 缩回末尾会精确落到常规变换，不留跳帧。
        const cx = VIEW.w / 2 + (cam.x - VIEW.w / 2) * k;
        const cy = VIEW.h / 2 + (cam.y - VIEW.h / 2) * k;
        tx = view.ox + (VIEW.w / 2) * view.scale - scale * cx + shakeX;
        ty = view.oy + (VIEW.h / 2) * view.scale - scale * cy + shakeY;
      }
      ctx.setTransform(
        view.dpr * scale, 0, 0, view.dpr * scale,
        view.dpr * tx,
        view.dpr * ty
      );
    }

    // 处决特写：推近到玩家与 Boss 的中点，结束后缩回。
    // k 同时控制缩放和目标点：k=0 时必须精确落在无位移的常规变换上，
    // 否则缩回的最后几帧会从「以中点为心」突然跳回「以场地为心」。
    function executionCam(w) {
      const e = w.player.execute;
      if (!e) return null;
      const c = w.cfg.player.execution;
      const fade = 16;
      let k = 1;
      if (e.t < fade) k = e.t / fade;
      else if (e.t > c.ticks - fade) k = Math.max(0, (c.ticks - e.t) / fade);
      return {
        k,
        zoom: 1.45,
        x: (w.player.x + w.boss.x) / 2,
        y: (w.player.y + w.boss.y) / 2
      };
    }

    function drawArena() {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);

      ctx.strokeStyle = 'rgba(120,150,190,0.055)';
      ctx.lineWidth = 1;
      for (let x = 60; x < VIEW.w; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, VIEW.h);
        ctx.stroke();
      }
      for (let y = 60; y < VIEW.h; y += 60) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(VIEW.w, y);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(120,150,190,0.10)';
      ctx.beginPath();
      ctx.arc(VIEW.w / 2, VIEW.h / 2, 120, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(VIEW.w / 2 - 14, VIEW.h / 2);
      ctx.lineTo(VIEW.w / 2 + 14, VIEW.h / 2);
      ctx.moveTo(VIEW.w / 2, VIEW.h / 2 - 14);
      ctx.lineTo(VIEW.w / 2, VIEW.h / 2 + 14);
      ctx.stroke();

      ctx.strokeStyle = '#263041';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, VIEW.w - 2, VIEW.h - 2);

      ctx.strokeStyle = 'rgba(110,140,180,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(12, 12, VIEW.w - 24, VIEW.h - 24);
    }

    function pie(x, y, r, a0, a1, fill, stroke, lw) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, a0, a1);
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw || 1;
        ctx.stroke();
      }
    }

    // 胶囊：沿方向从 (x,y) 拉出 len，两端都是半圆。
    // 判定用的是同一条线段加半宽，画出来的圆头就是末端的实际边界。
    function capsulePath(x, y, dx, dy, len, hw) {
      const ang = Math.atan2(dy, dx);
      const ex = x + dx * len;
      const ey = y + dy * len;
      ctx.beginPath();
      ctx.arc(x, y, hw, ang + Math.PI / 2, ang + Math.PI * 1.5, false);
      ctx.arc(ex, ey, hw, ang - Math.PI / 2, ang + Math.PI / 2, false);
      ctx.closePath();
    }


    // 环形：内径以内不填色，画出来的亮区就是真正会吃伤害的区域。
    function annulus(x, y, inner, outer, a0, a1, fill, stroke, lw) {
      const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
      ctx.beginPath();
      ctx.arc(x, y, outer, a0, a1, false);
      if (full && inner > 0) {
        // 整圈时另起一段画内圈，避免 closePath 在内径上拉出一条径向接缝。
        ctx.moveTo(x + inner, y);
        ctx.arc(x, y, inner, 0, -Math.PI * 2, true);
      } else if (inner > 0) {
        ctx.lineTo(x + Math.cos(a1) * inner, y + Math.sin(a1) * inner);
        ctx.arc(x, y, inner, a1, a0, true);
      } else if (!full) {
        // 只有扇形才需要连回圆心；整圈直接收口，否则会留下一条半径接缝。
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw || 1;
        ctx.stroke();
      }
    }

    // 武器线段：起点略在身体内侧，终点在指定长度。
    function limb(x, y, angle, len, width, dark, light) {
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * len * 0.18, y + Math.sin(angle) * len * 0.18);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.strokeStyle = dark;
      ctx.lineWidth = width + 4;
      ctx.stroke();
      ctx.strokeStyle = light;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    // ---- Boss 预瞄 ----

    // 可弹招式的稳定信号：前摇最后 18t 起，身体外沿亮一道青白环（半径 1.25r），
    // 武器同步亮一条青白线，最后 2t 白闪。青白是三档暖色之外的专用色，
    // 读法是二元的「有环 = 能弹、没环 = 只能躲」，不靠分辨色相，色弱也能用。
    // 画在身体与武器之后，才盖得住扇形底色。
    function drawParryTell(b, step, mv) {
      const left = step.windup - mv.t;
      if (left > 18) return;
      const k = 1 - Math.max(0, left) / 18;
      const base = Math.atan2(b.dir.y, b.dir.x);
      const ringR = b.r * 1.25;

      const g = ctx.createRadialGradient(b.x, b.y, b.r * 0.9, b.x, b.y, ringR + 10);
      g.addColorStop(0, `rgba(${PARRY},${0.10 + 0.16 * k})`);
      g.addColorStop(1, `rgba(${PARRY},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, ringR + 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(b.x, b.y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${PARRY},${0.35 + 0.55 * k})`;
      ctx.lineWidth = 2.5 + 1.5 * k;
      ctx.stroke();

      const x0 = b.x + Math.cos(base) * b.r * 0.55;
      const y0 = b.y + Math.sin(base) * b.r * 0.55;
      const x1 = b.x + Math.cos(base) * (b.r + 34);
      const y1 = b.y + Math.sin(base) * (b.r + 34);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = `rgba(${PARRY},${0.30 + 0.60 * k})`;
      ctx.lineWidth = 2 + 2 * k;
      ctx.stroke();

      // 最后 6t 白闪。弹反的有效输入是命中前 3–11t，闪的起点按下去正好落在窗口里；
      // 拖到只剩 2t 才闪，照着闪按反而必吃。
      if (left <= 6) {
        const flash = 0.30 + 0.62 * (left / 6);
        ctx.beginPath();
        ctx.arc(b.x, b.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${flash})`;
        ctx.lineWidth = 3 + 3 * (left / 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = `rgba(255,255,255,${flash})`;
        ctx.lineWidth = 3 + 3 * (left / 6);
        ctx.stroke();
      }
    }

    // 不可弹招式的稳定信号：身体外沿一圈锯齿，暖红、无光晕，全程不白闪。
    // 形状与可弹的青白平滑环直接对立：圆环能弹，锯齿只能躲。
    // 锯齿随前摇转动并变长，出手前读起来是「在绞牙」。
    // 擒拿共用锯齿，但换成紫色并在正面叠两道双箭头：滚不掉，只能拉开距离。
    function drawDangerTell(b, step, mv) {
      const prog = Math.min(1, mv.t / Math.max(1, step.windup));
      const grab = !!step.grab;
      const tone = grab ? GRAB : '255,104,78';
      const r = b.r * 1.22;
      const spin = mv.t * 0.10;
      const spikes = 12;
      const tip = r + 5 + 9 * prog;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = spin + (i / (spikes * 2)) * Math.PI * 2;
        const rr = i % 2 === 0 ? tip : r - 2;
        const x = b.x + Math.cos(a) * rr;
        const y = b.y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = grab ? 'rgba(190,140,255,0.09)' : 'rgba(236,62,50,0.07)';
      ctx.fill();
      ctx.strokeStyle = `rgba(${tone},${0.34 + 0.42 * prog})`;
      ctx.lineWidth = grab ? 2.5 : 2;
      ctx.stroke();

      // 终结技：锯齿外面再套一圈金色刻度环。它比暖红锯齿更「重」，
      // 读法是「最后一动，打完它会停」——看到这圈就该算退出的距离，
      // 而不是硬吃一下再贪刀。
      if (step.finisher) {
        const gold = '255,222,140';
        const aura = b.r * (1.50 + 0.30 * prog);
        ctx.beginPath();
        ctx.arc(b.x, b.y, aura, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${gold},${0.34 + 0.50 * prog})`;
        ctx.lineWidth = 3 + 2 * prog;
        ctx.stroke();

        for (let i = 0; i < 8; i++) {
          const a = spin * 0.6 + i * Math.PI / 4;
          const r0 = aura + 5;
          const r1 = aura + 11 + 7 * prog;
          ctx.beginPath();
          ctx.moveTo(b.x + Math.cos(a) * r0, b.y + Math.sin(a) * r0);
          ctx.lineTo(b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1);
          ctx.strokeStyle = `rgba(${gold},${0.26 + 0.46 * prog})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }

      if (!grab) return;

      // 双箭头朝外：读法是「它在抓你，往外跑」，不是「滚一下」。
      const base = Math.atan2(b.dir.y, b.dir.x);
      const half = 0.46;
      for (let i = 0; i < 2; i++) {
        const d = b.r + 18 + i * 13 + 6 * prog;
        const x = b.x + Math.cos(base) * d;
        const y = b.y + Math.sin(base) * d;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(base - half) * 9, y + Math.sin(base - half) * 9);
        ctx.lineTo(x + Math.cos(base) * -3, y + Math.sin(base) * -3);
        ctx.lineTo(x + Math.cos(base + half) * 9, y + Math.sin(base + half) * 9);
        ctx.strokeStyle = `rgba(${GRAB},${0.40 + 0.50 * prog})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }

    // 举架信号：正面半圈钢灰色厚弧，两端封口，中间两道竖纹。
    // 形状是「盾」不是「环」：不告诉你躲，告诉你别从正面打。
    function drawGuardTell(b, step) {
      const guard = step.guard;
      const base = Math.atan2(b.dir.y, b.dir.x);
      const half = guard.arc * Math.PI / 360;
      const r = b.r + 16;
      const pulse = 0.55 + 0.20 * Math.sin(b.t * 0.18);

      ctx.beginPath();
      ctx.arc(b.x, b.y, r, base - half, base + half);
      ctx.strokeStyle = `rgba(${GUARD},${pulse})`;
      ctx.lineWidth = 6;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 6, base - half, base + half);
      ctx.strokeStyle = `rgba(${GUARD},${pulse * 0.35})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      for (const s of [-1, 1]) {
        const a = base + s * half;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * b.r * 0.6, b.y + Math.sin(a) * b.r * 0.6);
        ctx.lineTo(b.x + Math.cos(a) * (r + 10), b.y + Math.sin(a) * (r + 10));
        ctx.strokeStyle = `rgba(${GUARD},${pulse * 0.9})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    // 预告在出招瞬间就已锁定：形状与方向都不再变化。
    // 前 10 tick 叠一圈白色扩散环和亮边，作为「锁定」的瞬时提示。
    function drawBossTelegraph(w, b) {
      b = b || w.boss;
      const mv = b.move;
      if (!mv) return;

      const step = mv.def.steps[mv.step];
      // 火线的红线：前摇里先亮出来，立起来之后判定与画法都交给 drawWalls。
      if (mv.wall) {
        const prog = mv.phase === 'windup'
          ? Math.min(1, mv.t / (step.windup || 1))
          : 1;
        const wall = mv.wall;
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.strokeStyle = `rgba(255,70,40,${0.10 + 0.18 * prog})`;
        ctx.lineWidth = wall.width;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.setLineDash([14, 10]);
        ctx.strokeStyle = `rgba(255,120,80,${0.45 + 0.50 * prog})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.setLineDash([]);

        for (const [ex, ey] of [[wall.x1, wall.y1], [wall.x2, wall.y2]]) {
          ctx.beginPath();
          ctx.arc(ex, ey, 8, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,150,110,${0.35 + 0.45 * prog})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      // 举架不造成伤害，画一片「会挨打的范围」只会骗人；信息全交给钢灰半弧。
      if (step.guard) return;
      const tier = TIER[step.tier || mv.def.tier] || TIER['快'];
      const capsule = step.capsule;
      const capsuleTravel = capsule && capsule.travel;
      const lane = step.lane;
      const ring = step.ring;
      const drop = step.drop;
      const cx = (lane || capsuleTravel || ring) ? mv.ox : b.x;
      const cy = (lane || capsuleTravel || ring) ? mv.oy : b.y;
      // 沿路径推进的胶囊与旧直道，画出来的亮区都跟着身体走，看到多大就吃多大。
      const reach = lane
        ? (mv.phase === 'active' ? (mv.front || lane.range) : lane.range)
        : capsuleTravel
          ? (mv.phase === 'active' ? (mv.front || step.range) : step.range)
          : step.range;
      // 环形把自己的整圈角度放在 ring.angle 上；只读 step.angle 会让半角变成 NaN，整块预告画不出来。
      const arc = lane ? lane.angle : (ring ? ring.angle : step.angle);
      const half = arc ? arc * Math.PI / 360 : 0;
      // 灰门的弧心与 Boss 朝向无关：aim 就是弧的中点，背面是缺口。
      const base = ring && ring.aim != null ? ring.aim : Math.atan2(b.dir.y, b.dir.x);
      const a0 = base - half;
      const a1 = base + half;

      if (mv.phase === 'windup') {
        const prog = Math.min(1, mv.t / step.windup);

        if (ring) {
          // 推进环的预告只铺很薄的底：整块铺满会被读成「这片都要烧」，
          // 真正的信息交给同心虚线和箭头。
          const windFill = ring.speed ? 0.03 + 0.06 * prog : 0.05 + 0.15 * prog;
          annulus(cx, cy, ring.inner, ring.outer, a0, a1,
            `rgba(${tier.fill},${windFill})`,
            `rgba(${tier.line},${0.36 + 0.46 * prog})`, 2);

          // 内圈是安全区：铺一层冷色底，再用翻滚同色虚线勾边，避免整块红被读成必躲。
          if (ring.inner > 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, ring.inner, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(120,190,255,${0.03 + 0.03 * prog})`;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx, cy, ring.inner - 3, 0, Math.PI * 2);
            ctx.setLineDash([6, 8]);
            ctx.strokeStyle = `rgba(150,220,255,${0.28 + 0.42 * prog})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
          }

          if (ring.speed) {
            // 推进环：预告画成一层一层的同心虚线，加方向箭头。
            // 读法 = 「一圈一圈往那边推」，不是整块同时烧。
            for (let i = 1; i <= 3; i++) {
              const rr = ring.inner + (ring.outer - ring.inner) * (i / 4);
              ctx.beginPath();
              ctx.arc(cx, cy, rr, a0, a1);
              ctx.setLineDash([10, 12]);
              ctx.strokeStyle = `rgba(${tier.line},${(0.10 + 0.24 * prog) * (1 - (i - 1) * 0.16)})`;
              ctx.lineWidth = 2;
              ctx.stroke();
              ctx.setLineDash([]);
            }

            const mid = (ring.inner + ring.outer) / 2;
            const size = 9 + 5 * prog;
            const inward = !!ring.inward;
            const arrows = ring.aim != null
              ? [0, 1, 2, 3, 4, 5].map((k) => a0 + 0.10 + (a1 - a0 - 0.20) * (k / 5))
              : [0, 1, 2, 3].map((k) => Math.PI / 4 + k * Math.PI / 2);
            for (const a of arrows) {
              const x = cx + Math.cos(a) * mid;
              const y = cy + Math.sin(a) * mid;
              const ang = inward ? a + Math.PI : a;
              const tipX = x + Math.cos(ang) * size;
              const tipY = y + Math.sin(ang) * size;
              ctx.beginPath();
              ctx.moveTo(tipX, tipY);
              ctx.lineTo(tipX - Math.cos(ang - 0.55) * size, tipY - Math.sin(ang - 0.55) * size);
              ctx.moveTo(tipX, tipY);
              ctx.lineTo(tipX - Math.cos(ang + 0.55) * size, tipY - Math.sin(ang + 0.55) * size);
              ctx.strokeStyle = `rgba(255,255,255,${0.18 + 0.45 * prog})`;
              ctx.lineWidth = 2.5;
              ctx.stroke();
            }
          } else {
            // 沿环中线转一圈的指针：落圈时机看它，不看透明度。
            const mid = ring.inner > 0 ? (ring.inner + ring.outer) / 2 : ring.outer * 0.6;
            ctx.beginPath();
            ctx.arc(cx, cy, mid, a0, a0 + 2 * half * prog, false);
            ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.55 * prog})`;
            ctx.lineWidth = 3;
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.arc(cx, cy, ring.outer, a0, a1);
          ctx.strokeStyle = `rgba(${tier.line},${0.50 + 0.40 * prog})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // 缺口：冷色虚线勾出两条边与外侧的开口，别让满地的红把门盖住。
          if (ring.aim != null) {
            ctx.setLineDash([8, 10]);
            ctx.strokeStyle = `rgba(150,220,255,${0.35 + 0.45 * prog})`;
            ctx.lineWidth = 2;
            for (const a of [a0, a1]) {
              ctx.beginPath();
              ctx.moveTo(cx, cy);
              ctx.lineTo(cx + Math.cos(a) * ring.outer, cy + Math.sin(a) * ring.outer);
              ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(cx, cy, ring.outer + 6, a1, a0 + Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          if (mv.t < 10) {
            const k = 1 - mv.t / 10;
            annulus(cx, cy, ring.inner, ring.outer, a0, a1,
              null, `rgba(255,255,255,${0.85 * k})`, 2 + 4 * k);
          }
          return;
        }

        if (drop) {
          // 落点在出招瞬间快照：前摇里三个圈不动，走出去就是答案。
          for (const pt of mv.drop || []) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, drop.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${tier.fill},${0.04 + 0.14 * prog})`;
            ctx.fill();
            ctx.setLineDash([5, 6]);
            ctx.strokeStyle = `rgba(${tier.line},${0.28 + 0.46 * prog})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.arc(pt.x, pt.y, drop.r * (1 - 0.72 * prog), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,255,255,${0.16 + 0.40 * prog})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          return;
        }

        if (capsule) {
          const hw = capsule.width / 2;
          const lx = Math.cos(base);
          const ly = Math.sin(base);
          capsulePath(cx, cy, lx, ly, reach, hw);
          ctx.fillStyle = `rgba(${tier.fill},${0.06 + 0.16 * prog})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${tier.line},${0.40 + 0.44 * prog})`;
          ctx.lineWidth = 2;
          ctx.stroke();

          // 中线与三道横撑：读出「这条带到哪停」。
          ctx.beginPath();
          ctx.moveTo(cx + lx * b.r, cy + ly * b.r);
          ctx.lineTo(cx + lx * reach, cy + ly * reach);
          ctx.setLineDash([10, 8]);
          ctx.strokeStyle = `rgba(${tier.line},${0.32 + 0.30 * prog})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);

          for (const f of [0.35, 0.7, 1]) {
            const mx = cx + lx * reach * f;
            const my = cy + ly * reach * f;
            ctx.beginPath();
            ctx.moveTo(mx - ly * hw, my + lx * hw);
            ctx.lineTo(mx + ly * hw, my - lx * hw);
            ctx.strokeStyle = `rgba(${tier.line},${0.22 + 0.40 * prog})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          // 末端圆头压一道亮边：圆滑的边界就是判定边界。
          ctx.beginPath();
          ctx.arc(cx + lx * reach, cy + ly * reach, hw,
            base - Math.PI / 2, base + Math.PI / 2);
          ctx.strokeStyle = `rgba(255,255,255,${0.16 + 0.34 * prog})`;
          ctx.lineWidth = 2;
          ctx.stroke();

          if (step.parryable) {
            const ex = cx + lx * reach;
            const ey = cy + ly * reach;
            ctx.beginPath();
            ctx.moveTo(ex - ly * hw, ey + lx * hw);
            ctx.lineTo(ex + ly * hw, ey - lx * hw);
            ctx.strokeStyle = `rgba(${PARRY},${0.40 + 0.44 * prog})`;
            ctx.lineWidth = 3;
            ctx.stroke();
          }

          if (capsuleTravel && step.lunge) {
            // 身体会冲到哪：终点画 Boss 半径的虚线圈，沿路标三段刻度。
            const endX = Math.max(b.r, Math.min(VIEW.w - b.r, cx + lx * step.lunge));
            const endY = Math.max(b.r, Math.min(VIEW.h - b.r, cy + ly * step.lunge));

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = `rgba(255,255,255,${0.10 + 0.22 * prog})`;
            ctx.lineWidth = 2;
            ctx.stroke();

            for (let i = 1; i <= 3; i++) {
              const tx = cx + (endX - cx) * (i / 4);
              const ty = cy + (endY - cy) * (i / 4);
              const tw = 5 + 4 * prog;
              ctx.beginPath();
              ctx.moveTo(tx + ly * tw, ty - lx * tw);
              ctx.lineTo(tx - ly * tw, ty + lx * tw);
              ctx.strokeStyle = `rgba(255,255,255,${0.14 + 0.34 * prog})`;
              ctx.lineWidth = 2;
              ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(endX, endY, b.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${0.03 + 0.04 * prog})`;
            ctx.fill();
            ctx.setLineDash([7, 8]);
            ctx.strokeStyle = `rgba(255,255,255,${0.20 + 0.45 * prog})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.setLineDash([]);
          }

          if (mv.t < 10) {
            const k = 1 - mv.t / 10;
            capsulePath(cx, cy, lx, ly, reach, hw);
            ctx.strokeStyle = `rgba(255,255,255,${0.85 * k})`;
            ctx.lineWidth = 2 + 4 * k;
            ctx.stroke();
          }
          return;
        }

        // 会往前滑的招（推撞）：判定是「身体滑到哪，扇形就跟到哪」，只画起手一片扇形，
        // 站在 120–240 之间会以为安全，直到身体滑过来才吃到。这里把起手扇形与终点扇形
        // 之间的整条走廊一次填满。外接轮廓比逐帧实际扫过的形状略宽，宁可多报。
        // 40px 以内的小步冲刺不画走廊：窄角下那条走廊就是两根几乎平行的长线，更难读，
        // 直接把扇形长度补上位移量。
        const sweeping = !lane && step.lunge > 40;
        const smallLunge = !lane && step.lunge > 0 && step.lunge <= 40;
        const tip = reach + (smallLunge ? step.lunge : 0);
        let endX = cx;
        let endY = cy;
        if (sweeping) {
          const lx = Math.cos(base);
          const ly = Math.sin(base);
          endX = Math.max(b.r, Math.min(VIEW.w - b.r, cx + lx * step.lunge));
          endY = Math.max(b.r, Math.min(VIEW.h - b.r, cy + ly * step.lunge));

          const ex = Math.cos(base + half) * reach;
          const ey = Math.sin(base + half) * reach;
          const sx = Math.cos(base - half) * reach;
          const sy = Math.sin(base - half) * reach;
          ctx.beginPath();
          ctx.arc(cx, cy, reach, base - half, base + half);
          ctx.lineTo(endX + ex, endY + ey);
          ctx.arc(endX, endY, reach, base + half, base - half, true);
          ctx.closePath();
          ctx.fillStyle = `rgba(${tier.fill},${0.07 + 0.15 * prog})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${tier.line},${0.26 + 0.30 * prog})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          pie(cx, cy, tip, base - half, base + half,
            `rgba(${tier.fill},${0.06 + 0.16 * prog})`,
            `rgba(${tier.line},${0.40 + 0.44 * prog})`, 2);

          // 窄扇形（刺击 14–16°）在暗底上只剩一根细线，远看读不出「到哪停」。
          // 补一条中线与三道横撑，宽度按该处的实际张角算，与判定边对齐。
          if (half < 0.35) {
            const lx = Math.cos(base);
            const ly = Math.sin(base);
            ctx.beginPath();
            ctx.moveTo(cx + lx * b.r, cy + ly * b.r);
            ctx.lineTo(cx + lx * tip, cy + ly * tip);
            ctx.setLineDash([10, 8]);
            ctx.strokeStyle = `rgba(${tier.line},${0.32 + 0.30 * prog})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);

            for (const f of [0.45, 0.72, 1]) {
              const mx = cx + lx * tip * f;
              const my = cy + ly * tip * f;
              const k = Math.tan(half) * tip * f;
              ctx.beginPath();
              ctx.moveTo(mx - ly * k, my + lx * k);
              ctx.lineTo(mx + ly * k, my - lx * k);
              ctx.strokeStyle = `rgba(${tier.line},${0.22 + 0.40 * prog})`;
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
          }
        }

        if (step.parryable) {
          // 可弹扇形：外沿压一条青白弧，与身上的青环同色，把「这段能弹」标到范围上。
          ctx.beginPath();
          ctx.arc(cx, cy, tip + 3, base - half, base + half);
          ctx.strokeStyle = `rgba(${PARRY},${0.34 + 0.46 * prog})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        if (lane) {
          ctx.setLineDash([7, 9]);
          pie(cx, cy, reach, base - half, base + half,
            null, `rgba(${tier.line},${0.26 + 0.34 * prog})`, 1);
          ctx.setLineDash([]);

          if (step.lunge) {
            // 身体会沿直道冲到哪：终点画一个 Boss 半径的虚线圈，中心线标三段刻度。
            // 只画「这条道会被扫」读不出位移，玩家会以为自己站在道尽头就没事。
            const lx = Math.cos(base);
            const ly = Math.sin(base);
            const endX = Math.max(b.r, Math.min(VIEW.w - b.r, cx + lx * step.lunge));
            const endY = Math.max(b.r, Math.min(VIEW.h - b.r, cy + ly * step.lunge));

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = `rgba(255,255,255,${0.10 + 0.22 * prog})`;
            ctx.lineWidth = 2;
            ctx.stroke();

            for (let i = 1; i <= 3; i++) {
              const tx = cx + (endX - cx) * (i / 4);
              const ty = cy + (endY - cy) * (i / 4);
              const tw = 5 + 4 * prog;
              ctx.beginPath();
              ctx.moveTo(tx + ly * tw, ty - lx * tw);
              ctx.lineTo(tx - ly * tw, ty + lx * tw);
              ctx.strokeStyle = `rgba(255,255,255,${0.14 + 0.34 * prog})`;
              ctx.lineWidth = 2;
              ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(endX, endY, b.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${0.03 + 0.04 * prog})`;
            ctx.fill();
            ctx.setLineDash([7, 8]);
            ctx.strokeStyle = `rgba(255,255,255,${0.20 + 0.45 * prog})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.setLineDash([]);
          }

          const tipX = cx + Math.cos(base) * reach;
          const tipY = cy + Math.sin(base) * reach;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - Math.cos(base - 0.16) * 22, tipY - Math.sin(base - 0.16) * 22);
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - Math.cos(base + 0.16) * 22, tipY - Math.sin(base + 0.16) * 22);
          ctx.strokeStyle = `rgba(${tier.line},${0.30 + 0.50 * prog})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // 会往前滑的招（推撞）：终点弧与终点身位。
        if (sweeping) {
          // 只加重勾终点那段弧：身体滑到那里，这片才扫完。
          // 可弹的推撞用青白虚线，与起手那片青弧对得上。
          ctx.beginPath();
          ctx.arc(endX, endY, reach, base - half, base + half);
          ctx.setLineDash([8, 9]);
          ctx.strokeStyle = step.parryable
            ? `rgba(${PARRY},${0.40 + 0.42 * prog})`
            : `rgba(${tier.line},${0.30 + 0.38 * prog})`;
          ctx.lineWidth = step.parryable ? 3 : 2;
          ctx.stroke();
          ctx.setLineDash([]);

          // 终点身位：填实的剪影，比虚线圈更像「身体会停在这」。
          ctx.beginPath();
          ctx.arc(endX, endY, b.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,170,110,${0.10 + 0.10 * prog})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(255,196,140,${0.34 + 0.40 * prog})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // 两道前移刻度，把视线从起手位置带到终点。
          const lx = Math.cos(base);
          const ly = Math.sin(base);
          for (let i = 1; i <= 2; i++) {
            const tx = cx + (endX - cx) * (i / 3);
            const ty = cy + (endY - cy) * (i / 3);
            const tw = 5 + 3 * prog;
            ctx.beginPath();
            ctx.moveTo(tx + ly * tw, ty - lx * tw);
            ctx.lineTo(tx - ly * tw, ty + lx * tw);
            ctx.strokeStyle = `rgba(255,255,255,${0.16 + 0.30 * prog})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }

        const a = base - half + 2 * half * prog;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
        ctx.strokeStyle = `rgba(${tier.line},${0.35 + 0.55 * prog})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, reach, a - 0.10, a + 0.10);
        ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.5 * prog})`;
        ctx.lineWidth = 3;
        ctx.stroke();

        if ((step.pose || mv.def.pose) === 'slam') {
          const ringR = reach * (0.30 + 0.70 * prog);
          ctx.beginPath();
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${tier.line},${0.16 + 0.46 * prog})`;
          ctx.lineWidth = 2 + 2 * prog;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(cx, cy, ringR - 6, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${tier.fill},${0.08 + 0.22 * prog})`;
          ctx.lineWidth = 6;
          ctx.stroke();
        }

        // 锁定瞬间只闪边缘，不画整圈，避免读成范围伤害。
        if (mv.t < 10) {
          const k = 1 - mv.t / 10;
          pie(cx, cy, reach, base - half, base + half,
            null, `rgba(255,255,255,${0.85 * k})`, 2 + 4 * k);
        }
        return;
      }

      if (mv.phase === 'active') {
        if (ring) {
          if (ring.speed) {
            const rin = mv.inner;
            const rout = mv.outer;
            // 还没扫到的区域铺一层淡红：这是「等一下会烧到这里」，不是已经烧过。
            if (ring.inward) {
              if (rin > 0) {
                annulus(cx, cy, 0, rin, a0, a1,
                  `rgba(${tier.fill},0.07)`, null, 0);
              }
            } else if (rout < ring.outer) {
              annulus(cx, cy, rout, ring.outer, a0, a1,
                `rgba(${tier.fill},0.07)`, null, 0);
            }

            // 推进带本身就是判定：亮起来，前后各有一条边。
            annulus(cx, cy, rin, rout, a0, a1,
              `rgba(${tier.fill},0.30)`,
              `rgba(${tier.line},0.95)`, 3);

            // 前缘再压一条白线，看清它现在推到哪。
            const lead = ring.inward ? rin : rout;
            ctx.beginPath();
            ctx.arc(cx, cy, lead, a0, a1);
            ctx.strokeStyle = 'rgba(255,255,255,0.90)';
            ctx.lineWidth = 3;
            ctx.stroke();

            // 带内两条细线，读成一层叠着一层。
            const thickness = Math.max(1, rout - rin);
            for (const f of [0.35, 0.7]) {
              ctx.beginPath();
              ctx.arc(cx, cy, rin + thickness * f, a0, a1);
              ctx.strokeStyle = 'rgba(255,255,255,0.20)';
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }

            // 缺口的两条边：冷色虚线从圆心拉到外沿，把「门」框出来。
            if (ring.aim != null) {
              ctx.setLineDash([8, 10]);
              ctx.strokeStyle = 'rgba(150,220,255,0.55)';
              ctx.lineWidth = 2;
              for (const a of [a0, a1]) {
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(a) * 0, cy + Math.sin(a) * 0);
                ctx.lineTo(cx + Math.cos(a) * ring.outer, cy + Math.sin(a) * ring.outer);
                ctx.stroke();
              }
              ctx.setLineDash([]);
            }

            if (!ring.inward && ring.inner > 0) {
              ctx.beginPath();
              ctx.arc(cx, cy, ring.inner, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(120,190,255,0.07)';
              ctx.fill();
              ctx.beginPath();
              ctx.arc(cx, cy, ring.inner - 3, 0, Math.PI * 2);
              ctx.setLineDash([6, 8]);
              ctx.strokeStyle = 'rgba(150,220,255,0.85)';
              ctx.lineWidth = 2;
              ctx.stroke();
              ctx.setLineDash([]);
            }
            return;
          }

          annulus(cx, cy, ring.inner, ring.outer, base - half, base + half,
            `rgba(${tier.fill},0.32)`,
            `rgba(${tier.line},0.95)`, 3);
          if (ring.inner > 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, ring.inner, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(120,190,255,0.07)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx, cy, ring.inner - 3, 0, Math.PI * 2);
            ctx.setLineDash([6, 8]);
            ctx.strokeStyle = 'rgba(150,220,255,0.85)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
          }
          return;
        }

        if (drop) {
          for (const pt of mv.drop || []) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, drop.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${tier.fill},0.34)`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${tier.line},0.95)`;
            ctx.lineWidth = 3;
            ctx.stroke();
          }
          return;
        }

        if (capsule) {
          const hw = capsule.width / 2;
          const lx = Math.cos(base);
          const ly = Math.sin(base);
          capsulePath(cx, cy, lx, ly, reach, hw);
          ctx.fillStyle = `rgba(${tier.fill},0.30)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${tier.line},0.95)`;
          ctx.lineWidth = 3;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(cx + lx * reach, cy + ly * reach, hw,
            base - Math.PI / 2, base + Math.PI / 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = 2;
          ctx.stroke();

          // 还没冲完时，用虚线把剩下的路补满，让人看得出判定还在往前推。
          if (capsuleTravel && reach < step.range) {
            ctx.setLineDash([7, 9]);
            capsulePath(cx, cy, lx, ly, step.range, hw);
            ctx.strokeStyle = `rgba(${tier.line},0.30)`;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
          }
          return;
        }

        pie(cx, cy, reach, base - half, base + half,
          `rgba(${tier.fill},0.30)`,
          `rgba(${tier.line},0.95)`, 3);
        ctx.beginPath();
        ctx.arc(cx, cy, reach, base - half, base + half);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 直道还没冲完时，用虚线标出剩下的路程，让人看得出判定还在往前推。
        if (lane && reach < lane.range) {
          ctx.setLineDash([7, 9]);
          pie(cx, cy, lane.range, base - half, base + half,
            null, `rgba(${tier.line},0.30)`, 1);
          ctx.setLineDash([]);
        }
        return;
      }

      if (ring) {
        // 推进环打完就结束，不收尾留残影。
        if (ring.speed) return;
        const p = Math.max(0, 1 - mv.t / mv.def.recovery);
        annulus(cx, cy, ring.inner, ring.outer, base - half, base + half,
          `rgba(${tier.fill},${0.10 * p})`,
          `rgba(${tier.line},${0.32 * p})`, 1.5);
        return;
      }
      if (drop) return;

      const p = Math.max(0, 1 - mv.t / mv.def.recovery);
      if (capsule) {
        const lx = Math.cos(base);
        const ly = Math.sin(base);
        capsulePath(cx, cy, lx, ly, step.range, capsule.width / 2);
        ctx.fillStyle = `rgba(${tier.fill},${0.10 * p})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${tier.line},${0.32 * p})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        return;
      }
      pie(cx, cy, reach, base - half, base + half,
        `rgba(${tier.fill},${0.10 * p})`,
        `rgba(${tier.line},${0.32 * p})`, 1.5);
    }

    function drawBossTrail(fx) {
      if (!fx || !fx.bossTrail) return;
      for (const t of fx.bossTrail) {
        const k = Math.max(0, t.life / t.max);
        ctx.beginPath();
        ctx.arc(t.x, t.y, 26 + 10 * (1 - k), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,120,70,${0.09 * k})`;
        ctx.fill();
      }
    }

    // 地面火池：深红底 + 亮弧倒计时，走进去就按亮弧跳一次伤害。
    // 锁匠的链火是冷色的：同样踩上去掉血，但一眼能分出是谁留的。
    function drawHazards(w) {
      if (!w.hazards || !w.hazards.length) return;
      for (const h of w.hazards) {
        const fade = Math.min(1, h.ttl / 30);
        const grow = h.age < 8 ? h.age / 8 : 1;
        const r = h.r * (0.72 + 0.28 * grow);
        const cold = h.kind === 'chainfire';

        // 炉渣：二阶段留下的场地本身，不灭，也不走倒计时。
        // 画成带裂纹的焦黑壳，中心一点余温，和临时火池的橙色圆盘分开。
        if (h.kind === 'slag') {
          ctx.beginPath();
          for (let i = 0; i < 16; i++) {
            const a = Math.PI * 2 * i / 16;
            const rr = r * (0.84 + 0.10 * Math.sin(i * 2.3 + h.x * 0.013) + 0.05 * Math.cos(i * 1.7 + h.y * 0.011));
            const px = h.x + Math.cos(a) * rr;
            const py = h.y + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          const sg = ctx.createRadialGradient(h.x, h.y, r * 0.1, h.x, h.y, r);
          sg.addColorStop(0, 'rgba(120,54,26,0.92)');
          sg.addColorStop(0.62, 'rgba(48,30,24,0.94)');
          sg.addColorStop(1, 'rgba(26,20,18,0.94)');
          ctx.fillStyle = sg;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,118,52,0.42)';
          ctx.lineWidth = 2;
          ctx.stroke();

          // 裂纹：几条从中心往外裂的折线，走到边上会亮一下。
          ctx.strokeStyle = 'rgba(255,132,58,0.52)';
          ctx.lineWidth = 1.6;
          for (let k = 0; k < 5; k++) {
            const a = Math.PI * 2 * k / 5 + 0.4;
            ctx.beginPath();
            ctx.moveTo(h.x + Math.cos(a) * r * 0.12, h.y + Math.sin(a) * r * 0.12);
            for (let j = 1; j <= 3; j++) {
              const aa = a + 0.22 * Math.sin(j * 2.1 + k);
              const rr = r * (0.12 + 0.26 * j);
              ctx.lineTo(h.x + Math.cos(aa) * rr, h.y + Math.sin(aa) * rr);
            }
            ctx.stroke();
          }

          const phase = (h.age % h.tick) / h.tick;
          ctx.beginPath();
          ctx.arc(h.x, h.y, r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * phase);
          ctx.strokeStyle = `rgba(255,170,90,${0.34 * (1 - phase)})`;
          ctx.lineWidth = 3;
          ctx.stroke();
          continue;
        }

        const g = ctx.createRadialGradient(h.x, h.y, r * 0.12, h.x, h.y, r);
        if (cold) {
          g.addColorStop(0, `rgba(176,150,255,${0.26 * fade})`);
          g.addColorStop(0.66, `rgba(96,72,180,${0.28 * fade})`);
          g.addColorStop(0.94, `rgba(66,50,130,${0.22 * fade})`);
          g.addColorStop(1, `rgba(150,130,255,${0.15 * fade})`);
        } else {
          g.addColorStop(0, `rgba(255,130,58,${0.30 * fade})`);
          g.addColorStop(0.66, `rgba(190,44,20,${0.30 * fade})`);
          g.addColorStop(0.94, `rgba(150,30,12,${0.22 * fade})`);
          g.addColorStop(1, `rgba(255,120,60,${0.16 * fade})`);
        }
        ctx.beginPath();
        ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // 亮边把「这一圈整块都会烧」画实，软过渡只留在内部。
        ctx.beginPath();
        ctx.arc(h.x, h.y, r - 1, 0, Math.PI * 2);
        ctx.strokeStyle = cold
          ? `rgba(176,158,255,${0.55 * fade})`
          : `rgba(255,140,80,${0.55 * fade})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(h.x, h.y, r - 8, 0, Math.PI * 2);
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = cold
          ? `rgba(190,176,255,${0.22 * fade})`
          : `rgba(255,175,110,${0.22 * fade})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        const phase = (h.age % h.tick) / h.tick;
        ctx.beginPath();
        ctx.arc(h.x, h.y, r - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * phase);
        ctx.strokeStyle = cold
          ? `rgba(206,196,255,${0.42 * fade})`
          : `rgba(255,200,120,${0.42 * fade})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // 火线：立起来之后整条都在烧。中心一道白芯，两侧橙边，跳动按 tick 走，
    // 看得出「下一跳什么时候落」，也看得出这条线比火池窄。
    function drawWalls(w) {
      if (!w.walls || !w.walls.length) return;
      for (const wall of w.walls) {
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(wall.age * 0.35));
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.strokeStyle = `rgba(255,120,50,${0.22 * pulse})`;
        ctx.lineWidth = wall.width;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.strokeStyle = `rgba(255,190,110,${0.50 * pulse})`;
        ctx.lineWidth = wall.width * 0.42;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.lineTo(wall.x2, wall.y2);
        ctx.strokeStyle = `rgba(255,248,230,${0.55 * pulse})`;
        ctx.lineWidth = 3;
        ctx.stroke();

        // 两端封口：线的判定就是这两段之间的整条带，端点是硬边界。
        for (const [ex, ey] of [[wall.x1, wall.y1], [wall.x2, wall.y2]]) {
          ctx.beginPath();
          ctx.arc(ex, ey, wall.width * 0.5, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,150,90,${0.30 * pulse})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // 剑气：一道拉长的刃光。可弹的那一发带青白芯，与 Boss 的剑招同色系。
    function drawProjectiles(w) {
      if (!w.projectiles || !w.projectiles.length) return;
      for (const q of w.projectiles) {
        const v = Math.hypot(q.vx, q.vy) || 1;
        const dx = q.vx / v;
        const dy = q.vy / v;
        const tail = 54;
        const g = ctx.createLinearGradient(q.x - dx * tail, q.y - dy * tail, q.x, q.y);
        g.addColorStop(0, 'rgba(255,140,70,0)');
        g.addColorStop(0.7, 'rgba(255,160,90,0.45)');
        g.addColorStop(1, 'rgba(255,230,200,0.9)');
        ctx.beginPath();
        ctx.moveTo(q.x - dx * tail, q.y - dy * tail);
        ctx.lineTo(q.x, q.y);
        ctx.strokeStyle = g;
        ctx.lineWidth = q.r * 1.6;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
        ctx.fillStyle = q.parryable ? 'rgba(210,245,255,0.95)' : 'rgba(255,200,150,0.9)';
        ctx.fill();
        if (q.parryable) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(180,240,255,0.55)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // 场地机关：熔钉与锁链。
    // 活着的钉用锁链连着本体，断掉的只留一截垂在身侧。
    // 三种状态靠亮度与完整度分开：活的完整、塌的焦黑、长回来的裂纹带亮边。
    function drawProps(w) {
      if (!w.props || !w.props.length) return;
      const b = w.boss;
      const conf = b.def.props;
      for (const pr of w.props) {
        const dx = pr.x - b.x;
        const dy = pr.y - b.y;
        const l = Math.hypot(dx, dy) || 1;
        // 甩链被打上的那一条链会亮起来：玩家一眼能看出这一招从哪根钉抽过来。
        const lashing = b.move && b.move.def.chainLash && b.move.chainTarget === pr.id;

        if (pr.state === 'alive') {
          const mx = (b.x + pr.x) / 2 + (dy / l) * 18;
          const my = (b.y + pr.y) / 2 - (dx / l) * 18 + 8;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.quadraticCurveTo(mx, my, pr.x, pr.y);
          ctx.strokeStyle = 'rgba(10,12,16,0.9)';
          ctx.lineWidth = lashing ? 7 : 4;
          ctx.stroke();
          ctx.strokeStyle = lashing ? 'rgba(255,202,120,0.95)' : 'rgba(196,178,128,0.55)';
          ctx.lineWidth = lashing ? 3 : 1.4;
          ctx.stroke();
        } else {
          const sx = b.x + (dx / l) * b.r;
          const sy = b.y + (dy / l) * b.r;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(b.x + (dx / l) * (b.r + 28), b.y + (dy / l) * (b.r + 28) + 10);
          ctx.strokeStyle = 'rgba(96,90,80,0.45)';
          ctx.lineWidth = 3;
          ctx.setLineDash([5, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.ellipse(pr.x, pr.y + pr.r * 0.5, pr.r * 1.15, pr.r * 0.38, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fill();

        if (pr.state === 'alive') {
          // 熔钉：八棱铁柱，顶上一点炉火。血量用外圈弧线画。
          const sides = 8;
          ctx.beginPath();
          for (let i = 0; i < sides; i++) {
            const a = -Math.PI / 2 + i * Math.PI * 2 / sides;
            const x = pr.x + Math.cos(a) * pr.r;
            const y = pr.y + Math.sin(a) * pr.r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fillStyle = '#2a2724';
          ctx.fill();
          ctx.strokeStyle = '#a08a58';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(pr.x, pr.y, pr.r * 0.42, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,138,66,0.75)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,206,140,0.7)';
          ctx.lineWidth = 1;
          ctx.stroke();

          const pct = Math.max(0, pr.hp / pr.maxHp);
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, pr.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
          ctx.strokeStyle = 'rgba(255,178,96,0.8)';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // 焊死的钉：外圈套一道青白焊缝，加粗虚线，看一眼就知道现在打不掉。
          if (pr.weldTicks > 0) {
            const pulse = 0.55 + 0.25 * Math.sin(w.tick * 0.3);
            ctx.beginPath();
            ctx.arc(pr.x, pr.y, pr.r + 3, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(127,212,200,${pulse})`;
            ctx.lineWidth = 4;
            ctx.setLineDash([7, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        } else if (pr.state === 'down') {
          // 塌掉的钉：焦黑残座，圈往回长一格提示还会回来。
          const wait = b.phase === 2 ? conf.respawn2 : conf.respawn;
          const q = Math.min(1, pr.t / wait);
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, pr.r * 0.9, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(24,20,18,0.85)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(120,92,66,0.4)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, pr.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q);
          ctx.strokeStyle = 'rgba(150,120,80,0.28)';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          // 生长中：不可打。亮边从外圈收拢，收满就复位。
          const q = Math.min(1, pr.t / conf.tele);
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, pr.r * (0.35 + 0.65 * q), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(52,42,34,0.9)';
          ctx.fill();
          ctx.strokeStyle = `rgba(255,190,110,${0.35 + 0.5 * q})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, pr.r + 10 - 10 * q, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,210,150,${0.5 * (1 - q)})`;
          ctx.setLineDash([3, 5]);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (pr.flash > 0) {
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, pr.r + 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${0.5 * pr.flash / 8})`;
          ctx.fill();
        }
      }
    }

    // 锁匠的干预：没走到位之前只画一条淡虚线指过去，开始引导才换亮链。
    // 链上亮到哪就是引导到哪，旁边一圈进度弧；目标本身也亮起来，
    // 玩家要读两件事：它在动哪根钉、它在掐哪一次脱甲窗口。
    function drawHelperSupport(w, b) {
      const s = b.support;
      if (!s) return;
      const conf = b.def.support;
      const target = s.kind === 'nail'
        ? w.props.find((x) => x.id === s.id)
        : w.boss;
      if (!target) return;

      const channeling = s.phase === 'channel';
      const ticks = s.kind === 'nail' ? conf.nail.channel : conf.armor.channel;
      const q = channeling ? Math.min(1, s.t / ticks) : 0;
      const accent = s.kind === 'nail' ? '127,212,200' : '198,164,255';
      const tr = target.r || 30;

      const glow = channeling ? 0.34 + 0.30 * Math.sin(w.tick * 0.25) : 0.16;
      ctx.beginPath();
      ctx.arc(target.x, target.y, tr + 12, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${accent},${glow})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 挂链：链子先甩到落点，落点圈收拢就是落地倒计时；位移中链子拉直。
      if (s.phase === 'dashWindup' || s.phase === 'dashTravel') {
        const k = s.phase === 'dashWindup'
          ? Math.min(1, s.t / (conf.dash.windup || 1))
          : 1;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(s.gx, s.gy);
        ctx.strokeStyle = 'rgba(8,12,18,0.85)';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(s.gx, s.gy);
        ctx.strokeStyle = `rgba(${accent},${0.35 + 0.5 * k})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        const rr = 34 - 16 * k;
        ctx.beginPath();
        ctx.arc(s.gx, s.gy, rr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${accent},${0.45 + 0.4 * k})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.gx, s.gy, 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent},0.8)`;
        ctx.fill();
        return;
      }
      if (s.phase === 'dashSettle') {
        // 落地一圈余波：告诉玩家它已经站定，可以砍了。
        const k = 1 - Math.min(1, s.t / (conf.dash.settle || 1));
        ctx.beginPath();
        ctx.arc(s.gx, s.gy, 22 + (1 - k) * 12, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${accent},${0.40 * k})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      const dx = target.x - b.x;
      const dy = target.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      const x1 = b.x + ux * b.r;
      const y1 = b.y + uy * b.r;
      const x2 = target.x - ux * tr;
      const y2 = target.y - uy * tr;

      if (!channeling) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(${accent},0.18)`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 10]);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      // 链身：暗底一层，亮段按进度铺满，剩下的走虚线。
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(8,12,18,0.9)';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + (x2 - x1) * q, y1 + (y2 - y1) * q);
      ctx.strokeStyle = `rgba(${accent},0.95)`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1 + (x2 - x1) * q, y1 + (y2 - y1) * q);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${accent},0.30)`;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q);
      ctx.strokeStyle = `rgba(${accent},0.85)`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    function drawBoss(w, b) {
      b = b || w.boss;
      let k = 1;
      if (b.state === 'dead') k = Math.max(0, 1 - b.deadT / 90);
      if (k <= 0) return;

      const isStoker = b.def.id === 'ash-stoker';
      const royal = b.def.shape === 'king';
      const humanoid = b.def.shape === 'humanoid' || royal;
      const ember = b.phase === 2;
      const hot = isStoker || ember;
      // 三幕各一套外沿色：一幕冷钢、二幕余烬、三幕烧透的暗红。
      const royalRim = b.phase === 1 ? '#c9d8e8' : b.phase === 2 ? '#ffb487' : '#ff8a4c';
      const royalBody = b.phase === 1 ? '#1d2430' : b.phase === 2 ? '#2b1d1e' : '#241618';
      const base = Math.atan2(b.dir.y, b.dir.x);
      const mv = b.state === 'attack' ? b.move : null;
      const step = mv ? mv.def.steps[mv.step] : null;
      const pose = mv ? (step.pose || mv.def.pose) : null;

      // 前摇蓄力到 1，后摇往回收。武器跟着松下来，
      // 玩家一眼就能看出「这一下已经打完了」。
      let prog = 1;
      if (mv) {
        if (mv.phase === 'windup') {
          prog = Math.min(1, mv.t / step.windup);
        } else if (mv.phase === 'recovery') {
          const q = Math.min(1, mv.t / Math.max(1, mv.def.recovery * 0.55));
          prog = 1 - 0.85 * q;
        }
      }

      let core = b.r * 0.56;
      let reach = b.r + 22;
      let weaponW = 7;
      if (pose === 'slam') {
        core = b.r * (0.56 - 0.24 * prog);
        reach = b.r + 14;
        weaponW = 11;
      } else if (pose === 'lunge') {
        core = b.r * 0.46;
        reach = b.r + 36;
        weaponW = 6;
      } else if (pose === 'ring') {
        reach = b.r + 12 + 22 * prog;
        weaponW = 6;
      } else if (pose === 'shove') {
        reach = b.r + 6 + 28 * prog;
        weaponW = 10;
      } else if (pose === 'sow') {
        reach = b.r + 12;
        weaponW = 8;
      } else if (pose === 'swing') {
        reach = b.r + 18 + 14 * prog;
      } else if (pose === 'thrust') {
        reach = b.r + 12 + 34 * prog;
        weaponW = 5;
      } else if (pose === 'spin') {
        // 刀身伸到判定圈内侧（约 100px），让「看起来能砍到」与「实际能砍到」对得上。
        reach = b.r + 14 + 56 * prog;
        weaponW = 5;
      } else if (pose === 'finish') {
        // 终结：刀从侧后甩到正前，比回旋更长，和 240° 的宽扇对齐。
        reach = b.r + 20 + 42 * prog;
        weaponW = 8;
      } else if (pose === 'guard') {
        reach = b.r + 10;
        weaponW = 6;
      } else if (pose === 'grab') {
        reach = b.r + 16 + 16 * prog;
        weaponW = 5;
      }
      if (b.state === 'stagger') {
        core = b.r * 0.48;
        reach = b.r + 6;
        weaponW = 7;
      }

      ctx.save();
      ctx.globalAlpha = k;

      ctx.beginPath();
      ctx.ellipse(b.x, b.y + b.r * 0.78, b.r * 1.10, b.r * 0.30, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.44)';
      ctx.fill();

      // 司炉常驻炉温；二阶段所有 Boss 都翻成余烬色。
      if (hot) {
        const glowR = b.r * (isStoker ? 2.2 : 1.9);
        const g = ctx.createRadialGradient(b.x, b.y, b.r * 0.4, b.x, b.y, glowR);
        g.addColorStop(0, `rgba(255,96,48,${isStoker ? 0.22 : 0.16})`);
        g.addColorStop(1, 'rgba(255,96,48,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      if (b.def.shape === 'idol') {
        // 铸像：俯视是三圈叠起来的巨块，外沿八个棱角，肩环上留着四个链口。
        // 铁甲掀开时棱缝透出橙光，这是唯一的「打它有反应」信号。
        const exposed = b.exposeTicks > 0;
        const seam = exposed ? 'rgba(255,170,96,0.9)' : 'rgba(120,104,82,0.45)';
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(base);

        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          const x = Math.cos(a) * b.r;
          const y = Math.sin(a) * b.r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = hot ? '#2c2019' : '#26221f';
        ctx.fill();
        ctx.strokeStyle = exposed ? '#ffb070' : hot ? '#d08a5e' : '#8b7a5c';
        ctx.lineWidth = 3;
        ctx.stroke();

        // 棱缝：从中心往八个角，脱甲时最亮。
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4 + Math.PI / 8;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * b.r * 0.30, Math.sin(a) * b.r * 0.30);
          ctx.lineTo(Math.cos(a) * b.r * 0.92, Math.sin(a) * b.r * 0.92);
          ctx.strokeStyle = seam;
          ctx.lineWidth = exposed ? 2 : 1;
          ctx.stroke();
        }

        // 肩环：比外沿小一圈，把「这是一整块铸出来的」画实。
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 0.66, 0, Math.PI * 2);
        ctx.strokeStyle = exposed ? 'rgba(255,196,128,0.8)' : 'rgba(150,132,100,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      } else if (b.def.shape === 'locksmith') {
        // 锁匠：小一号的六棱剪影，腰间一圈断续的链环。
        // 愤怒之后轮廓翻成余烬色，和铸像同一条语言。
        const body = ember ? '#2c2028' : '#221e26';
        const rim = b.rage ? '#ffb08a' : '#7fd4c8';
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(base);
        ctx.beginPath();
        ctx.moveTo(b.r, 0);
        ctx.lineTo(b.r * 0.22, b.r * 0.92);
        ctx.lineTo(-b.r * 0.86, b.r * 0.62);
        ctx.lineTo(-b.r * 0.60, 0);
        ctx.lineTo(-b.r * 0.86, -b.r * 0.62);
        ctx.lineTo(b.r * 0.22, -b.r * 0.92);
        ctx.closePath();
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = rim;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 0.60, 0, Math.PI * 2);
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = b.flash > 0 ? '#f2fffc' : 'rgba(127,212,200,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else if (royal) {
        // 灰烬之王：窄肩长身、身后一片展开的披风、头上一顶断齿王冠。
        // 三幕靠外沿色分辨；披风在前摇里张开，出招的方向感先由它给出。
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(base);

        ctx.beginPath();
        ctx.moveTo(-b.r * 0.22, -b.r * 0.50);
        ctx.lineTo(-b.r * (1.10 + 0.26 * prog), -b.r * (0.80 + 0.18 * prog));
        ctx.lineTo(-b.r * (1.34 + 0.30 * prog), 0);
        ctx.lineTo(-b.r * (1.10 + 0.26 * prog), b.r * (0.80 + 0.18 * prog));
        ctx.lineTo(-b.r * 0.22, b.r * 0.50);
        ctx.closePath();
        ctx.fillStyle = b.phase === 3 ? 'rgba(58,22,16,0.90)' : 'rgba(22,26,36,0.90)';
        ctx.fill();
        ctx.strokeStyle = `rgba(150,170,196,${0.22 + 0.10 * prog})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(0, 0, b.r * 1.12, b.r * 0.44, 0, 0, Math.PI * 2);
        ctx.fillStyle = royalBody;
        ctx.fill();
        ctx.strokeStyle = royalRim;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // 肩甲：比人形更窄更硬，两片平直的板。
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(0, s * b.r * 0.50, b.r * 0.26, b.r * 0.16, s * 0.25, 0, Math.PI * 2);
          ctx.fillStyle = b.phase === 3 ? '#3a2018' : '#232c3a';
          ctx.fill();
          ctx.strokeStyle = `rgba(201,216,232,${0.55 + 0.20 * prog})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(b.r * 0.72, 0, b.r * 0.26, 0, Math.PI * 2);
        ctx.fillStyle = b.phase === 3 ? '#4a2418' : '#2b3444';
        ctx.fill();
        ctx.strokeStyle = royalRim;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 断齿王冠：五根长短不一的尖，读成「王」的身份标记。
        const crown = [
          [-0.10, 0.26], [-0.02, 0.10], [0.06, 0.28], [0.14, 0.12], [0.20, 0.24]
        ];
        ctx.beginPath();
        ctx.moveTo(b.r * (0.72 + crown[0][0]), crown[0][1] * b.r);
        for (const [dx, dy] of crown) ctx.lineTo(b.r * (0.72 + dx), dy * b.r);
        ctx.strokeStyle = royalRim;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      } else if (humanoid) {
        // 人形：俯视是窄肩长身的剪影，和两个圆形大块明显不同。
        // 身体沿朝向拉长，肩甲横在两侧，头在前端。
        const body = hot ? '#2b1f24' : '#241c28';
        const rim = hot ? '#ffb08a' : '#b9a6ff';
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(base);
        ctx.beginPath();
        ctx.ellipse(0, 0, b.r * 1.02, b.r * 0.56, 0, 0, Math.PI * 2);
        ctx.fillStyle = body;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = rim;
        ctx.stroke();

        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(0, s * b.r * 0.60, b.r * 0.30, b.r * 0.22, s * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = hot ? '#3a2622' : '#2c2233';
          ctx.fill();
          ctx.strokeStyle = hot ? 'rgba(255,176,138,0.75)' : 'rgba(185,166,255,0.65)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(b.r * 0.62, 0, b.r * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = hot ? '#4a2a20' : '#332741';
        ctx.fill();
        ctx.strokeStyle = ember ? 'rgba(255,190,140,0.85)' : 'rgba(205,188,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = isStoker ? '#2a1b18' : '#241a1e';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = hot ? '#ff9a6a' : '#9d6152';
        ctx.stroke();

        for (const s of [-1, 1]) {
          const a = base + s * 1.75;
          ctx.beginPath();
          ctx.moveTo(b.x + Math.cos(a) * b.r * 0.52, b.y + Math.sin(a) * b.r * 0.52);
          ctx.lineTo(b.x + Math.cos(a) * b.r * 1.14, b.y + Math.sin(a) * b.r * 1.14);
          ctx.strokeStyle = 'rgba(8,12,18,0.9)';
          ctx.lineWidth = 9;
          ctx.stroke();
          ctx.strokeStyle = ember ? '#b06a52' : isStoker ? '#8a5744' : '#6f4438';
          ctx.lineWidth = 5;
          ctx.stroke();
        }
      }

      // 炉膛 / 胸口：非人形 Boss 的炉温，人形只留一点胸口的亮。
      ctx.beginPath();
      ctx.arc(b.x, b.y, humanoid ? core * 0.30 : b.def.shape === 'idol' ? core * 0.55 : core, 0, Math.PI * 2);
      ctx.fillStyle = b.def.shape === 'locksmith'
        ? (ember ? 'rgba(255,150,110,0.55)' : 'rgba(127,212,200,0.42)')
        : isStoker
          ? (ember ? 'rgba(255,120,50,0.55)' : 'rgba(220,96,40,0.34)')
          : royal
            ? (b.phase === 3 ? 'rgba(255,96,52,0.62)' : 'rgba(220,232,246,0.40)')
            : humanoid
              ? (ember ? 'rgba(255,150,110,0.55)' : 'rgba(196,170,255,0.35)')
              : (ember ? 'rgba(190,64,36,0.42)' : 'rgba(140,70,54,0.30)');
      ctx.fill();
      ctx.strokeStyle = isStoker
        ? (ember ? 'rgba(255,190,130,0.75)' : 'rgba(255,150,90,0.50)')
        : (ember ? 'rgba(255,150,110,0.55)' : 'rgba(200,120,100,0.30)');
      ctx.lineWidth = 1;
      ctx.stroke();

      if (isStoker && !humanoid) {
        const spin = w.tick * 0.02;
        for (let i = 0; i < 6; i++) {
          const a = spin + i * Math.PI / 3;
          const rr = core * 0.55;
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = ember ? 'rgba(255,220,160,0.95)' : 'rgba(255,170,100,0.75)';
          ctx.fill();
        }
      }

      // 脱甲倒计时：身体外一圈橙弧，长度就是剩余窗口；熄灭时能看见它收紧。
      if (b.def.props && b.exposeTicks > 0) {
        const q = b.exposeTicks / b.def.props.expose;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 14, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,176,96,0.16)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q);
        ctx.strokeStyle = 'rgba(255,176,96,0.85)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // 铸像的「武器」是两条整块石臂，画得比人形刀更粗。王的剑更长更宽。
      if (b.def.shape === 'idol') weaponW = Math.max(weaponW, 14);
      if (royal) {
        weaponW = Math.max(weaponW, 9);
        reach += 10;
      }
      const weapon = b.def.shape === 'idol'
        ? (hot ? '#d8a477' : '#bfae8a')
        : royal
          ? (b.phase === 3 ? '#ff9a5c' : hot ? '#ffc09a' : '#dfe8f2')
          : hot ? '#ffc09a' : '#d9c3b8';
      if (b.state === 'stagger' || b.state === 'executing') {
        // 跪地：刀拖到地上。金色虚线圈表示「现在可以处决」，
        // 铸像这类不进处决的硬直不画，只留脱甲橙弧和垂下的手臂。
        limb(b.x, b.y, base + 1.35, reach, weaponW, 'rgba(8,12,18,0.92)', '#a99a92');
        if (b.state === 'executing' || !b.executed) {
          const pulse = 0.5 + 0.5 * Math.sin(w.tick * 0.12);
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 9 + pulse * 3, 0, Math.PI * 2);
          ctx.setLineDash([4, 7]);
          ctx.strokeStyle = `rgba(255,230,150,${0.38 + 0.35 * pulse})`;
          ctx.lineWidth = 2 + pulse;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (pose === 'thrust') {
        // 刺击：前摇把刀收到身后，判定前一刻压到正前方。
        const hold = 1.55 - 1.55 * prog;
        limb(b.x, b.y, base + hold, reach, weaponW, 'rgba(8,12,18,0.92)', weapon);
        ctx.beginPath();
        ctx.arc(b.x + Math.cos(base) * (b.r + 30 * prog), b.y + Math.sin(base) * (b.r + 30 * prog), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,240,210,${0.30 + 0.55 * prog})`;
        ctx.fill();
      } else if (pose === 'spin') {
        // 回旋斩：两把反手刀对着转，判定是整圈，画满不怕读错。
        for (const s of [-1, 1]) {
          const a = base + s * (0.30 + 1.10 * prog);
          limb(b.x, b.y, a, reach, weaponW, 'rgba(8,12,18,0.92)', weapon);
        }
      } else if (pose === 'guard') {
        // 举架：刀横在身前，刀尖朝外。
        const nx = Math.cos(base + Math.PI / 2);
        const ny = Math.sin(base + Math.PI / 2);
        const hold = b.r * 0.95;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(base) * hold + nx * b.r * 0.85,
                   b.y + Math.sin(base) * hold + ny * b.r * 0.85);
        ctx.lineTo(b.x + Math.cos(base) * hold - nx * b.r * 0.85,
                   b.y + Math.sin(base) * hold - ny * b.r * 0.85);
        ctx.strokeStyle = 'rgba(8,12,18,0.92)';
        ctx.lineWidth = 9;
        ctx.stroke();
        ctx.strokeStyle = weapon;
        ctx.lineWidth = 4.5;
        ctx.stroke();
      } else if (pose === 'grab') {
        // 擒拿：两只手往前伸，掌心朝内。
        for (const s of [-1, 1]) {
          const a = base + s * 0.26;
          limb(b.x, b.y, a, reach, weaponW, 'rgba(8,12,18,0.92)', '#d6b8ff');
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(a) * reach, b.y + Math.sin(a) * reach, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(214,184,255,${0.45 + 0.45 * prog})`;
          ctx.fill();
        }
      } else if (pose === 'finish') {
        // 终结：刀从侧后甩到正前。后摇里 prog 落回去，刀就拖到身侧了。
        const a = base + (1.9 - 1.9 * prog);
        limb(b.x, b.y, a, reach + 16, weaponW, 'rgba(8,12,18,0.92)', '#ffe0a8');
        const tx = b.x + Math.cos(a) * (reach + 16);
        const ty = b.y + Math.sin(a) * (reach + 16);
        ctx.beginPath();
        ctx.arc(tx, ty, 4 + 5 * prog, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,232,170,${0.35 + 0.55 * prog})`;
        ctx.fill();
      } else if (pose === 'ring') {
        for (const s of [-1, 1]) {
          const a = base + s * 0.95;
          limb(b.x, b.y, a, reach, weaponW, 'rgba(8,12,18,0.92)', weapon);
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(a) * reach, b.y + Math.sin(a) * reach, 4 + 4 * prog, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,140,70,${0.35 + 0.5 * prog})`;
          ctx.fill();
        }
      } else if (pose === 'sow') {
        const a = base + 0.55;
        limb(b.x, b.y, a, reach, weaponW, 'rgba(8,12,18,0.92)', weapon);
        ctx.beginPath();
        ctx.arc(b.x + Math.cos(a) * reach, b.y + Math.sin(a) * reach, 5 + 5 * prog, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,150,70,${0.30 + 0.5 * prog})`;
        ctx.fill();
      } else if (pose === 'shove') {
        limb(b.x, b.y, base, reach, weaponW, 'rgba(8,12,18,0.92)', weapon);
        ctx.beginPath();
        ctx.arc(b.x + Math.cos(base) * reach, b.y + Math.sin(base) * reach, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,200,140,0.65)';
        ctx.fill();
      } else if (b.def.shape === 'idol') {
        // 待机：两条石臂垂在侧后，蓄势时略往前收。
        for (const s of [-1, 1]) {
          limb(b.x, b.y, base + s * (1.62 - 0.22 * prog), reach, weaponW,
            'rgba(8,12,18,0.92)', weapon);
        }
      } else if (humanoid) {
        // 待机：刀垂在侧后，蓄势时抬起来。
        limb(b.x, b.y, base + 0.62 - 0.20 * prog, b.r + 12, 5, 'rgba(8,12,18,0.92)', weapon);
      } else {
        limb(b.x, b.y, base, reach, weaponW, 'rgba(8,12,18,0.92)', weapon);
      }

      if (!humanoid && b.def.shape !== 'idol' && pose !== 'ring' && pose !== 'sow' && b.state !== 'stagger') {
        ctx.beginPath();
        ctx.arc(
          b.x + Math.cos(base) * b.r * 0.92,
          b.y + Math.sin(base) * b.r * 0.92,
          4.5, 0, Math.PI * 2
        );
        ctx.fillStyle = ember ? '#ffd2b8' : '#efe4dd';
        ctx.fill();
      }

      if (b.flash > 0) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.55 * b.flash / 10})`;
        ctx.fill();
      }

      // 可弹 / 不可弹 / 举架 / 擒拿的信号画在身体与武器之上。
      // 区分靠形状：平滑青环能弹，锯齿暖环只能躲，锯齿紫环连滚都躲不掉，钢灰半弧是架。
      if (mv && step.guard && mv.phase !== 'recovery' && b.state !== 'stagger') {
        drawGuardTell(b, step);
      } else if (mv && mv.phase === 'windup') {
        if (step.parryable) drawParryTell(b, step, mv);
        else drawDangerTell(b, step, mv);
      }

      // 终结后摇：地上留一圈金色虚线，收完才灭。整段就是输出窗口，
      // 不需要读出结算数字，看见圈还没消失就是可以打。
      if (mv && step && step.finisher && mv.phase === 'recovery') {
        const q = 1 - Math.min(1, mv.t / Math.max(1, mv.def.recovery));
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 26 + 16 * (1 - q), 0, Math.PI * 2);
        ctx.setLineDash([5, 8]);
        ctx.strokeStyle = `rgba(255,222,140,${0.14 + 0.30 * q})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 韧性 / 架势条：贴身一圈细弧，满格才跪。远看血条，近看这一圈决定该压还是该退。
      // 两种条用颜色区分：韧性冷灰蓝、架势暖金，读的是两种不同的资源。
      if (b.def.posture && b.state !== 'dead') {
        const def = b.def.posture;
        const tone = def.tone || [255, 214, 140];
        const cap = def.phaseCaps ? def.phaseCaps[b.phase - 1] : def.max;
        const ratio = Math.max(0, Math.min(1, b.posture / cap));
        if (ratio > 0.001) {
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
          ctx.strokeStyle = `rgba(${tone[0]},${tone[1]},${tone[2]},${0.45 + 0.35 * ratio})`;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      // 出招瞬间身上闪一下，和扇形边缘同时亮，作为方向锁定的提示。
      if (b.state === 'attack' && b.move && b.move.phase === 'windup' && b.move.t < 6) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.30 * (1 - b.move.t / 6)})`;
        ctx.fill();
      }

      if (b.def.helper && b.support) drawHelperSupport(w, b);

      if (b.state === 'phase') {
        const tr = b.def.transitions && b.def.transitions[b.phase];
        const total = tr && tr.ticks != null ? tr.ticks : b.def.phaseTicks;
        const p = Math.min(1, b.t / total);
        const tone = royal
          ? (b.phase === 2 ? '255,168,110' : '255,118,66')
          : '255,118,66';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 12 + i * 30 + p * 80, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${tone},${(1 - p) * 0.55})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    // ---- 玩家 ----

    function drawAim(p, aim, debug) {
      if (!aim) return;
      const dx = aim.x - p.x;
      const dy = aim.y - p.y;
      const l = Math.hypot(dx, dy);
      if (l < 0.001) return;
      const ux = dx / l;
      const uy = dy / l;
      const len = debug ? l : Math.min(l, 170);

      ctx.beginPath();
      ctx.moveTo(p.x + ux * (p.r + 3), p.y + uy * (p.r + 3));
      ctx.lineTo(p.x + ux * len, p.y + uy * len);
      ctx.setLineDash([4, 7]);
      ctx.strokeStyle = 'rgba(150,185,230,0.26)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      if (debug) {
        ctx.beginPath();
        ctx.arc(p.x + ux * len, p.y + uy * len, 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(180,210,240,0.6)';
        ctx.stroke();
      }
    }

    function drawTrail(fx) {
      if (!fx || !fx.trail) return;
      for (const t of fx.trail) {
        const k = Math.max(0, t.life / t.max);
        ctx.beginPath();
        ctx.arc(t.x, t.y, 10 + 6 * (1 - k), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(111,227,255,${0.10 * k})`;
        ctx.fill();
      }
    }

    function drawPlayerAttack(w) {
      const p = w.player;
      if (p.state === 'execute' && p.execute) {
        drawExecution(w);
        return;
      }
      if (p.state !== 'attack' || !p.action) return;

      const a = p.action;
      const c = w.cfg.player[a.kind];
      const half = c.angle * Math.PI / 360;
      const base = Math.atan2(a.dir.y, a.dir.x);

      if (a.phase === 'windup') {
        const prog = a.t / c.windup;
        pie(p.x, p.y, c.range, base - half, base + half,
          `rgba(255,215,120,${0.03 + 0.07 * prog})`,
          `rgba(255,215,120,${0.20 + 0.35 * prog})`, 1.5);

        const ang = base - half + 2 * half * prog;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(ang) * c.range, p.y + Math.sin(ang) * c.range);
        ctx.strokeStyle = `rgba(255,235,180,${0.35 + 0.45 * prog})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      if (a.phase === 'active') {
        pie(p.x, p.y, c.range, base - half, base + half,
          'rgba(255,255,255,0.20)',
          'rgba(255,255,255,0.95)', 2.5);
        ctx.beginPath();
        ctx.arc(p.x, p.y, c.range, base - half, base + half);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }

    // 处决演出：命中前是一道收紧的金色刀光，命中后扩散冲击环与碎光。
    function drawExecution(w) {
      const p = w.player;
      const b = w.boss;
      const e = p.execute;
      const c = w.cfg.player.execution;
      const base = Math.atan2(b.y - p.y, b.x - p.x);

      if (e.t < c.hitTick) {
        const prog = Math.min(1, e.t / c.hitTick);
        const half = 1.15;
        const a0 = base - half;
        const a1 = base - half + 2 * half * prog;
        pie(p.x, p.y, 98, a0, a1,
          'rgba(255,230,150,0.10)',
          `rgba(255,235,180,${0.35 + 0.55 * prog})`, 3);
        return;
      }

      const k = Math.min(1, (e.t - c.hitTick) / 14);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 10 + 52 * k, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,235,170,${0.85 * (1 - k)})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 88, base - 1.2, base + 0.35);
      ctx.strokeStyle = `rgba(255,245,210,${0.9 * (1 - k)})`;
      ctx.lineWidth = 4.5;
      ctx.stroke();
    }

    function playerColor(p) {
      if (p.state === 'dead') return '#5f6875';
      if (p.state === 'hurt') return '#ff7d6e';
      if (p.state === 'dodge') return '#6fe3ff';
      if (p.state === 'parry') return '#bfe9ff';
      if (p.state === 'execute') return '#ffe08a';
      if (p.state === 'heal') return '#f0c078';
      if (p.state === 'attack') {
        if (p.action.phase === 'windup') return '#ffcf6b';
        if (p.action.phase === 'active') return '#ffffff';
        return '#9aa7bd';
      }
      return '#dfe7f3';
    }

    function drawPlayer(w) {
      const p = w.player;
      const color = playerColor(p);
      const invuln = CM.sim.isInvulnerable(w);

      ctx.beginPath();
      ctx.ellipse(p.x, p.y + p.r * 0.85, p.r * 0.95, p.r * 0.32, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.40)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(8,12,18,0.9)';
      ctx.stroke();

      const f = (p.state === 'attack' && p.action) ? p.action.dir : p.facing;
      ctx.beginPath();
      ctx.moveTo(p.x + f.x * (p.r - 2), p.y + f.y * (p.r - 2));
      ctx.lineTo(p.x + f.x * (p.r + 10), p.y + f.y * (p.r + 10));
      ctx.strokeStyle = 'rgba(8,12,18,0.9)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,12,18,0.8)';
      ctx.fill();

      if (invuln) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(111,227,255,0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 11, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(111,227,255,0.22)';
        ctx.lineWidth = 5;
        ctx.stroke();
      }

      if (p.exhaust > 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,205,90,0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (p.state === 'parry' && p.parry) {
        const c = w.cfg.player.parry;
        const t = p.parry.t;
        const active = t >= c.windup && t < c.windup + c.active;
        const a = Math.atan2(p.parry.dir.y, p.parry.dir.x);
        const half = c.angle * Math.PI / 360;
        const r = p.r + 16;

        // 架式：亮弧挡在身前；判定期间填一层薄光。
        if (active) {
          pie(p.x, p.y, r, a - half, a + half, 'rgba(180,235,255,0.22)', null, 0);
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, a - half, a + half);
        ctx.strokeStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(150,215,255,0.60)';
        ctx.lineWidth = active ? 5 : 2.5;
        ctx.stroke();
      }

      if (p.state === 'heal') {
        const c = w.cfg.player.flask;
        const total = c.windup + c.pour;
        const prog = Math.min(1, p.healT / total);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
        ctx.strokeStyle = 'rgba(255,206,120,0.92)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(p.x + p.facing.x * (p.r + 7), p.y + p.facing.y * (p.r + 7), 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,190,100,0.85)';
        ctx.fill();
      }
    }

    function drawTexts(fx) {
      if (!fx || !fx.texts) return;
      ctx.save();
      ctx.textAlign = 'center';
      for (const t of fx.texts) {
        const k = Math.max(0, t.life / t.max);
        ctx.globalAlpha = k;
        ctx.font = `700 ${t.size}px ${FONT}`;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 3;
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.restore();
    }

    function drawVignette() {
      const g = ctx.createRadialGradient(
        VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.35,
        VIEW.w / 2, VIEW.h / 2, VIEW.w * 0.72
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    }

    function drawDebug(w, aim) {
      const p = w.player;
      const b = w.boss;
      const a = p.action;
      const mv = b.move;

      ctx.save();
      ctx.font = `11px ${MONO}`;
      ctx.textAlign = 'left';

      ctx.fillStyle = 'rgba(4,7,11,0.70)';
      ctx.strokeStyle = 'rgba(100,140,190,0.25)';
      ctx.lineWidth = 1;
      ctx.fillRect(16, 112, 352, 252);
      ctx.strokeRect(16, 112, 352, 252);

      const dist = Math.hypot(w.player.x - b.x, w.player.y - b.y);
      const lines = [
        `tick ${w.tick}   hitstop ${w.hitstop}`,
        `p ${p.state}${a ? '  ' + a.kind + ':' + a.phase + ' ' + a.t : ''}`,
        `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}   face ${p.facing.x.toFixed(2)}, ${p.facing.y.toFixed(2)}`,
        `stamina ${p.stamina.toFixed(1)}  delay ${p.staminaDelay}  exhaust ${p.exhaust}`,
        `invuln ${CM.sim.isInvulnerable(w) ? 'YES' : 'no'}  hurt ${p.hurt}  buffer ${p.buffer ? p.buffer.kind + ':' + p.buffer.t : '-'}`,
        `boss ${b.state}  phase ${b.phase}  hp ${b.hp}/${b.maxHp}`,
        `move ${mv ? mv.id + ':' + mv.phase + ' s' + mv.step + ' t' + mv.t : '-'}`,
        `posture ${b.def.posture ? b.posture.toFixed(0) + '/' + b.def.posture.max + ' ' + (b.staggerKind || '-') : '-'}`,
        `cooldown ${b.cooldown}  ai ${b.ai ? 'on' : 'off'}  dist ${dist.toFixed(0)}`,
        `attempts ${w.attempts}  outcome ${w.outcome || '-'}`
      ];
      if (w.helper) {
        const h = w.helper;
        const s = h.support;
        lines.push(
          `helper ${h.state}  hp ${h.hp}/${h.maxHp}  phase ${h.phase}${h.rage ? ' rage' : ''}`,
          `support ${s ? s.kind + ':' + s.phase + ' ' + s.t + '/' + (s.ticks || 0) : '-'}` +
          `  cd ${h.supportCd}  tried ${b.weldTried ? 'Y' : 'n'}  expose ${b.exposeTicks}`
        );
      }
      ctx.fillStyle = '#9fb6d4';
      lines.forEach((ln, i) => ctx.fillText(ln, 24, 132 + i * 15));

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(111,227,255,0.9)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,150,120,0.8)';
      ctx.stroke();

      if (w.helper) {
        ctx.beginPath();
        ctx.arc(w.helper.x, w.helper.y, w.helper.r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(127,212,200,0.85)';
        ctx.stroke();
      }

      if (a) {
        const c = w.cfg.player[a.kind];
        const half = c.angle * Math.PI / 360;
        const base = Math.atan2(a.dir.y, a.dir.x);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, c.range, base - half, base + half);
        ctx.closePath();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (mv) {
        const step = mv.def.steps[mv.step];
        const capsule = step.capsule;
        const capsuleTravel = capsule && capsule.travel;
        const lane = step.lane;
        const ring = step.ring;
        const cx = (lane || capsuleTravel || ring) ? mv.ox : b.x;
        const cy = (lane || capsuleTravel || ring) ? mv.oy : b.y;
        const reach = lane
          ? (mv.phase === 'active' ? (mv.front || lane.range) : lane.range)
          : capsuleTravel
            ? (mv.phase === 'active' ? (mv.front || step.range) : step.range)
            : step.range;
        const arc = lane ? lane.angle : (ring ? ring.angle : step.angle);
        const half = arc ? arc * Math.PI / 360 : 0;
        const base = Math.atan2(b.dir.y, b.dir.x);
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(255,110,90,0.75)';
        if (ring) {
          const rin = mv.phase === 'active' ? mv.inner : ring.inner;
          const rout = mv.phase === 'active' ? mv.outer : ring.outer;
          ctx.beginPath();
          ctx.arc(cx, cy, rout, base - half, base + half);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy, rin, base - half, base + half);
          ctx.stroke();
        } else if (step.drop) {
          for (const pt of mv.drop || []) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, step.drop.r, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (capsule) {
          capsulePath(cx, cy, Math.cos(base), Math.sin(base), reach, capsule.width / 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, reach, base - half, base + half);
          ctx.closePath();
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      for (const h of w.hazards) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(255,160,80,0.55)';
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (aim) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(aim.x, aim.y);
        ctx.setLineDash([2, 6]);
        ctx.strokeStyle = 'rgba(150,185,230,0.35)';
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    function draw(w, fx, debug, aim) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const shake = fx && fx.shake ? fx.shake : 0;
      const sx = shake ? (Math.random() - 0.5) * shake : 0;
      const sy = shake ? (Math.random() - 0.5) * shake : 0;
      const cam = executionCam(w);
      setArenaTransform(sx, sy, cam);

      drawArena();
      drawHazards(w);
      drawWalls(w);
      drawProps(w);
      drawBossTelegraph(w);
      if (w.helper && w.helper.state !== 'dead') drawBossTelegraph(w, w.helper);
      drawBossTrail(fx);
      drawProjectiles(w);
      drawBoss(w);
      if (w.helper) drawBoss(w, w.helper);
      drawAim(w.player, aim, debug);
      drawTrail(fx);
      drawPlayerAttack(w);
      drawPlayer(w);
      drawTexts(fx);
      drawVignette();
      if (debug) drawDebug(w, aim);
    }

    return { resize, screenToWorld, draw, view };
  }

  CM.render = { createRenderer, VIEW };
})(globalThis);
