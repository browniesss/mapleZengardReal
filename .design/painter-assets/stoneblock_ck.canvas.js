// Impassable stone block — Core Keeper top-down wall style. Full-bleed (fills the whole cell)
// with a chunky raised bevel + thick dark outline so it clearly reads as solid/blocked
// (fixes the round-rock "doesn't block" problem). Warm gray harmonizes with maple wood tones.
const GRID = 32;
const s = c.width / GRID;
function rectg(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x * s, y * s, w * s, h * s); }
function px(x, y, col) { rectg(x, y, 1, 1, col); }

const OUT = '#221D18', DK = '#3E372F', BODY = '#6B6055', MID = '#857A6C', LT = '#A99D8C', HI = '#C8BCA8';

// thick outer outline base
rectg(0, 0, 32, 32, OUT);
// raised face
rectg(1, 1, 30, 30, BODY);

// top + left highlight bevel (3px) -> light hits the top of the block
rectg(1, 1, 30, 3, LT); rectg(1, 1, 3, 30, LT);
rectg(1, 1, 30, 1, HI); rectg(1, 1, 1, 30, HI);
// bottom + right shadow bevel (3px)
rectg(1, 28, 30, 3, DK); rectg(28, 1, 3, 30, DK);
rectg(1, 30, 30, 1, OUT); rectg(30, 1, 1, 30, OUT);

// inner top face (the flat top of the block)
rectg(4, 4, 24, 24, BODY);
rectg(4, 4, 24, 1, LT); rectg(4, 4, 1, 24, LT);     // inner top/left rim highlight
rectg(4, 27, 24, 1, DK); rectg(27, 4, 1, 24, DK);   // inner bottom/right rim shadow

// stone cracks (dark) for texture
const cracks = [[10, 10], [11, 11], [12, 12], [13, 12], [20, 20], [21, 19], [19, 21], [15, 8], [24, 16], [9, 22], [23, 23]];
for (const k of cracks) px(k[0], k[1], DK);
// chips / catch-lights (light) for stone grain
const chips = [[16, 14], [22, 12], [11, 18], [18, 23], [14, 9]];
for (const k of chips) px(k[0], k[1], LT);

// central dome highlight so the block looks rounded-solid from top-down
rectg(13, 13, 6, 6, MID); px(14, 14, LT); px(15, 14, LT); px(14, 15, MID);
