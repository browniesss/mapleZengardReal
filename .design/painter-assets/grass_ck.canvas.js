// Maple-Island grass board tile — Core Keeper top-down pixel style.
// Bright maple greens + organic Core-Keeper texture, subtle edge AO for grid readability,
// small maple flower accents. 32x32 logical grid, full-bleed (fills the whole cell).
const GRID = 32;
const s = c.width / GRID;
function px(x, y, col) { ctx.fillStyle = col; ctx.fillRect(x * s, y * s, s, s); }
function rectg(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x * s, y * s, w * s, h * s); }

// Maple-bright greens with Core Keeper shade depth (dark -> highlight)
const G_DK = '#2E6B24', G_BASE = '#4E9A35', G_MID = '#63B341', G_LT = '#86CC55', G_HI = '#A8E36B';
const DIRT = '#6E5A33', DIRT_D = '#523F22';

// base fill
rectg(0, 0, 32, 32, G_BASE);

// Core Keeper organic blotch shading (deterministic, multi-shade)
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    const n = (x * 7 + y * 13 + (x >> 2) * (y >> 2) * 5) % 19;
    if (n === 0 || n === 4) px(x, y, G_DK);
    else if (n === 1 || n === 11) px(x, y, G_MID);
    else if (n === 8) px(x, y, G_LT);
  }
}

// scattered grass-blade tufts (light highlight + dark root), Core Keeper ground detail
const tufts = [[6, 8], [12, 20], [20, 6], [25, 16], [9, 25], [17, 13], [27, 26], [4, 18]];
for (const t of tufts) { const [bx, by] = t; px(bx, by, G_HI); px(bx, by - 1, G_LT); px(bx + 1, by, G_MID); px(bx, by + 1, G_DK); }

// tiny dirt pebbles (Core Keeper ground speck)
const peb = [[14, 7], [22, 23], [8, 14]];
for (const p of peb) { const [bx, by] = p; px(bx, by, DIRT); px(bx + 1, by, DIRT_D); px(bx, by + 1, DIRT_D); }

// maple charm: two tiny flowers (subtle)
function flower(fx, fy) { px(fx, fy, '#F4D84C'); px(fx - 1, fy, '#FFFFFF'); px(fx + 1, fy, '#FFFFFF'); px(fx, fy - 1, '#FFFFFF'); px(fx, fy + 1, '#FFFFFF'); }
flower(11, 18); flower(24, 11);

// subtle edge ambient-occlusion so the board grid reads (1px darker border, no hard frame)
rectg(0, 0, 32, 1, G_DK); rectg(0, 0, 1, 32, G_DK); rectg(0, 31, 32, 1, G_DK); rectg(31, 0, 1, 32, G_DK);
// soft top highlight (light from top), Core Keeper bevel hint
rectg(1, 1, 30, 1, G_LT);
