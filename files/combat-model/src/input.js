/*
 * 键鼠采集。只记录原始状态，坐标换算交给渲染层。
 */
(function (root) {
  'use strict';
  const CM = root.CM || (root.CM = {});

  function create() {
    const keys = new Set();
    const edges = { light: false, heavy: false, dodge: false, parry: false, heal: false };
    const mouse = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };
    const handlers = {
      toggleDebug: null,
      toggleBoss: null,
      reset: null,
      escape: null,
      confirm: null
    };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
      if (e.repeat) return;

      switch (e.code) {
        case 'Space':
          edges.dodge = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          e.preventDefault();
          edges.parry = true;
          break;
        case 'KeyE':
          edges.heal = true;
          break;
        case 'KeyH':
          if (handlers.toggleBoss) handlers.toggleBoss();
          break;
        case 'KeyR':
          if (handlers.reset) handlers.reset();
          break;
        case 'Escape':
          if (handlers.escape) handlers.escape();
          break;
        case 'Enter':
          if (handlers.confirm) handlers.confirm();
          break;
        case 'Backquote':
          if (handlers.toggleDebug) handlers.toggleDebug();
          break;
        default:
          keys.add(e.code);
      }
    });

    window.addEventListener('keyup', (e) => keys.delete(e.code));

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) edges.light = true;
      if (e.button === 2) edges.heavy = true;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    function clearEdges() {
      edges.light = false;
      edges.heavy = false;
      edges.dodge = false;
      edges.parry = false;
      edges.heal = false;
    }

    function clearKeys() {
      keys.clear();
      clearEdges();
    }

    window.addEventListener('blur', clearKeys);

    function snapshot(px, py, aimWorld) {
      const left = keys.has('KeyA') || keys.has('ArrowLeft');
      const right = keys.has('KeyD') || keys.has('ArrowRight');
      const up = keys.has('KeyW') || keys.has('ArrowUp');
      const down = keys.has('KeyS') || keys.has('ArrowDown');

      return {
        moveX: (right ? 1 : 0) - (left ? 1 : 0),
        moveY: (down ? 1 : 0) - (up ? 1 : 0),
        aimX: aimWorld.x - px,
        aimY: aimWorld.y - py,
        light: edges.light,
        heavy: edges.heavy,
        dodge: edges.dodge,
        parry: edges.parry,
        heal: edges.heal
      };
    }

    // 注册器：必须被调用，不能被赋值顶替。导出的对象冻结，写错会直接抛错。
    const register = (name) => (fn) => {
      if (typeof fn !== 'function') throw new TypeError(name + ' 需要回调函数');
      handlers[name] = fn;
    };

    return Object.freeze({
      mouse,
      snapshot,
      clearEdges,
      clearKeys,
      onToggleDebug: register('toggleDebug'),
      onToggleBoss: register('toggleBoss'),
      onReset: register('reset'),
      onEscape: register('escape'),
      onConfirm: register('confirm')
    });
  }

  CM.input = { create };
})(globalThis);
