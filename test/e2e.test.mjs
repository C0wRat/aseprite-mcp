// End-to-end test: launches the built server over stdio and drives it with
// the MCP client SDK against a real Aseprite install.
// Run with `npm test`. Skips when Aseprite cannot be found.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";

const server = resolve(import.meta.dirname, "../dist/server.js");
const workspace = mkdtempSync(join(tmpdir(), "aseprite-mcp-test-"));

let client;
let skip = false;

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const textPart = res.content.find((c) => c.type === "text");
  if (res.isError) throw new Error(`${name} failed: ${textPart?.text}`);
  return { json: JSON.parse(textPart.text), images: res.content.filter((c) => c.type === "image") };
}

before(async () => {
  client = new Client({ name: "e2e", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env: { ...process.env, ASEPRITE_WORKSPACE: workspace, ASEPRITE_ALLOW_LUA: "true" },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
  } catch (e) {
    skip = true;
    console.warn(`skipping e2e tests: ${e.message}`);
  }
});

after(async () => {
  await client?.close();
  rmSync(workspace, { recursive: true, force: true });
});

describe("aseprite-mcp", { timeout: 120_000 }, () => {
  it("lists tools", async (t) => {
    if (skip) return t.skip();
    const { tools } = await client.listTools();
    const names = tools.map((x) => x.name);
    for (const n of ["create_sprite", "draw_pixels", "batch", "render_preview", "export_spritesheet", "set_tiles", "run_lua"]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }
  });

  it("creates and draws a sprite, with preview", async (t) => {
    if (skip) return t.skip();
    const { json } = await call("create_sprite", { file: "hero.aseprite", width: 16, height: 16, palettePreset: "pico8" });
    assert.equal(json.result.width, 16);
    assert.equal(json.result.palette.length, 16);
    assert.ok(existsSync(join(workspace, "hero.aseprite")));

    const draw = await call("draw_pixels", {
      file: "hero.aseprite",
      rows: [".kk.", "krrk", ".kk."],
      legend: { k: "#000000", r: 8 },
      x: 6,
      y: 6,
      preview: true,
    });
    assert.equal(draw.json.result.pixels, 8);
    assert.equal(draw.images.length, 1);
    assert.equal(draw.images[0].mimeType, "image/png");

    const read = await call("read_pixels", { file: "hero.aseprite", x: 6, y: 6, width: 4, height: 3 });
    const { legend, rows } = read.json.result;
    const inv = Object.fromEntries(Object.entries(legend).map(([k, v]) => [v, k]));
    assert.equal(rows[1], `${inv["#000000"]}${inv["#ff004d"]}${inv["#ff004d"]}${inv["#000000"]}`);
  });

  it("refuses paths outside the workspace", async (t) => {
    if (skip) return t.skip();
    const res = await client.callTool({ name: "create_sprite", arguments: { file: "../escape.aseprite", width: 8, height: 8 } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /outside the workspace/);
  });

  it("builds an animation in one batch and exports it", async (t) => {
    if (skip) return t.skip();
    const { json, images } = await call("batch", {
      file: "slime.aseprite",
      ops: [
        { op: "create_sprite", args: { width: 16, height: 16, palettePreset: "sweetie16" } },
        { op: "draw_ellipse", args: { x: 3, y: 8, width: 10, height: 7, color: "#38b764", filled: true } },
        { op: "add_frame", args: { count: 3, durationMs: 120 } },
        { op: "move_cel", args: { frame: 2, dy: -1 } },
        { op: "move_cel", args: { frame: 3, dy: -2 } },
        { op: "move_cel", args: { frame: 4, dy: -1 } },
        { op: "add_tag", args: { name: "bounce", from: 1, to: 4, direction: "forward" } },
      ],
      preview: { tag: "bounce" },
    });
    assert.equal(json.results.length, 7);
    assert.equal(images.length, 1);

    const info = await call("get_sprite_info", { file: "slime.aseprite", includePalette: false });
    assert.equal(info.json.result.frames.length, 4);
    assert.equal(info.json.result.tags[0].name, "bounce");
    assert.equal(info.json.result.frames[1].durationMs, 120);

    const sheet = await call("export_spritesheet", { file: "slime.aseprite", out: "out/slime.png", scale: 2 });
    assert.deepEqual(sheet.json.tags, ["bounce"]);
    assert.equal(sheet.json.frames, 4);
    assert.ok(existsSync(join(workspace, "out/slime.png")));
    assert.ok(existsSync(join(workspace, "out/slime.json")));

    await call("export_gif", { file: "slime.aseprite", out: "out/slime.gif", tag: "bounce" });
    assert.ok(readFileSync(join(workspace, "out/slime.gif")).subarray(0, 3).toString() === "GIF");

    const png = await call("export_png", { file: "slime.aseprite", out: "out/frame.png", frame: 2 });
    assert.ok(png.json.written.length >= 1);
  });

  it("batch is all-or-nothing", async (t) => {
    if (skip) return t.skip();
    await call("create_sprite", { file: "atomic.aseprite", width: 8, height: 8 });
    const res = await client.callTool({
      name: "batch",
      arguments: {
        file: "atomic.aseprite",
        ops: [
          { op: "add_layer", args: { name: "ok" } },
          { op: "draw_pixels", args: { layer: "missing", pixels: [{ x: 0, y: 0, color: "#fff" }] } },
        ],
      },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /step 2/);
    const info = await call("get_sprite_info", { file: "atomic.aseprite" });
    assert.equal(info.json.result.layers.length, 1, "first step must not have been saved");
  });

  it("creates and exports a tilemap", async (t) => {
    if (skip) return t.skip();
    await call("batch", {
      file: "level.aseprite",
      ops: [
        { op: "create_sprite", args: { width: 32, height: 16 } },
        { op: "create_tileset", args: { tileWidth: 8, tileHeight: 8, name: "terrain" } },
        { op: "draw_tile", args: { tile: 1, fill: "#3a7d2c" } },
        { op: "draw_tile", args: { tile: 2, fill: "#6b4423", rows: ["........", ".x....x."], legend: { x: "#4a2f18" } } },
        { op: "add_tilemap_layer", args: { name: "ground", tileset: 0 } },
        { op: "set_tiles", args: { layer: "ground", grid: [[0, 0, 1, 1], [2, 2, 2, 2]] } },
      ],
    });
    const map = await call("get_tilemap", { file: "level.aseprite" });
    assert.deepEqual(map.json.result.grid, [[0, 0, 1, 1], [2, 2, 2, 2]]);

    const exp = await call("export_tilemap", { file: "level.aseprite", out: "out/level" });
    assert.equal(exp.json.result.written.length, 3);
    const tmj = JSON.parse(readFileSync(join(workspace, "out/level.tmj"), "utf8"));
    assert.deepEqual(tmj.layers[0].data, [0, 0, 1, 1, 2, 2, 2, 2]);
    assert.equal(tmj.tilesets[0].tilecount, 2);
  });

  it("handles document, layer and frame utilities", async (t) => {
    if (skip) return t.skip();
    await call("export_png", { file: "hero.aseprite", out: "src.png" });
    const { json } = await call("batch", {
      file: "misc.aseprite",
      ops: [
        { op: "create_sprite", args: { width: 8, height: 8, background: "#ffffff" } },
        { op: "add_layer", args: { name: "ink" } },
        { op: "draw_line", args: { layer: "ink", x1: 0, y1: 0, x2: 7, y2: 7, color: "#000" } },
        { op: "duplicate_layer", args: { layer: "ink", newName: "ink2" } },
        { op: "set_layer_props", args: { layer: "ink2", visible: false, opacity: 128 } },
        { op: "add_frame", args: { copy: false } },
        { op: "copy_frame", args: { from: 1, to: 2 } },
        { op: "replace_color", args: { layer: "ink", frame: 2, from: "#000", to: "#f00" } },
        { op: "crop_sprite", args: { x: -4, y: -4, width: 16, height: 16 } },
        { op: "resize_sprite", args: { scale: 2 } },
        { op: "paste_image", args: { layer: "ink", source: "src.png", x: 0, y: 0 } },
        { op: "get_sprite_info", args: { includePalette: false } },
      ],
    });
    const info = json.results.at(-1);
    assert.equal(info.width, 32);
    assert.deepEqual(info.layers.map((l) => l.name), ["Layer 1", "ink", "ink2"]);
    assert.equal(info.layers[2].visible, false);
    assert.equal(info.frames.length, 2);

    const red = await call("read_pixels", { file: "misc.aseprite", frame: 2, layer: "ink", x: 8, y: 8, width: 2, height: 2 });
    assert.ok(Object.values(red.json.result.legend).includes("#ff0000"));

    const mode = await call("set_color_mode", { file: "misc.aseprite", colorMode: "indexed" });
    assert.equal(mode.json.result.colorMode, "indexed");

    const list = await call("list_sprites");
    assert.ok(list.json.files.includes("misc.aseprite"));
  });

  it("runs custom Lua when enabled", async (t) => {
    if (skip) return t.skip();
    await call("create_sprite", { file: "lua.aseprite", width: 4, height: 4 });
    const { json } = await call("run_lua", { file: "lua.aseprite", code: "return { w = sprite.width, p = params.n * 2 }", params: { n: 21 } });
    assert.deepEqual(json.result.value, { w: 4, p: 42 });
  });
});
