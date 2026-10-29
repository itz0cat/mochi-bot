// Small safe math evaluator (no eval). Supports + - * / % ^ ( ), decimals, pi, e, and a few functions.
const FUNCS = { sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp };
const CONSTS = { pi: Math.PI, e: Math.E };

function evaluate(input) {
  const src = String(input).toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '');
  let i = 0;
  const peek = () => { while (src[i] === ' ') i++; return src[i]; };
  const fail = (msg) => { throw new Error(msg || 'bad expression'); };

  function number() {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function primary() {
    const c = peek();
    if (c === '(') { i++; const v = expr(); if (peek() !== ')') fail('missing )'); i++; return v; }
    if (c === '-') { i++; return -power(); }
    if (c === '+') { i++; return power(); }
    const n = number();
    if (n !== null) return n;
    const w = /^[a-z]+/.exec(src.slice(i));
    if (!w) fail();
    i += w[0].length;
    if (w[0] in CONSTS) return CONSTS[w[0]];
    if (w[0] in FUNCS) { if (peek() !== '(') fail(); i++; const v = expr(); if (peek() !== ')') fail('missing )'); i++; return FUNCS[w[0]](v); }
    return fail(`unknown "${w[0]}"`);
  }
  function power() { const base = primary(); if (peek() === '^') { i++; return base ** power(); } return base; }
  function term() {
    let v = power();
    for (;;) {
      const c = peek();
      if (c === '*') { i++; v *= power(); } else if (c === '/') { i++; v /= power(); } else if (c === '%') { i++; v %= power(); } else return v;
    }
  }
  function expr() {
    let v = term();
    for (;;) {
      const c = peek();
      if (c === '+') { i++; v += term(); } else if (c === '-') { i++; v -= term(); } else return v;
    }
  }
  const out = expr();
  if (peek() !== undefined) fail();
  if (!Number.isFinite(out)) fail('not a finite number');
  return out;
}

module.exports = { evaluate };
