// Maple grass board tile: wood frame + grassy interior + tiny flower accents. 32x32 logical grid.
const GRID = 32;
const s = c.width / GRID;
function px(x, y, col) { ctx.fillStyle = col; ctx.fillRect(x * s, y * s, s, s); }
function rectg(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x * s, y * s, w * s, h * s); }

// palette
const GRASS = '#5BA23C', GD = '#3F7E29', GL = '#80C654', GD2 = '#326C20';
const WOOD = '#7B5530', WOOD_L = '#9C7142', WOOD_D = '#5A3C20';

// grass base
rectg(0, 0, 32, 32, GRASS);

// deterministic grass speckle texture (interior)
for (let y = 3; y < 29; y++) {
  for (let x = 3; x < 29; x++) {
    const h = (x * 13 + y * 7) % 11;
    if (h === 0) px(x, y, GD);
    else if (h === 5) px(x, y, GL);
  }
}
// grass blade tufts (small vertical dark-green strokes)
const tufts = [[8, 21], [21, 10], [14, 25], [24, 23], [11, 13]];
for (const t of tufts) { px(t[0], t[1], GD2); px(t[0], t[1] - 1, GD); px(t[0] + 1, t[1], GD2); }

// tiny flower accents (maple charm)
function flower(fx, fy) { px(fx, fy, '#F2D94E'); px(fx - 1, fy, '#FFFFFF'); px(fx + 1, fy, '#FFFFFF'); px(fx, fy - 1, '#FFFFFF'); px(fx, fy + 1, '#FFFFFF'); }
flower(11, 18); flower(22, 15);

// wood frame border (2px) with bevel
rectg(0, 0, 32, 2, WOOD); rectg(0, 0, 2, 32, WOOD);
rectg(0, 30, 32, 2, WOOD); rectg(30, 0, 2, 32, WOOD);
rectg(0, 0, 32, 1, WOOD_L); rectg(0, 0, 1, 32, WOOD_L);   // outer TL highlight
rectg(0, 31, 32, 1, WOOD_D); rectg(31, 0, 1, 32, WOOD_D); // outer BR shadow
rectg(2, 2, 28, 1, WOOD_D); rectg(2, 2, 1, 28, WOOD_D);   // inner TL shadow
rectg(2, 29, 28, 1, WOOD_L); rectg(29, 2, 1, 28, WOOD_L); // inner BR highlight
