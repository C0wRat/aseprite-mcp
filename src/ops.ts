import { z } from "zod";
import { PALETTES, PALETTE_NAMES } from "./palettes.js";

/**
 * Catalogue of Lua-backed operations. Each entry becomes its own MCP tool
 * and can also be used as a step inside the `batch` tool.
 */

export type PathKind = "sprite" | "newSprite" | "input" | "output";

export interface OpSpec {
  name: string;
  title: string;
  description: string;
  shape: z.ZodRawShape;
  /** Which args are filesystem paths, and how they are treated. */
  paths?: Record<string, PathKind>;
  /** True if the op never modifies files. */
  readOnly?: boolean;
  /** Final argument transform before the args are sent to Lua. */
  prepare?: (args: Record<string, unknown>) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared argument schemas
// ---------------------------------------------------------------------------

const color = z
  .union([z.string(), z.number().int().min(0)])
  .describe('Color: "#rgb", "#rrggbb", "#rrggbbaa", a palette index (integer), or "transparent"');

const file = z.string().describe("Path to the .aseprite file, relative to the workspace");
const layer = z.string().optional().describe("Layer name. Defaults to the first image layer");
const frame = z.number().int().min(1).optional().describe("Frame number, 1-based. Default 1");

const pixelInput = {
  pixels: z
    .array(z.object({ x: z.number().int(), y: z.number().int(), color }))
    .optional()
    .describe("Explicit pixels to set"),
  rows: z
    .array(z.string())
    .optional()
    .describe(
      "ASCII-art rows, one string per pixel row. Each character is looked up in `legend`; " +
        "characters not in the legend are skipped (left unchanged). Usually the most compact way to draw.",
    ),
  legend: z
    .record(z.string(), color)
    .optional()
    .describe('Map of single characters to colors for `rows`, e.g. {"k":"#000000","r":"#ff0000"}'),
  x: z.number().int().optional().describe("X offset for `rows` (default 0)"),
  y: z.number().int().optional().describe("Y offset for `rows` (default 0)"),
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const OPS: OpSpec[] = [
  // ----- Document -----------------------------------------------------------
  {
    name: "create_sprite",
    title: "Create sprite",
    description:
      "Create a new .aseprite file (overwrites if it exists). Give width/height, or `source` to import an existing PNG/GIF/etc. " +
      `Optionally set a palette preset (${PALETTE_NAMES.join(", ")}) or explicit colors.`,
    shape: {
      file,
      width: z.number().int().min(1).max(4096).optional(),
      height: z.number().int().min(1).max(4096).optional(),
      colorMode: z.enum(["rgb", "indexed", "grayscale"]).optional().describe("Default rgb"),
      source: z.string().optional().describe("Image file to import instead of creating a blank canvas"),
      palettePreset: z.enum(PALETTE_NAMES).optional(),
      palette: z.array(color).optional().describe("Explicit palette colors (overrides palettePreset)"),
      background: color.optional().describe("Fill the first layer with this color"),
      layerName: z.string().optional().describe('Name of the first layer (default "Layer 1")'),
    },
    paths: { file: "newSprite", source: "input" },
    prepare: (a) => {
      const { palettePreset, ...rest } = a;
      if (!rest.palette && typeof palettePreset === "string") rest.palette = PALETTES[palettePreset].colors;
      return rest;
    },
  },
  {
    name: "get_sprite_info",
    title: "Get sprite info",
    description: "Describe a sprite: size, color mode, frames and durations, layers, tags, tilesets and palette.",
    shape: { file, includePalette: z.boolean().optional().describe("Default true") },
    paths: { file: "sprite" },
    readOnly: true,
  },
  {
    name: "resize_sprite",
    title: "Resize sprite",
    description: "Scale the whole sprite (all layers and frames). Uses nearest-neighbour by default.",
    shape: {
      file,
      width: z.number().int().min(1).optional(),
      height: z.number().int().min(1).optional(),
      scale: z.number().positive().optional().describe("Scale factor instead of width/height"),
      method: z.enum(["nearest", "bilinear", "rotsprite"]).optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "crop_sprite",
    title: "Crop / extend canvas",
    description:
      "Change the canvas to the rectangle (x, y, width, height) without scaling. Negative x/y or a larger size extends the canvas.",
    shape: { file, x: z.number().int(), y: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1) },
    paths: { file: "sprite" },
  },
  {
    name: "set_palette",
    title: "Set palette",
    description: `Replace the sprite palette with a preset (${PALETTE_NAMES.join(", ")}) or explicit colors.`,
    shape: {
      file,
      preset: z.enum(PALETTE_NAMES).optional(),
      colors: z.array(color).optional(),
    },
    paths: { file: "sprite" },
    prepare: (a) => {
      const { preset, ...rest } = a;
      if (!rest.colors) {
        if (typeof preset !== "string") throw new Error("give a preset or colors");
        rest.colors = PALETTES[preset].colors;
      }
      return rest;
    },
  },
  {
    name: "set_color_mode",
    title: "Set color mode",
    description: "Convert the sprite between rgb, indexed and grayscale.",
    shape: {
      file,
      colorMode: z.enum(["rgb", "indexed", "grayscale"]),
      dithering: z.enum(["none", "ordered", "old"]).optional(),
    },
    paths: { file: "sprite" },
  },

  // ----- Layers -------------------------------------------------------------
  {
    name: "add_layer",
    title: "Add layer",
    description: "Add an image layer or a group. New layers go on top unless stackIndex/parent are given.",
    shape: {
      file,
      name: z.string(),
      type: z.enum(["image", "group"]).optional(),
      parent: z.string().optional().describe("Group layer to put it in"),
      stackIndex: z.number().int().min(1).optional().describe("Position within its parent, 1 = bottom"),
      visible: z.boolean().optional(),
      opacity: z.number().int().min(0).max(255).optional(),
      blendMode: z.string().optional().describe("normal, multiply, screen, overlay, darken, lighten, addition, subtract, difference…"),
    },
    paths: { file: "sprite" },
  },
  {
    name: "remove_layer",
    title: "Remove layer",
    description: "Delete a layer (and its children, for groups).",
    shape: { file, layer: z.string() },
    paths: { file: "sprite" },
  },
  {
    name: "set_layer_props",
    title: "Set layer properties",
    description: "Rename, show/hide, change opacity or blend mode, move into a group (parent, \"\" = top level) or reorder a layer.",
    shape: {
      file,
      layer: z.string(),
      newName: z.string().optional(),
      visible: z.boolean().optional(),
      opacity: z.number().int().min(0).max(255).optional(),
      blendMode: z.string().optional(),
      parent: z.string().optional(),
      stackIndex: z.number().int().min(1).optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "duplicate_layer",
    title: "Duplicate layer",
    description: "Copy an image layer with all its cels.",
    shape: { file, layer: z.string(), newName: z.string().optional() },
    paths: { file: "sprite" },
  },

  // ----- Drawing ------------------------------------------------------------
  {
    name: "draw_pixels",
    title: "Draw pixels",
    description:
      "Set pixels on a layer/frame, either as an explicit list or as ASCII-art `rows` + `legend`. " +
      "Example: rows [\".kk.\",\"krrk\",\".kk.\"] with legend {\"k\":\"#000\",\"r\":\"#f00\"}.",
    shape: { file, layer, frame, ...pixelInput },
    paths: { file: "sprite" },
  },
  {
    name: "draw_line",
    title: "Draw line",
    description: "Draw a pixel-perfect line from (x1,y1) to (x2,y2), or a polyline through `points`.",
    shape: {
      file, layer, frame, color,
      x1: z.number().int().optional(), y1: z.number().int().optional(),
      x2: z.number().int().optional(), y2: z.number().int().optional(),
      points: z.array(z.object({ x: z.number().int(), y: z.number().int() })).optional(),
      width: z.number().int().min(1).optional().describe("Brush size in pixels (default 1)"),
    },
    paths: { file: "sprite" },
  },
  {
    name: "draw_rect",
    title: "Draw rectangle",
    description: "Draw a rectangle outline or a filled rectangle.",
    shape: {
      file, layer, frame, color,
      x: z.number().int(), y: z.number().int(),
      width: z.number().int().min(1), height: z.number().int().min(1),
      filled: z.boolean().optional(),
      lineWidth: z.number().int().min(1).optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "draw_ellipse",
    title: "Draw ellipse",
    description: "Draw an ellipse (outline or filled) inside the bounding box (x, y, width, height).",
    shape: {
      file, layer, frame, color,
      x: z.number().int(), y: z.number().int(),
      width: z.number().int().min(1), height: z.number().int().min(1),
      filled: z.boolean().optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "fill",
    title: "Flood fill",
    description: "Bucket fill starting at (x, y). contiguous=false replaces that color everywhere on the cel.",
    shape: { file, layer, frame, color, x: z.number().int(), y: z.number().int(), contiguous: z.boolean().optional() },
    paths: { file: "sprite" },
  },
  {
    name: "clear",
    title: "Clear",
    description: "Make a cel transparent: the whole cel, or the rectangle (x, y, width, height).",
    shape: {
      file, layer, frame,
      x: z.number().int().optional(), y: z.number().int().optional(),
      width: z.number().int().optional(), height: z.number().int().optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "replace_color",
    title: "Replace color",
    description: "Replace every pixel of one color with another on a cel.",
    shape: { file, layer, frame, from: color, to: color },
    paths: { file: "sprite" },
  },
  {
    name: "paste_image",
    title: "Paste image",
    description: "Paste an image file (PNG etc.) onto a cel at (x, y).",
    shape: { file, layer, frame, source: z.string(), x: z.number().int().optional(), y: z.number().int().optional() },
    paths: { file: "sprite", source: "input" },
  },
  {
    name: "read_pixels",
    title: "Read pixels",
    description:
      "Read pixels back as ASCII-art rows + legend (same format draw_pixels accepts). " +
      "Without `layer` reads the flattened visible image. Max 16384 pixels per call.",
    shape: {
      file, frame,
      layer: z.string().optional().describe("Read a single layer instead of the flattened image"),
      x: z.number().int().optional(), y: z.number().int().optional(),
      width: z.number().int().min(1).optional(), height: z.number().int().min(1).optional(),
    },
    paths: { file: "sprite" },
    readOnly: true,
  },

  // ----- Animation ----------------------------------------------------------
  {
    name: "add_frame",
    title: "Add frames",
    description:
      "Insert `count` frames after frame `after` (default: the last frame). By default they copy that frame's content, " +
      "which is a good starting point for the next animation pose.",
    shape: {
      file,
      after: z.number().int().min(1).optional(),
      count: z.number().int().min(1).max(256).optional(),
      copy: z.boolean().optional().describe("Copy content of frame `after` (default true); false = empty frames"),
      durationMs: z.number().int().min(1).optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "remove_frame",
    title: "Remove frames",
    description: "Delete a frame, or the range from..to.",
    shape: {
      file,
      frame: z.number().int().min(1).optional(),
      from: z.number().int().min(1).optional(),
      to: z.number().int().min(1).optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "copy_frame",
    title: "Copy frame",
    description: "Replace the content of frame `to` with a copy of frame `from` (all layers).",
    shape: { file, from: z.number().int().min(1), to: z.number().int().min(1) },
    paths: { file: "sprite" },
  },
  {
    name: "set_frame_duration",
    title: "Set frame duration",
    description: "Set the duration in milliseconds of the listed frames (default: all frames).",
    shape: { file, durationMs: z.number().int().min(1), frames: z.array(z.number().int().min(1)).optional() },
    paths: { file: "sprite" },
  },
  {
    name: "add_tag",
    title: "Add animation tag",
    description: "Name a frame range as an animation (e.g. idle, walk, attack).",
    shape: {
      file,
      name: z.string(),
      from: z.number().int().min(1),
      to: z.number().int().min(1),
      direction: z.enum(["forward", "reverse", "pingpong", "pingpong_reverse"]).optional(),
      repeats: z.number().int().min(0).optional().describe("0 = loop forever"),
      color: color.optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "remove_tag",
    title: "Remove tag",
    description: "Delete an animation tag (frames are kept).",
    shape: { file, name: z.string() },
    paths: { file: "sprite" },
  },
  {
    name: "move_cel",
    title: "Move cel",
    description: "Shift a layer's content on one frame by (dx, dy) pixels — handy for bobbing or sliding motion.",
    shape: { file, layer, frame, dx: z.number().int().optional(), dy: z.number().int().optional() },
    paths: { file: "sprite" },
  },

  // ----- Tilemaps -----------------------------------------------------------
  {
    name: "create_tileset",
    title: "Create tileset",
    description: "Create a tileset with the given tile size. Returns its index. Tile 0 is always the empty tile.",
    shape: {
      file,
      tileWidth: z.number().int().min(1),
      tileHeight: z.number().int().min(1),
      name: z.string().optional(),
      tiles: z.number().int().min(0).optional().describe("Number of blank tiles to pre-create (default 0)"),
    },
    paths: { file: "sprite" },
  },
  {
    name: "add_tilemap_layer",
    title: "Add tilemap layer",
    description: "Add a tilemap layer using an existing tileset (index), or a new tileset of tileWidth x tileHeight.",
    shape: {
      file,
      name: z.string(),
      tileset: z.number().int().min(0).optional(),
      tileWidth: z.number().int().min(1).optional(),
      tileHeight: z.number().int().min(1).optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "draw_tile",
    title: "Draw tile",
    description:
      "Draw pixels into tile `tile` of a tileset, in tile-local coordinates. To append a new tile use the next index " +
      "(current tile count + 1). Accepts `fill`, `pixels` and `rows`+`legend` like draw_pixels.",
    shape: {
      file,
      tileset: z.number().int().min(0).optional().describe("Tileset index (default 0)"),
      tile: z.number().int().min(1),
      fill: color.optional().describe("Fill the whole tile first"),
      clear: z.boolean().optional().describe("Clear the tile first"),
      ...pixelInput,
    },
    paths: { file: "sprite" },
  },
  {
    name: "set_tiles",
    title: "Set tiles",
    description:
      "Place tiles on a tilemap layer. `grid` is an array of rows of tile indices: 0 = empty, -1 = leave unchanged. " +
      "(col,row) offsets the grid in tile units. The map covers the canvas; extend the canvas with crop_sprite for bigger maps.",
    shape: {
      file,
      layer: z.string().optional().describe("Tilemap layer (default: first tilemap layer)"),
      frame,
      grid: z.array(z.array(z.number().int().min(-1))),
      col: z.number().int().optional(),
      row: z.number().int().optional(),
    },
    paths: { file: "sprite" },
  },
  {
    name: "get_tilemap",
    title: "Get tilemap",
    description: "Read the tile index grid of a tilemap layer.",
    shape: { file, layer: z.string().optional(), frame },
    paths: { file: "sprite" },
    readOnly: true,
  },
  {
    name: "export_tilemap",
    title: "Export tilemap",
    description:
      "Export a tilemap layer: <out>.png tileset atlas plus <out>.json map data and/or <out>.tmj (Tiled). " +
      "`out` is a path without extension.",
    shape: {
      file,
      out: z.string().describe("Output path without extension, e.g. exports/level1"),
      layer: z.string().optional(),
      frame,
      format: z.enum(["json", "tiled", "both"]).optional().describe("Default both"),
      columns: z.number().int().min(1).optional().describe("Atlas columns (default min(tiles, 16))"),
    },
    paths: { file: "sprite", out: "output" },
    readOnly: true,
  },
];

export const OP_BY_NAME = new Map(OPS.map((o) => [o.name, o]));
