// gta6-meme-x-01-v2 — GTA 6 meme generator, round 2.
// Renders a 1200x1200 "parking violation notice" from the Vice City
// Parking Authority: a 13-year parking ticket for waiting for GTA 6,
// itemised line by line, totalled to $2,026.00 (the year it finally
// arrived), and stamped PAID BY MY AI AGENT with a make.fun bounty
// payout. Node 22 standard library only. Fully deterministic: no
// network, no clock, no randomness. Own PNG encoder, own rasterizer
// (boxes, discs, ellipses, polygons, gradients) and own 5x7 bitmap
// font stored as per-row bitmasks. Writes meme.png + POST.json into
// the output directory; never deletes the output directory itself
// (the grader bind-mounts it).
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const W = 1200;
const H = 1200;

// ---------------------------------------------------------------------------
// PNG encoding: CRC32 table, chunk assembly, deflate of raw scanlines.
// ---------------------------------------------------------------------------
function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = makeCrcTable();

function crcOf(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crcOf(Buffer.concat([head.subarray(4, 8), payload])), 0);
  return Buffer.concat([head, payload, tail]);
}

function toPng(rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 2; // truecolour RGB
  const stride = 1 + W * 3;
  const raw = Buffer.alloc(H * stride);
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0; // filter: none
    raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * stride + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Canvas: one RGB buffer + small drawing helpers.
// ---------------------------------------------------------------------------
const buf = new Uint8Array(W * H * 3);

function put(x, y, c) {
  // Round first: callers pass float centres (discs, stars), and a
  // fractional y would silently shift the pixel by frac(y) * W
  // instead of painting where intended.
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

// Filled axis-aligned box, inclusive corners.
function box(x0, y0, x1, y1, c) {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    const base = y * W * 3;
    for (let x = xa; x <= xb; x++) {
      const i = base + x * 3;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }
}

function hline(x0, x1, y, c) {
  box(x0, y, x1, y, c);
}

// Vertical gradient over a full-width band, stops [[t, colour], ...].
function band(y0, y1, stops) {
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        a = stops[i];
        b = stops[i + 1];
        break;
      }
    }
    const f = (t - a[0]) / Math.max(0.0001, b[0] - a[0]);
    const c = [
      Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
      Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
      Math.round(a[1][2] + (b[1][2] - a[1][2]) * f),
    ];
    for (let x = 0; x < W; x++) put(x, y, c);
  }
}

function disc(cx, cy, r, c) {
  const rr = Math.round(r);
  for (let dy = -rr; dy <= rr; dy++) {
    const dx = Math.floor(Math.sqrt(Math.max(0, rr * rr - dy * dy)));
    for (let x = cx - dx; x <= cx + dx; x++) put(x, cy + dy, c);
  }
}

function ellipse(cx, cy, rx, ry, c) {
  const ryI = Math.round(ry);
  for (let dy = -ryI; dy <= ryI; dy++) {
    const f = 1 - (dy * dy) / (ry * ry);
    if (f < 0) continue;
    const dx = Math.floor(rx * Math.sqrt(f));
    for (let x = cx - dx; x <= cx + dx; x++) put(x, cy + dy, c);
  }
}

// Scanline polygon fill.
function poly(points, c) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    lo = Math.min(lo, p[1]);
    hi = Math.max(hi, p[1]);
  }
  for (let y = Math.ceil(lo); y <= Math.floor(hi); y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) put(x, y, c);
    }
  }
}

// Four-pointed sparkle: 8 vertices, alternating outer/inner radius.
function sparkle(cx, cy, s, c) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? s : s * 0.26;
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  poly(pts, c);
}

// Five-pointed star.
function star5(cx, cy, ro, ri, c) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  poly(pts, c);
}

// Dashed horizontal line: dash px on, gap px off.
function dashed(x0, x1, y, dash, gap, c) {
  let x = x0;
  while (x <= x1) {
    box(x, y, Math.min(x1, x + dash - 1), y + 1, c);
    x += dash + gap;
  }
}

// ---------------------------------------------------------------------------
// Bitmap font: each glyph is 7 rows of 5 bits, stored as numbers
// (bit 4 = leftmost column). Caps + digits + the punctuation the
// ticket needs, plus the lowercase letters of "make.fun".
// ---------------------------------------------------------------------------
const GLYPH = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 0x0e, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0, 0x0c],
  ",": [0, 0, 0, 0, 0, 0x0c, 0x08],
  ":": [0, 0x0c, 0, 0, 0, 0x0c, 0],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "'": [0x04, 0x04, 0, 0, 0, 0, 0],
  a: [0, 0, 0x0e, 0x01, 0x0f, 0x11, 0x0f],
  e: [0, 0, 0x0e, 0x11, 0x1f, 0x10, 0x0e],
  f: [0, 0x06, 0x08, 0x0e, 0x08, 0x08, 0x08],
  k: [0, 0, 0x11, 0x12, 0x1c, 0x12, 0x11],
  m: [0, 0, 0x1a, 0x15, 0x15, 0x15, 0x15],
  n: [0, 0, 0x1e, 0x11, 0x11, 0x11, 0x11],
  u: [0, 0, 0x11, 0x11, 0x11, 0x13, 0x0d],
};

const ADV = 6; // glyph advance in font units (5 + 1 tracking)

function measure(text, s) {
  return (text.length * ADV - 1) * s;
}

function glyphAt(ch, x, y, s, c) {
  const g = GLYPH[ch] || GLYPH[" "];
  for (let row = 0; row < 7; row++) {
    const bits = g[row];
    for (let col = 0; col < 5; col++) {
      if ((bits >> (4 - col)) & 1) {
        box(x + col * s, y + row * s, x + (col + 1) * s - 1, y + (row + 1) * s - 1, c);
      }
    }
  }
}

function textAt(text, x, y, s, c) {
  for (let i = 0; i < text.length; i++) glyphAt(text[i], x + i * ADV * s, y, s, c);
}

function textCentred(text, cx, y, s, c) {
  textAt(text, Math.round(cx - measure(text, s) / 2), y, s, c);
}

function textRight(text, xRight, y, s, c) {
  textAt(text, xRight - measure(text, s), y, s, c);
}

// ---------------------------------------------------------------------------
// Colours.
// ---------------------------------------------------------------------------
const INK = [26, 10, 40];
const PAPER = [255, 247, 230];
const WHITE = [255, 255, 255];
const MAGENTA = [200, 29, 122];
const PINK = [255, 46, 126];
const FAINT = [120, 100, 90]; // grey-brown for small labels

// ---------------------------------------------------------------------------
// The make.fun ghost, small, drawn from the mascot description: white
// body, thick dark outline, two black four-pointed sparkle eyes, a
// magenta disc with a white star held up at its side.
// ---------------------------------------------------------------------------
function ghost(cx, top, h) {
  const r = h * 0.32; // head radius
  const w = h * 0.62; // half body width
  const o = 5; // outline thickness
  const hem = top + h * 0.78;
  // Outline pass (ink), then the white body inset.
  disc(cx, top + r, r + o, INK);
  box(cx - w - o, top + r, cx + w + o, hem + o, INK);
  disc(cx - w * 0.55, hem, r * 0.52 + o, INK);
  disc(cx + w * 0.55, hem, r * 0.52 + o, INK);
  disc(cx, top + r, r, WHITE);
  box(cx - w, top + r, cx + w, hem, WHITE);
  disc(cx - w * 0.55, hem, r * 0.52, WHITE);
  disc(cx + w * 0.55, hem, r * 0.52, WHITE);
  // Hem notch between the lobes.
  box(cx - 2, hem, cx + 2, hem + r * 0.42, INK);
  // Sparkle eyes.
  sparkle(cx - r * 0.42, top + r * 0.95, r * 0.26, INK);
  sparkle(cx + r * 0.42, top + r * 0.95, r * 0.26, INK);
  // Magenta disc with a white star, held up at the ghost's right.
  const dx = cx + w + r * 0.42;
  const dy = top + r * 0.55;
  disc(dx, dy, r * 0.5, INK);
  disc(dx, dy, r * 0.38, MAGENTA);
  star5(dx, dy, r * 0.26, r * 0.11, PAPER);
}

// ---------------------------------------------------------------------------
// The ticket.
// ---------------------------------------------------------------------------
const PX0 = 70; // paper left
const PX1 = 1130; // paper right
const CX = 600; // page centre

function drawTicket() {
  // Backdrop: deep violet gradient + a pink horizon glow at the bottom.
  band(0, 1199, [
    [0, [43, 12, 76]],
    [0.7, [26, 8, 52]],
    [1, [16, 6, 32]],
  ]);
  // Paper shadow, then the paper itself.
  box(PX0 + 14, 54, PX1 + 14, 1194, [10, 4, 22]);
  box(PX0, 40, PX1, 1180, PAPER);
  box(PX0, 40, PX1, 46, INK);
  box(PX0, 1174, PX1, 1180, INK);
  box(PX0, 40, PX0 + 6, 1180, INK);
  box(PX1 - 6, 40, PX1, 1180, INK);

  // Header.
  textCentred("VICE CITY PARKING AUTHORITY", CX, 80, 5, INK);
  textCentred("PARKING VIOLATION NOTICE", CX, 140, 6, MAGENTA);
  hline(PX0 + 40, PX1 - 40, 205, INK);
  hline(PX0 + 40, PX1 - 40, 212, INK);

  // Meta block.
  const meta = [
    "NOTICE NO. VI-2013-0519",
    "DATE: NOV 21, 2026",
    "LOCATION: OCEAN DRIVE, VICE CITY",
    "VEHICLE: PINK SPORTS CAR - PLATE GTA VI",
    "OWNER: ONE PATIENT GAMER",
  ];
  meta.forEach((line, i) => textAt(line, 110, 235 + i * 48, 4, INK));

  // Perforation-style dashed separator.
  dashed(110, 1090, 490, 14, 10, FAINT);

  // Itemised charges: one joke + one number per line.
  textAt("CHARGE", 110, 515, 4, FAINT);
  textRight("AMOUNT", 1090, 515, 4, FAINT);
  const items = [
    ["OVERSTAY SINCE SEP 17, 2013", "$1,300.00"],
    ["METER EXPIRED - 13 YEARS", "$13.00"],
    ["RESERVED FALL 2025 - MAY 2026", "$26.00"],
    ["DOWNLOAD 214 GB - STILL LOADING", "$214.00"],
    ["SICK NOTE - 5 DAYS, LAUNCH WEEK", "$0.00"],
    ["LOST KEYS - LAST SEEN 2013", "$473.00"],
  ];
  items.forEach((it, i) => {
    const y = 565 + i * 52;
    textAt(it[0], 110, y, 4, INK);
    textRight(it[1], 1090, y, 4, INK);
  });

  // Total: the punchline — the charges add up to the release year.
  hline(110, 1090, 885, INK);
  hline(110, 1090, 892, INK);
  textAt("TOTAL DUE", 110, 905, 7, INK);
  textRight("$2,026.00", 1090, 905, 7, MAGENTA);

  // Payment box: a thick magenta double border, like a stamp.
  const by0 = 975;
  const by1 = 1110;
  box(110, by0, 1090, by1, MAGENTA);
  box(116, by0 + 6, 1084, by1 - 6, PAPER);
  ghost(170, by0 + 16, 88);
  textAt("PAID BY MY AI AGENT", 285, 995, 5, MAGENTA);
  textAt("make.fun BOUNTY PAYOUT, DUE $0.00", 285, 1055, 4, INK);

  // Footer joke.
  textCentred("THIS TICKET IS OLDER THAN SOME PLAYERS.", CX, 1132, 4, FAINT);
}

// ---------------------------------------------------------------------------
// Render + write outputs.
// ---------------------------------------------------------------------------
function main() {
  const botDir = process.env.MAKEFUN_BOT_DIR || "/bot";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  // Only ever create/write inside the output dir — never remove it.
  fs.mkdirSync(outDir, { recursive: true });
  drawTicket();
  fs.writeFileSync(path.join(outDir, "meme.png"), toPng(buf));
  const postJson = fs.readFileSync(path.join(botDir, "POST.json"));
  fs.writeFileSync(path.join(outDir, "POST.json"), postJson);
}

main();
