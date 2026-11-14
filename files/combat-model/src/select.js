/*
 * 选怪与通关记录 · 纯逻辑，不碰 DOM。
 * 卡片只显示名称与分类；记录只在胜利时写入，读档失败退回内存。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./bosses.js'));
  } else {
    (root.CM = root.CM || {}).select = factory(root.CM.bosses);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (bosses) {
  'use strict';

  const KEY = 'combat-model/progress/v1';

  function list() {
    const catOrder = {};
    bosses.categories().forEach((c, i) => {
      catOrder[c.id] = c.order != null ? c.order : i;
    });
    return bosses.list()
      // 随从只随主 Boss 出场，不单列成一张卡：单打它没有意义。
      .filter((b) => !b.helper)
      .map((b) => ({
        id: b.id,
        name: b.name,
        role: b.role,
        order: b.meta && b.meta.order != null ? b.meta.order : 99,
        accent: (b.meta && b.meta.accent) || '#dfe7f3',
        category: (b.meta && b.meta.category) || 'other'
      }))
      .sort((a, b) =>
        (catOrder[a.category] == null ? 99 : catOrder[a.category]) -
        (catOrder[b.category] == null ? 99 : catOrder[b.category]) ||
        a.order - b.order || a.id.localeCompare(b.id));
  }

  // 选关分组：分类来自 Boss 数据的 meta.category，顺序来自 bosses.categories()。
  // 每个条目带一个扁平 index，键盘光标仍然只走一维数组。
  function groups(record) {
    const order = {};
    bosses.categories().forEach((c, i) => { order[c.id] = c.order != null ? c.order : i; });
    const defs = bosses.categories().slice().sort((a, b) =>
      (order[a.id] == null ? 99 : order[a.id]) - (order[b.id] == null ? 99 : order[b.id]));
    const out = defs.map((c) => ({
      id: c.id,
      name: c.name,
      note: c.note || '',
      items: []
    }));
    const byId = {};
    out.forEach((g) => { byId[g.id] = g; });
    const fallback = { id: 'other', name: '其他', note: '', items: [] };

    for (const b of list()) {
      const g = byId[b.category] || fallback;
      g.items.push(Object.assign({}, b, statusOf(record, b.id)));
    }
    if (fallback.items.length) out.push(fallback);

    let i = 0;
    for (const g of out) {
      for (const it of g.items) it.index = i++;
    }
    return out.filter((g) => g.items.length > 0);
  }

  function moveIndex(index, delta, count) {
    if (count <= 0) return 0;
    return ((index + delta) % count + count) % count;
  }

  // 记录合并：只保留更好的用时与尝试次数。
  function recordWin(record, id, sec, tries) {
    const prev = record[id] || {};
    const bestSec = prev.bestSec == null ? sec : Math.min(prev.bestSec, sec);
    const bestTries = prev.bestTries == null ? tries : Math.min(prev.bestTries, tries);
    const next = Object.assign({}, record);
    next[id] = { cleared: true, bestSec, bestTries };
    return next;
  }

  function statusOf(record, id) {
    const r = record && record[id];
    if (!r || !r.cleared) return { cleared: false, text: '未挑战' };
    const sec = r.bestSec;
    const text = sec > 0 ? `已击败 · ${sec.toFixed(1)}s` : '已击败';
    return { cleared: true, text };
  }

  function viewModels(record) {
    return list().map((b) => Object.assign({}, b, statusOf(record, b.id)));
  }
  // storage 可以是任意 getItem/setItem 的对象；不可用时只存在内存里。
  function createStore(storage) {
    let memory = {};
    function read() {
      try {
        const raw = storage && storage.getItem(KEY);
        if (!raw) return memory;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || data.v !== 1) return memory;
        memory = data.bosses || {};
      } catch (err) {
        // 记录是附属功能，读不到就按全未通关处理。
        memory = memory || {};
      }
      return memory;
    }
    function write(record) {
      memory = record;
      try {
        if (storage) storage.setItem(KEY, JSON.stringify({ v: 1, bosses: record }));
      } catch (err) {
        // file:// 下部分浏览器禁用 localStorage，退回内存。
      }
    }
    return { read, write };
  }

  return {
    KEY,
    list,
    groups,
    moveIndex,
    recordWin,
    statusOf,
    viewModels,
    createStore
  };
});
