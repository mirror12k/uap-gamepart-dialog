// Flag expressions: a boolean formula over flag names (dialog conditions; hosts can use them for anything, e.g. visibility).
//   met_keeper                      true while the flag is set
//   !met_keeper                     not
//   a & b          a && b           and
//   a | b          a || b           or        (& binds tighter than |)
//   (a | b) & !c                    grouping
// Flag names may contain letters, digits and _ . : - (so `level.solved.tutorial-echo` and `difficulty.hard` are names).
// Evaluate with a flags object ({name: true}) or a lookup function (name) -> boolean.

const TOKEN = /\s*(\|\|?|&&?|!|\(|\)|[\w.:-]+)/y;

function tokenize(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`unexpected "${src.slice(pos).trim()[0]}" in "${src}"`);
    out.push(m[1]); pos = TOKEN.lastIndex;
  }
  return out;
}

/** Parse to a function (lookup) -> boolean. Throws Error(message) on a malformed expression. */
function compile(src) {
  const t = tokenize(src);
  if (!t.length) throw new Error('empty expression');
  let i = 0;
  const peek = () => t[i];
  const orExpr = () => {
    let l = andExpr();
    while (peek() === '|' || peek() === '||') { i++; const a = l, b = andExpr(); l = (f) => a(f) || b(f); }
    return l;
  };
  const andExpr = () => {
    let l = notExpr();
    while (peek() === '&' || peek() === '&&') { i++; const a = l, b = notExpr(); l = (f) => a(f) && b(f); }
    return l;
  };
  const notExpr = () => {
    const x = t[i++];
    if (x === undefined) throw new Error(`unexpected end of "${src}"`);
    if (x === '!') { const a = notExpr(); return (f) => !a(f); }
    if (x === '(') {
      const a = orExpr();
      if (t[i++] !== ')') throw new Error(`missing ")" in "${src}"`);
      return a;
    }
    if (/^[\w.:-]+$/.test(x)) return (f) => f(x);
    throw new Error(`unexpected "${x}" in "${src}"`);
  };
  const fn = orExpr();
  if (i < t.length) throw new Error(`unexpected "${t[i]}" in "${src}"`);
  return fn;
}

const cache = new Map();
/** The compiled expression, or { error } when malformed (cached). */
export function parseExpr(src) {
  const key = String(src);
  if (!cache.has(key)) {
    try { cache.set(key, { fn: compile(key), error: null }); } catch (e) { cache.set(key, { fn: () => false, error: e.message }); }
  }
  return cache.get(key);
}

/** Evaluate against flags (object) or a lookup function. A malformed expression is false (check parseExpr(src).error). */
export function evalExpr(src, flags = {}) {
  const lookup = typeof flags === 'function' ? flags : (n) => !!flags[n];
  return !!parseExpr(src).fn(lookup);
}
