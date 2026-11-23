// Small counters shared by the routes (no dependencies).

/** Counts `amount` per key in a sliding window; `has` checks without counting. */
export function windowCounter(windowMs, max, now = Date.now) {
  const hits = new Map(); // key -> [{at, n}]
  const recent = (key) => {
    const t = now(), list = (hits.get(key) ?? []).filter((x) => t - x.at < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  const used = (key) => recent(key).reduce((s, x) => s + x.n, 0);
  return {
    used,
    max,
    has: (key, amount = 1) => used(key) + amount <= max,
    add(key, amount = 1) {
      const list = recent(key); list.push({ at: now(), n: amount }); hits.set(key, list);
      if (hits.size > 5000) for (const k of [...hits.keys()]) recent(k);
    },
    /** Milliseconds until `amount` more fits (0 when it fits now). */
    waitFor(key, amount = 1) {
      const list = recent(key);
      let over = list.reduce((s, x) => s + x.n, 0) + amount - max;
      if (over <= 0) return 0;
      for (const x of list) { over -= x.n; if (over <= 0) return Math.max(0, x.at + windowMs - now()); }
      return windowMs;
    },
  };
}

/** One promise per key: a second caller for the same work waits for the first instead of starting it again. */
export function singleFlight() {
  const running = new Map();
  return (key, fn) => {
    if (running.has(key)) return running.get(key);
    const p = Promise.resolve().then(fn).finally(() => running.delete(key));
    running.set(key, p);
    return p;
  };
}
