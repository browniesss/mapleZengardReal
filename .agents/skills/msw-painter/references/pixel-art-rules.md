# Pixel art style rules

Every sprite produced with msw-painter is drawn in **pixel art style**. Smooth vector graphics do not match the tone of the existing Maker sprites.

## Core principles

- **Disable antialiasing**: Keep sharp pixel edges instead of smooth lines.
- **Restricted palette**: Keep colors to a minimum. Build depth with stepped solid shading (2–4 levels) rather than gradients.
- **Grid alignment**: Snap every element to the pixel grid. Do not use fractional coordinates.
- **Small resolution → upscaled render**: Real pixel art is drawn on a small canvas (e.g. 16×16, 32×32) and scaled up with `width`/`height`. See the table in [size-guide.md](size-guide.md).

## Pixel art implementation per medium

### SVG

Create a small logical coordinate system with `viewBox` and scale the output up with `width`/`height`. Use `image-rendering: pixelated` to prevent interpolation when upscaling. Place dots as 1px `<rect>` elements.

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="128" height="128"
     style="image-rendering: pixelated; image-rendering: crisp-edges;">
  <rect x="6" y="2" width="1" height="1" fill="#4A90D9"/>
  <rect x="7" y="2" width="1" height="1" fill="#4A90D9"/>
  <!-- Chain 1px rects together to fill in the picture with dots -->
</svg>
```

### HTML5 Canvas

Set `ctx.imageSmoothingEnabled = false` first, then call `fillRect` with positions/sizes obtained by multiplying logical grid coordinates by `scale`. Do not use curve APIs such as `arc()` or `bezierCurveTo()`.

```javascript
ctx.imageSmoothingEnabled = false;
const scale = 8;  // Map a 16×16 grid onto a 128×128 canvas
ctx.fillStyle = '#4A90D9';
ctx.fillRect(6 * scale, 2 * scale, scale, scale);  // One dot at (6,2)
ctx.fillRect(7 * scale, 2 * scale, scale, scale);
```

> <SKILL_PATH>/scripts/render.cjs auto-exposes `c` (the canvas element) and `ctx` (the 2D context), so use them directly without redeclaring.

### HTML

Apply `image-rendering: pixelated` to the root element. Whether you embed an image with `<img>` or set it as a `background-image`, interpolation is turned off the same way.

```html
<!doctype html>
<style>
  html, body { margin: 0; image-rendering: pixelated; }
  .sprite { width: 128px; height: 128px; background: url('data:image/png;base64,...'); }
</style>
<div class="sprite"></div>
```

## Creating shading / depth

- Use **stepped shading** instead of gradients: base color + 1–2 darker steps + 1–2 lighter steps.
- Make the darker color by lowering the saturation/brightness of the base color, and paint it at a consistent pixel width (usually 1–2px) within the same surface.
- Assume the light source is normally at the upper-left → shadows on the lower-right, highlights on the upper-left.

Example (a blue slime with base `#4A90D9`):
- Shadow: `#2E5C8A` (dark blue)
- Highlight: `#7FB5E8` (light blue)
- Outline: `#1A3A5C` or a white outline

## Forbidden

- Curve APIs: `arc()`, `arcTo()`, `bezierCurveTo()`, `quadraticCurveTo()` — round shapes must be made by placing pixels directly.
- Soft effects: `box-shadow`, `filter: blur()`, `filter: drop-shadow()` (blur family).
- Gradients: `createLinearGradient()`, `createRadialGradient()`, CSS `linear-gradient()`/`radial-gradient()`.
- Fractional coordinates: `fillRect(10.5, 20.3, ...)` — breaks grid alignment.
- `stroke-width` less than 1 in SVG.

## Drawing round shapes manually

If you need a circle, place dots using the midpoint circle algorithm, or use a predefined small pixel circle pattern. Example: an 8×8 circle.

```
. . # # # # . .
. # . . . . # .
# . . . . . . #
# . . . . . . #
# . . . . . . #
# . . . . . . #
. # . . . . # .
. . # # # # . .
```

Place each cell with `fillRect` or `<rect>`.
