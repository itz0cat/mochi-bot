const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** "10m", "2h", "1d12h", "1w" -> milliseconds, or null when it isn't a duration. */
function parseDuration(input) {
  if (!input) return null;
  const str = String(input).toLowerCase().replace(/\s+/g, '');
  const re = /(\d+(?:\.\d+)?)([smhdw])/g;
  let total = 0;
  let used = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    total += Number(m[1]) * UNITS[m[2]];
    used += m[0].length;
  }
  return used === str.length && total > 0 ? Math.round(total) : null;
}

/** 93784000 -> "1d 2h 3m" */
function fmtDuration(ms) {
  const parts = [];
  for (const [label, size] of [['d', UNITS.d], ['h', UNITS.h], ['m', UNITS.m], ['s', UNITS.s]]) {
    const n = Math.floor(ms / size);
    if (n > 0) { parts.push(`${n}${label}`); ms -= n * size; }
  }
  return parts.slice(0, 3).join(' ') || '0s';
}

const truncate = (s, n = 100) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const ID_RE = /^\d{15,22}$/;
const idsFrom = (str, kind) => {
  const re = kind === 'role' ? /<@&(\d{15,22})>/g : kind === 'channel' ? /<#(\d{15,22})>/g : /<@!?(\d{15,22})>/g;
  const out = [...String(str || '').matchAll(re)].map((m) => m[1]);
  return out.length ? out : String(str || '').split(/[\s,]+/).filter((x) => ID_RE.test(x));
};

/** "#ff99cc", "ff99cc", "pink" -> 0xff99cc or null */
const NAMED = { pink: 0xffb7d5, red: 0xff9aa2, green: 0xa8e6cf, blue: 0xaed9f7, purple: 0xcdb4f6, yellow: 0xfff1a8, orange: 0xffd3b6, white: 0xffffff, black: 0x23272a };
function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  const m = s.match(/^#?([0-9a-f]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}

/** Replace {user} {username} {server} {count} {mention} in welcome-style messages. */
function fillTemplate(tpl, { user, guild, extra = {} }) {
  const map = {
    user: user ? `<@${user.id}>` : '', mention: user ? `<@${user.id}>` : '', username: user?.username ?? '',
    tag: user?.tag ?? user?.username ?? '', server: guild?.name ?? '', count: String(guild?.memberCount ?? ''), ...extra,
  };
  return String(tpl).replace(/\{(\w+)\}/g, (all, k) => (k in map ? map[k] : all));
}

module.exports = { UNITS, parseDuration, fmtDuration, truncate, chunk, clamp, sleep, plural, ts, pick, shuffle, idsFrom, parseColor, fillTemplate, ID_RE };
