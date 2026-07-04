// Maple-style chunky boulder: rounded grey rock, stepped shading, dark outline, cracks. 32x32 grid.
const GRID = 32;
const s = c.width / GRID;
function px(x, y, col) { ctx.fillStyle = col; ctx.fillRect(x * s, y * s, s, s); }

// boulder silhouette: per-row [xStart, xEnd] inclusive
const spans = {
  8: [13, 18], 9: [11, 20], 10: [10, 22], 11: [9, 23], 12: [8, 24],
  13: [7, 25], 14: [6, 26], 15: [6, 26], 16: [5, 27], 17: [5, 27],
  18: [5, 27], 19: [5, 27], 20: [5, 27], 21: [6, 27], 22: [6, 27],
  23: [7, 27], 24: [8, 26], 25: [9, 25], 26: [11, 24], 27: [14, 22],
};
const BASE = '#888E9C', LIGHT = '#B3B8C4', DARK = '#5C616E', OUT = '#2C2F38', CRACK = '#474B57';

function filled(x, y) { const sp = spans[y]; return sp && x >= sp[0] && x <= sp[1]; }

// fill base + shading (light source upper-left)
for (const yk in spans) {
  const y = +yk, sp = spans[yk];
  for (let x = sp[0]; x <= sp[1]; x++) {
    let col = BASE;
    // diagonal light: upper-left lighter, lower-right darker
    const d = (x - sp[0]) + (y - 8);
    if (y <= 12 || x <= sp[0] + 2) col = LIGHT;
    if (y >= 22 || x >= sp[1] - 2) col = DARK;
    px(x, y, col);
  }
}
// outline: filled pixel adjacent to empty (4-neighbour)
for (const yk in spans) {
  const y = +yk, sp = spans[yk];
  for (let x = sp[0]; x <= sp[1]; x++) {
    if (!filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1)) px(x, y, OUT);
  }
}
// cracks (a couple of dark internal strokes)
[[13, 14], [14, 15], [15, 16], [16, 17], [15, 18], [14, 19]].forEach(p => px(p[0], p[1], CRACK));
[[20, 18], [21, 19], [20, 20], [22, 20]].forEach(p => px(p[0], p[1], CRACK));
// small highlight specks (top-left)
[[9, 11], [11, 12], [8, 14]].forEach(p => px(p[0], p[1], '#D2D6DE'));
