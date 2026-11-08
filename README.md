# aseprite-mcp

> **Status: planning.** This README describes the intended design. Nothing below is implemented yet.

An [MCP](https://modelcontextprotocol.io) server, packaged as a Claude Code plugin, that lets Claude Code drive [Aseprite](https://www.aseprite.org/) to create **static sprites**, **animated sprites**, and **tilemaps**. Claude gets tools to draw and export art. You open the resulting `.aseprite` files in the editor and keep working on them yourself.

---

## Goals

- **Sprites:** create a canvas, manage palettes and layers, draw pixels and shapes, and export to PNG.
- **Animation:** add frames, set per-frame durations, define tags (`idle`, `walk`, `attack`…), and export sprite sheets with JSON metadata or GIFs.
- **Tilemaps:** create tilesets and tilemap layers (Aseprite 1.3+), place tiles, and export tileset images plus map data for game engines.
- **Feedback loop:** after every change Claude can render a preview PNG, look at it, and refine the result.
- **Non-destructive output:** everything is saved as `.aseprite` source files, so a human can always take over.

## Non-goals (for now)

- Live control of a running Aseprite GUI session. The server uses headless batch mode.
- Generative or AI image models. Claude places the pixels itself through the tools.
- Any editor other than Aseprite.

---

## How it works

```
┌─────────────┐   MCP (stdio)   ┌──────────────────┐   CLI + Lua    ┌────────────────────┐
│ Claude Code │ ──────────────▶ │ aseprite-mcp     │ ─────────────▶ │ aseprite --batch   │
│             │ ◀────────────── │ server           │ ◀───────────── │ --script <op>.lua  │
└─────────────┘  tool results   └──────────────────┘  JSON / files  └────────────────────┘
                                         │
                                         ▼
                                  workspace/*.aseprite, *.png, *.json
```

1. Claude calls an MCP tool, for example `draw_pixels`.
2. The server checks the arguments and runs Aseprite headlessly:
   `aseprite --batch --script-param args=<json> --script scripts/draw_pixels.lua`
3. The Lua script opens the target `.aseprite` file, changes it through the [Aseprite scripting API](https://www.aseprite.org/api/), saves it, and prints a JSON result to stdout.
4. The server parses that output and returns it to Claude. When a preview was requested, the server also returns the rendered PNG as an image.

Each call is stateless: the `.aseprite` file on disk is the source of truth. This keeps the server simple and makes every step inspectable.

---

## Planned tools

### Document

| Tool | Purpose |
|---|---|
| `create_sprite` | New file: width, height, color mode (RGB / indexed / grayscale), optional background |
| `open_sprite` / `get_sprite_info` | Read size, layers, frames, tags, palette, tilesets |
| `resize_sprite` / `crop_sprite` | Change the canvas |
| `set_palette` | Load a preset palette (PICO-8, DB32, Endesga 32…) or set explicit colors |

### Layers and drawing

| Tool | Purpose |
|---|---|
| `add_layer` / `remove_layer` / `set_layer_props` | Manage layers: name, visibility, opacity, blend mode |
| `draw_pixels` | Set a batch of `{x, y, color}` pixels on a layer and frame |
| `draw_line` / `draw_rect` / `draw_ellipse` | Primitive shapes, filled or outlined |
| `fill` | Flood fill (bucket) |
| `paste_image` | Place an existing PNG or pixel array onto a cel |
| `clear` | Clear a cel or a region |

### Animation

| Tool | Purpose |
|---|---|
| `add_frame` / `duplicate_frame` / `remove_frame` | Manage frames |
| `set_frame_duration` | Per-frame timing in ms |
| `add_tag` | Named frame ranges with a direction (forward, reverse, ping-pong) |
| `set_onion_preview` | Render the current frame with neighbouring frames overlaid, to help Claude keep motion consistent |

### Tilemaps (Aseprite ≥ 1.3)

| Tool | Purpose |
|---|---|
| `create_tileset` | Define a tile size and create a tileset |
| `draw_tile` | Draw pixels into a specific tile index |
| `add_tilemap_layer` | Add a tilemap layer bound to a tileset |
| `set_tiles` | Place tile indices on the map grid (2D array) |
| `export_tilemap` | Tileset PNG plus map data (JSON, and optionally Tiled `.tmj`) |

### Export and preview

| Tool | Purpose |
|---|---|
| `render_preview` | Return a scaled PNG of a frame, tag, or the whole sheet so Claude can see the result |
| `export_png` | Flattened PNG per frame or per layer |
| `export_spritesheet` | Packed sheet plus JSON (hash or array format) for engines like Godot, Unity, Phaser |
| `export_gif` | Animated GIF of a tag or all frames |

### Escape hatch

| Tool | Purpose |
|---|---|
| `run_lua` | Run an arbitrary Aseprite Lua script against a file, for anything the typed tools don't cover. Can be turned off in config. |

---

## Claude Code plugin packaging

The repository doubles as a Claude Code plugin, so installing it registers the MCP server automatically:

```
aseprite-mcp/
├── .claude-plugin/
│   └── plugin.json          # plugin manifest
├── .mcp.json                # registers the aseprite MCP server
├── skills/
│   └── pixel-art/SKILL.md   # guidance: palettes, readable silhouettes, animation principles, export conventions
├── server/                  # MCP server source
├── scripts/                 # one Lua script per tool
│   ├── create_sprite.lua
│   ├── draw_pixels.lua
│   └── ...
├── presets/palettes/        # bundled .gpl palettes
├── examples/
└── README.md
```

The bundled **skill** teaches Claude a sensible workflow: choose a limited palette, block out the silhouette, refine, preview, then animate. It also covers conventions such as consistent tile sizes and tag naming.

---

## Requirements

- **Aseprite 1.3 or newer.** Tilemap support and the current scripting API need it. The Steam version works.
- **Node.js 20+** (assumed implementation language: TypeScript with `@modelcontextprotocol/sdk`)
- **Claude Code**

## Installation (planned)

```bash
git clone <repo-url> aseprite-mcp
cd aseprite-mcp
npm install && npm run build

# Install as a Claude Code plugin from the local checkout
claude plugin install ./
```

Or register only the MCP server:

```bash
claude mcp add aseprite -- node /path/to/aseprite-mcp/server/dist/index.js
```

## Configuration

| Env var | Default | Description |
|---|---|---|
| `ASEPRITE_PATH` | `aseprite` on `PATH` | Path to the Aseprite binary, e.g. `~/.local/share/Steam/steamapps/common/Aseprite/aseprite` |
| `ASEPRITE_WORKSPACE` | `./sprites` | Directory where files are created and read. The server refuses paths outside it. |
| `ASEPRITE_PREVIEW_SCALE` | `8` | Nearest-neighbour upscale factor for preview images |
| `ASEPRITE_ALLOW_LUA` | `false` | Enables the `run_lua` tool |
| `ASEPRITE_TIMEOUT_MS` | `15000` | Timeout for each Aseprite invocation |

---

## Example prompts

- *"Make a 32×32 knight sprite using the Endesga 32 palette, then give it a 4-frame idle animation and export a sprite sheet for Godot."*
- *"Create a 16×16 grass/dirt/water tileset and paint a 20×15 sample map with it. Export it as Tiled JSON."*
- *"Open `slime.aseprite`, add a 6-frame `jump` tag with squash and stretch, and export a GIF."*

---

## Roadmap

1. **MVP:** `create_sprite`, `set_palette`, `add_layer`, `draw_pixels`, the shape tools, `render_preview`, `export_png`
2. **Animation:** frames, durations, tags, `export_spritesheet`, `export_gif`
3. **Tilemaps:** tilesets, tilemap layers, `set_tiles`, Tiled export
4. **Plugin polish:** pixel-art skill, bundled palettes, examples, `run_lua`
5. **Performance (stretch):** a persistent Aseprite process or batched operations, to avoid starting Aseprite once per call

## Open questions

- **Startup cost:** launching Aseprite for every call may be slow when there are many small edits. Mitigations include batching operations into one script run, or a long-lived worker.
- **Pixel input format:** what should Claude send for large drawings? Options are coordinate lists, row strings with a palette key (ASCII-art style), or a base64 PNG.
- **Engine export targets:** which formats beyond Aseprite JSON and Tiled should be first-class (Godot `.tres`, LDtk, …)?

## License

TBD
