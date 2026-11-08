---
name: pixel-art
description: Workflow and craft guidance for making pixel-art sprites, animations and tilemaps with the aseprite MCP tools. Use when the user asks to create, draw, animate or export sprites, characters, items, icons, tilesets or tilemaps, or mentions Aseprite or pixel art.
---

# Pixel art with the aseprite tools

The `aseprite` MCP server edits real `.aseprite` files headlessly. Every call opens the file, applies changes, saves, and exits, so the file on disk is always the source of truth and the user can open it in Aseprite at any time.

## Workflow

1. **Plan the canvas.** Pick a small size: 16×16 or 32×32 for characters and items, 8×8 or 16×16 for tiles. Larger sprites take far more pixels to draw and are rarely better.
2. **Pick a limited palette.** Start from a preset with `create_sprite { palettePreset }` (`pico8`, `sweetie16`, `db32`, `endesga32`, `gameboy`), or give 4–16 explicit colors. Reference colors by palette index or hex.
3. **Block out the silhouette** on its own layer with `draw_pixels` rows, `draw_rect`, `draw_ellipse` and `fill`.
4. **Look at it.** Call `render_preview`, or pass `preview: true` to any drawing tool. Check the result before moving on.
5. **Refine:** add shading, highlights and an outline, preferably on separate layers (`add_layer`) so mistakes are cheap to undo with `clear`.
6. **Animate** (if needed): see below.
7. **Export:** use `export_spritesheet` for engines, `export_gif` to show the user, `export_png` for single frames, and `export_tilemap` for maps.

Use **`batch`** whenever you have more than two or three steps. It runs them all in one Aseprite process, which is faster, and if any step fails nothing is saved. Add `preview` to the batch to see the outcome in the same call.

## Drawing efficiently

`draw_pixels` with `rows` + `legend` is the most compact and readable input. Characters missing from the legend are skipped, so `.` works as "leave unchanged":

```json
{
  "file": "items/potion.aseprite",
  "layer": "Layer 1",
  "x": 4, "y": 2,
  "legend": { "k": "#1a1c2c", "g": "#a7f070", "G": "#38b764", "w": "#f4f4f4" },
  "rows": [
    "...kk...",
    "...kk...",
    "..kggk..",
    ".kgwggk.",
    ".kggGGk.",
    ".kgGGGk.",
    "..kkkk.."
  ]
}
```

- Write the full sprite as rows in one call rather than many single pixels.
- `read_pixels` returns the same format. Use it to inspect exact pixels, then edit the rows and draw them back.
- Coordinates are canvas pixels with the origin at the top-left. Frames are **1-based**.

## Craft tips

- **Silhouette first:** a sprite should be recognisable as a solid shape.
- **Outlines:** use a dark outline, usually the palette's darkest color or a dark hue-shifted shade, not pure black on everything. Selective outlining, with lighter outlines on the lit side, looks more polished.
- **Light source:** choose one direction (usually top-left) and shade consistently: base color, one shadow tone, one highlight.
- **Hue shifting:** make shadows cooler or more saturated and highlights warmer, rather than only darker or lighter.
- **Avoid:** pillow shading (shading inward from every edge), banding (parallel same-length stair steps of neighbouring tones), and stray single "orphan" pixels.
- **Lines:** keep slopes consistent (1:1, 1:2, 2:1). Avoid jaggies, which are irregular steps in a curve.
- **Readability at 1×:** check previews at a low `scale` (2–3) as well as zoomed in.

## Animation

- Build the base pose on frame 1, then `add_frame { count, copy: true }`. Copies are a good starting point for the next pose.
- **Idle:** 2–4 frames, a 1px bob (`move_cel` dy ±1) or a breathing squash, 150–250 ms per frame.
- **Walk:** 4–8 frames, about 100 ms. Contact → down → passing → up, then mirrored for the other leg.
- **Attack / jump:** anticipation (wind-up), action (fast, 1–2 frames, around 50–80 ms), recovery (longer).
- Use squash and stretch on soft things such as slimes and jumps, while keeping the volume roughly constant.
- Name each animation with `add_tag` (`idle`, `walk`, `attack`…). Engines read tags from the sprite sheet JSON.
- Check motion with `render_preview { tag }` (all frames side by side) or with `onionBefore: 1` on a single frame.
- Set timing with `set_frame_duration`. Different frames can have different durations, so hold key poses longer.

## Tilemaps

1. `create_sprite` with a canvas that is a multiple of the tile size, e.g. 160×128 for a 20×16 map of 8×8 tiles.
2. `create_tileset { tileWidth, tileHeight }`. This returns a tileset index (usually 0).
3. Draw tiles with `draw_tile { tile: 1 }`, `{ tile: 2 }`… To append a new tile, use the next index. Tile **0 is always empty**.
4. `add_tilemap_layer { name, tileset }`, then `set_tiles { grid }`. In the grid, `0` = empty and `-1` = leave the cell unchanged; `col`/`row` offset a partial grid.
5. Make tiles **seamless**: edges must line up when a tile repeats. Preview a 3×3 patch of the same tile to check.
6. `export_tilemap { out }` writes an atlas PNG plus simple JSON and/or a Tiled `.tmj`.

## Exports for engines

- **Godot / Phaser / Unity:** `export_spritesheet` with `format: json-hash` (the default) and `sheetType: rows` or `packed`. Use `padding: 1` or `extrude: true` if the engine shows bleeding between frames.
- **Per-animation sheets:** call `export_spritesheet` once per tag with `tag`.
- **Previews for the user:** use `export_gif` with `scale: 4`.
