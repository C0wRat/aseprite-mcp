# aseprite-mcp

An [MCP](https://modelcontextprotocol.io) server, packaged as a Claude Code plugin, that lets Claude Code drive [Aseprite](https://www.aseprite.org/) to create **static sprites**, **animated sprites**, and **tilemaps**. Claude gets tools to draw and export art, and can see its work through rendered previews. You open the resulting `.aseprite` files in the editor and keep working on them yourself.

## Features

- **Sprites:** create a canvas (or import a PNG), use palette presets, manage layers and groups, draw pixels, lines, rectangles and ellipses, flood fill, replace colors, and paste images.
- **ASCII-art drawing:** draw with row strings plus a color legend, which is compact and easy for an LLM to reason about. `read_pixels` returns the same format.
- **Animation:** add, copy and remove frames, set per-frame durations, define tags with a direction, and move cels for bobbing or sliding motion.
- **Tilemaps:** create tilesets, draw tiles, add tilemap layers, place tiles from a 2D grid, and export a tileset atlas with JSON or [Tiled](https://www.mapeditor.org/) `.tmj` map data.
- **Feedback loop:** `render_preview` returns a zoomed PNG of a frame, several frames or a tag, with optional onion skin. Any editing tool also accepts `preview: true`.
- **Batching:** `batch` runs many steps in one Aseprite process. It is fast and all-or-nothing: if any step fails, nothing is saved.
- **Exports:** sprite sheets with JSON metadata for Godot, Unity, Phaser and LÖVE, animated GIF or WebP, and PNG frames or layers.
- **Non-destructive output:** everything is saved as normal `.aseprite` files.

## How it works

```
┌─────────────┐   MCP (stdio)   ┌──────────────────┐   CLI + Lua    ┌────────────────────┐
│ Claude Code │ ──────────────▶ │ aseprite-mcp     │ ─────────────▶ │ aseprite --batch   │
│             │ ◀────────────── │ (Node.js)        │ ◀───────────── │ --script runner.lua│
└─────────────┘  results+images └──────────────────┘   JSON files   └────────────────────┘
                                         │
                                         ▼
                                workspace/*.aseprite, *.png, *.json
```

1. Claude calls a tool such as `draw_pixels`. The server validates the arguments and resolves paths inside the workspace.
2. The server writes a request file and runs Aseprite headlessly:
   `aseprite --batch --script-param input=… --script-param output=… --script lua/runner.lua`
3. [`lua/runner.lua`](lua/runner.lua) runs each operation through the [Aseprite scripting API](https://www.aseprite.org/api/), saves the changed files only if every operation succeeded, and writes a JSON response.
4. The server returns that result to Claude, plus a PNG image when a preview was requested.

Calls don't share state: the `.aseprite` file on disk is the only record. A typical call takes about 100 ms. Exports use Aseprite's own CLI flags (`--sheet`, `--save-as`, and so on).

## Tools

| Group | Tools |
|---|---|
| Document | `create_sprite`, `get_sprite_info`, `resize_sprite`, `crop_sprite` (also extends the canvas), `set_palette`, `set_color_mode`, `list_sprites`, `list_palettes` |
| Layers | `add_layer`, `remove_layer`, `set_layer_props`, `duplicate_layer` |
| Drawing | `draw_pixels`, `draw_line`, `draw_rect`, `draw_ellipse`, `fill`, `clear`, `replace_color`, `paste_image`, `read_pixels` |
| Animation | `add_frame`, `remove_frame`, `copy_frame`, `set_frame_duration`, `add_tag`, `remove_tag`, `move_cel` |
| Tilemaps | `create_tileset`, `add_tilemap_layer`, `draw_tile`, `set_tiles`, `get_tilemap`, `export_tilemap` |
| Preview & export | `render_preview`, `export_png`, `export_spritesheet`, `export_gif` |
| Meta | `batch`, plus `run_lua` (only when `ASEPRITE_ALLOW_LUA=true`) |

Conventions: paths are relative to the workspace, frames are **1-based**, and tile index **0** is always the empty tile. Colors are `#rgb`, `#rrggbb` or `#rrggbbaa`, a palette index, or `"transparent"`.

Palette presets: `pico8`, `sweetie16`, `db32`, `endesga32`, `gameboy`.

### Example: ASCII-art drawing

```json
{
  "file": "items/potion.aseprite",
  "x": 4, "y": 2,
  "legend": { "k": "#1a1c2c", "g": "#a7f070", "G": "#38b764", "w": "#f4f4f4" },
  "rows": [
    "...kk...",
    "..kggk..",
    ".kgwggk.",
    ".kgGGGk.",
    "..kkkk.."
  ],
  "preview": true
}
```

Characters that are not in the legend (here `.`) leave the existing pixel unchanged.

### Example: batch

```json
{
  "file": "slime.aseprite",
  "ops": [
    { "op": "create_sprite", "args": { "width": 16, "height": 16, "palettePreset": "sweetie16" } },
    { "op": "draw_ellipse",  "args": { "x": 3, "y": 8, "width": 10, "height": 7, "color": "#38b764", "filled": true } },
    { "op": "add_frame",     "args": { "count": 3, "durationMs": 120 } },
    { "op": "move_cel",      "args": { "frame": 2, "dy": -1 } },
    { "op": "move_cel",      "args": { "frame": 3, "dy": -2 } },
    { "op": "move_cel",      "args": { "frame": 4, "dy": -1 } },
    { "op": "add_tag",       "args": { "name": "bounce", "from": 1, "to": 4 } }
  ],
  "preview": { "tag": "bounce" }
}
```

## Requirements

- **Aseprite 1.3 or newer** (tested with 1.3.18). Tilemaps need 1.3. The Steam version works.
- **Node.js 20+**
- **Claude Code**

## Installation

### As a Claude Code plugin (recommended)

The repository is both a plugin and a single-plugin marketplace. From a local checkout:

```bash
git clone <repo-url> aseprite-mcp
claude plugin marketplace add ./aseprite-mcp
claude plugin install aseprite-mcp@aseprite-mcp
```

Once the repo is on GitHub, you can install it with `/plugin marketplace add <owner>/aseprite-mcp` instead.

This registers the `aseprite` MCP server and the bundled **pixel-art** skill. The skill teaches Claude a workflow (palette → silhouette → preview → refine → animate → export) along with animation and tileset conventions. The bundled server is committed at `dist/server.js`, so no `npm install` is needed.

### As a standalone MCP server

```bash
claude mcp add aseprite -- node /path/to/aseprite-mcp/dist/server.js
```

Any other MCP client can run `node dist/server.js` over stdio.

## Configuration

Everything is optional. Set these as environment variables before starting Claude Code, or pass `-e KEY=value` to `claude mcp add`.

| Env var | Default | Description |
|---|---|---|
| `ASEPRITE_PATH` | auto-detected | Path to the Aseprite executable. If unset, the server checks `PATH` and the usual Steam, system, macOS and Windows locations, including `~/.local/share/Steam/steamapps/common/Aseprite/aseprite`. |
| `ASEPRITE_WORKSPACE` | current directory | Root directory for all file paths. The server refuses paths outside it. |
| `ASEPRITE_PREVIEW_SCALE` | `8` | Default zoom for previews. Previews are capped at 1024 px on the longest side. |
| `ASEPRITE_ALLOW_LUA` | `false` | Enables the `run_lua` tool, which runs arbitrary Aseprite Lua. |
| `ASEPRITE_TIMEOUT_MS` | `30000` | Timeout for each Aseprite invocation. |

For Steam installs, the server adds `--noinapp` automatically so headless runs don't count as playtime.

## Example prompts

- *"Make a 32×32 knight sprite using the Endesga 32 palette, then give it a 4-frame idle animation and export a sprite sheet for Godot."*
- *"Create a 16×16 grass/dirt/water tileset and paint a 20×15 sample map with it. Export it as Tiled JSON."*
- *"Open `slime.aseprite`, add a 6-frame `jump` tag with squash and stretch, and export a GIF."*

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # bundle src/ into dist/server.js (esbuild)
npm test            # build, then end-to-end tests against your real Aseprite
```

Layout:

```
.claude-plugin/        plugin manifest (registers the MCP server) + marketplace
skills/pixel-art/      bundled skill
src/                   MCP server (TypeScript)
  index.ts             entry point
  tools.ts             tool registration, batch, preview, CLI exports
  ops.ts               catalogue of Lua-backed operations (schemas + docs)
  aseprite.ts          runs Aseprite (Lua runner and CLI)
  config.ts            env config and Aseprite auto-detection
  workspace.ts         path sandboxing
  palettes.ts          palette presets
lua/
  runner.lua           batch dispatcher (one Aseprite process per call)
  lib.lua              shared helpers (colors, layers, cels, sprite cache)
  ops/*.lua            operation implementations
test/e2e.test.mjs      drives the built server through the MCP client SDK
dist/server.js         bundled server (committed so plugin installs work)
```

To add an operation:

1. Implement it in a `lua/ops/*.lua` module.
2. Add its schema to `src/ops.ts`. It then becomes both its own tool and a step that `batch` accepts.
3. Run `npm run build`.

## Roadmap

- [x] Sprites: canvas, palettes, layers, drawing primitives, preview, PNG export
- [x] Animation: frames, durations, tags, sprite sheets, GIF
- [x] Tilemaps: tilesets, tilemap layers, tile placement, Tiled export
- [x] Plugin: manifest, marketplace, pixel-art skill, `run_lua`
- [ ] Slices (9-patch, hitboxes) and user data
- [ ] Mirroring and rotation helpers for symmetric sprites and walk cycles
- [ ] More engine exports (Godot `SpriteFrames` `.tres`, LDtk)
- [ ] A persistent Aseprite worker for very chatty sessions

## License

TBD
