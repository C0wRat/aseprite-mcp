import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, sep } from "node:path";
import { z } from "zod";
import { runCli, runOps, type Op, type RunResult } from "./aseprite.js";
import type { Config } from "./config.js";
import { OP_BY_NAME, OPS, type OpSpec } from "./ops.js";
import { PALETTES } from "./palettes.js";
import { requireSpriteExt, resolveInWorkspace, toWorkspaceRelative } from "./workspace.js";

type Args = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rewrites absolute workspace paths in results to workspace-relative ones. */
function relativize(cfg: Config, value: unknown): unknown {
  const prefix = cfg.workspace + sep;
  if (typeof value === "string") return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (Array.isArray(value)) return value.map((v) => relativize(cfg, v));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, relativize(cfg, v)]));
  }
  return value;
}

function text(cfg: Config, value: unknown): { type: "text"; text: string } {
  return { type: "text", text: typeof value === "string" ? value : JSON.stringify(relativize(cfg, value)) };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Validates args against an op spec and resolves its path arguments. */
function prepareOp(cfg: Config, spec: OpSpec, raw: Args, validate: boolean): Op {
  let args = validate ? (z.object(spec.shape).strict().parse(raw) as Args) : { ...raw };
  for (const [key, kind] of Object.entries(spec.paths ?? {})) {
    const v = args[key];
    if (v === undefined) continue;
    if (typeof v !== "string") throw new Error(`${key} must be a path string`);
    if (kind === "sprite" || kind === "newSprite") requireSpriteExt(v);
    const abs = resolveInWorkspace(cfg.workspace, v, { mkdir: kind === "newSprite" || kind === "output" });
    if (kind === "input" && !existsSync(abs)) throw new Error(`${key}: file not found: ${v}`);
    args[key] = abs;
  }
  if (spec.prepare) args = spec.prepare(args);
  return { op: spec.name, args };
}

// Preview rendering ----------------------------------------------------------

let previewDir: string | undefined;
async function previewPath(): Promise<string> {
  previewDir ??= await mkdtemp(join(tmpdir(), "aseprite-mcp-preview-"));
  return join(previewDir, `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
}

export async function cleanupPreviews(): Promise<void> {
  if (previewDir) await rm(previewDir, { recursive: true, force: true });
}

const previewShape = {
  frame: z.number().int().min(1).optional().describe("Frame to render (default 1)"),
  frames: z
    .union([z.literal("all"), z.array(z.number().int().min(1))])
    .optional()
    .describe('Render several frames side by side: a list, or "all"'),
  tag: z.string().optional().describe("Render all frames of this tag side by side"),
  scale: z.number().int().min(1).max(64).optional().describe("Nearest-neighbour zoom (auto-reduced to fit maxSize)"),
  onionBefore: z.number().int().min(0).max(3).optional().describe("Overlay this many previous frames (onion skin)"),
  onionAfter: z.number().int().min(0).max(3).optional().describe("Overlay this many following frames"),
  background: z.string().optional().describe('"checker" (default), "transparent", or a hex color'),
  maxSize: z.number().int().min(64).max(4096).optional().describe("Longest side of the preview in px (default 1024)"),
};

function previewOp(cfg: Config, file: string, opts: Args, out: string): Op {
  return {
    op: "render_preview",
    args: { scale: cfg.previewScale, ...opts, file, out },
  };
}

async function imageContent(path: string) {
  const data = (await readFile(path)).toString("base64");
  await rm(path, { force: true });
  return { type: "image" as const, data, mimeType: "image/png" };
}

/** Runs ops, optionally appending a preview render; formats an MCP result. */
async function execute(cfg: Config, ops: Op[], preview?: { file: string; opts: Args }): Promise<CallToolResult> {
  let out: string | undefined;
  const all = [...ops];
  if (preview) {
    out = await previewPath();
    all.push(previewOp(cfg, preview.file, preview.opts, out));
  }
  let res: RunResult;
  try {
    res = await runOps(cfg, all);
  } catch (e) {
    return fail(errMessage(e));
  }
  if (!res.ok) {
    const where =
      res.failedOp && all.length > 1 ? ` (step ${res.failedOp}${res.op ? `: ${res.op}` : ""}; nothing was saved)` : "";
    return fail(`Error${where}: ${res.error}`);
  }
  const results = preview ? res.results.slice(0, -1) : res.results;
  const body: Args = all.length - (preview ? 1 : 0) === 1 ? { result: results[0] } : { results };
  if (res.saved?.length) body.saved = res.saved;
  const content: CallToolResult["content"] = [text(cfg, body)];
  if (out && existsSync(out)) content.push(await imageContent(out));
  return { content };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer, cfg: Config): void {
  // One tool per Lua op ------------------------------------------------------
  for (const spec of OPS) {
    const mutating = !spec.readOnly;
    const shape = mutating
      ? {
          ...spec.shape,
          preview: z
            .boolean()
            .optional()
            .describe("Also return a rendered preview image of the result (the edited frame)"),
        }
      : spec.shape;
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: shape,
        annotations: { readOnlyHint: !mutating, destructiveHint: false, openWorldHint: false },
      },
      async (raw: Args) => {
        const { preview, ...args } = raw;
        let op: Op;
        try {
          op = prepareOp(cfg, spec, args, false);
        } catch (e) {
          return fail(errMessage(e));
        }
        const pv = preview
          ? { file: op.args.file as string, opts: typeof args.frame === "number" ? { frame: args.frame } : {} }
          : undefined;
        return execute(cfg, [op], pv);
      },
    );
  }

  // render_preview -----------------------------------------------------------
  server.registerTool(
    "render_preview",
    {
      title: "Render preview",
      description:
        "Render a frame, several frames, or a tag as a zoomed PNG and return it as an image so you can see the sprite. " +
        "Use onion skin options to compare animation frames.",
      inputSchema: {
        file: z.string().describe("Path to the .aseprite file"),
        ...previewShape,
        saveAs: z.string().optional().describe("Also save the preview PNG to this workspace path"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ file, saveAs, ...opts }) => {
      let abs: string;
      let keep: string | undefined;
      try {
        requireSpriteExt(file);
        abs = resolveInWorkspace(cfg.workspace, file);
        if (saveAs) keep = resolveInWorkspace(cfg.workspace, saveAs, { mkdir: true });
      } catch (e) {
        return fail(errMessage(e));
      }
      const out = await previewPath();
      let res: RunResult;
      try {
        res = await runOps(cfg, [previewOp(cfg, abs, opts, out)]);
      } catch (e) {
        return fail(errMessage(e));
      }
      if (!res.ok) return fail(`Error: ${res.error}`);
      if (keep) await copyFile(out, keep);
      const info = { ...(res.results[0] as Args), image: keep ?? undefined };
      return { content: [text(cfg, info), await imageContent(out)] };
    },
  );

  // batch --------------------------------------------------------------------
  const opNames = OPS.map((o) => o.name) as [string, ...string[]];
  server.registerTool(
    "batch",
    {
      title: "Batch operations",
      description:
        "Run many operations in ONE Aseprite process — much faster than separate calls, and all-or-nothing " +
        "(if any step fails nothing is saved). Each step is {op, args} where op is any single-operation tool name " +
        "and args are that tool's arguments. `file` given here is used for steps that omit it. " +
        "Set `preview` to get a rendered image of the result at the end.",
      inputSchema: {
        file: z.string().optional().describe("Default .aseprite file for steps that don't give one"),
        ops: z
          .array(z.object({ op: z.enum(opNames), args: z.record(z.string(), z.unknown()).optional() }))
          .min(1)
          .max(500),
        preview: z
          .union([z.boolean(), z.object(previewShape)])
          .optional()
          .describe("true, or preview options (frame/frames/tag/scale/onion…), to render the file at the end"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ file, ops, preview }) => {
      const prepared: Op[] = [];
      try {
        ops.forEach((step, i) => {
          const spec = OP_BY_NAME.get(step.op)!;
          const args: Args = { ...(step.args ?? {}) };
          if (args.file === undefined && file !== undefined && "file" in spec.shape) args.file = file;
          try {
            prepared.push(prepareOp(cfg, spec, args, true));
          } catch (e) {
            const msg =
              e instanceof z.ZodError
                ? e.issues.map((iss) => `${iss.path.join(".") || "(args)"}: ${iss.message}`).join("; ")
                : errMessage(e);
            throw new Error(`step ${i + 1} (${step.op}): ${msg}`);
          }
        });
      } catch (e) {
        return fail(errMessage(e));
      }
      let pv: { file: string; opts: Args } | undefined;
      if (preview) {
        const target = file ?? [...ops].reverse().find((s) => typeof s.args?.file === "string")?.args?.file;
        if (typeof target !== "string") return fail("preview needs a file (set the top-level `file`)");
        try {
          requireSpriteExt(target);
          pv = { file: resolveInWorkspace(cfg.workspace, target), opts: preview === true ? {} : preview };
        } catch (e) {
          return fail(errMessage(e));
        }
      }
      return execute(cfg, prepared, pv);
    },
  );

  // Exports via the Aseprite CLI ---------------------------------------------
  registerExports(server, cfg);

  // Utilities ------------------------------------------------------------------
  server.registerTool(
    "list_palettes",
    {
      title: "List palette presets",
      description: "List built-in palette presets with their colors.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({ content: [text(cfg, PALETTES)] }),
  );

  server.registerTool(
    "list_sprites",
    {
      title: "List sprites",
      description: "List .aseprite/.ase files in the workspace (or a sub-directory).",
      inputSchema: { dir: z.string().optional().describe("Sub-directory to search (default: workspace root)") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ dir }) => {
      try {
        const root = resolveInWorkspace(cfg.workspace, dir ?? ".");
        const entries = await readdir(root, { recursive: true, withFileTypes: true });
        const files = entries
          .filter((e) => e.isFile() && /\.(aseprite|ase)$/i.test(e.name))
          .map((e) => toWorkspaceRelative(cfg.workspace, join(e.parentPath, e.name)))
          .filter((p) => !p.split(sep).some((s) => s === "node_modules" || s.startsWith(".")))
          .sort();
        return { content: [text(cfg, { workspace: cfg.workspace, files })] };
      } catch (e) {
        return fail(errMessage(e));
      }
    },
  );

  // run_lua (opt-in) -----------------------------------------------------------
  if (cfg.allowLua) {
    server.registerTool(
      "run_lua",
      {
        title: "Run Aseprite Lua",
        description:
          "Run arbitrary Aseprite Lua (https://www.aseprite.org/api/) for anything the other tools don't cover. " +
          "Globals: `sprite` (opened from `file`, saved afterwards), `params` (your JSON), `H` (helper library), " +
          "plus the full Aseprite API. The returned value is sent back as JSON.",
        inputSchema: {
          code: z.string(),
          file: z.string().optional(),
          params: z.unknown().optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async ({ code, file, params }) => {
        const args: Args = { code, params };
        try {
          if (file) {
            requireSpriteExt(file);
            args.file = resolveInWorkspace(cfg.workspace, file);
          }
        } catch (e) {
          return fail(errMessage(e));
        }
        return execute(cfg, [{ op: "run_lua", args }]);
      },
    );
  }
}

// ---------------------------------------------------------------------------
// CLI exports
// ---------------------------------------------------------------------------

function registerExports(server: McpServer, cfg: Config): void {
  const exportAnn = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  /** Lists files in `dir` that were (re)written at or after `since`. */
  async function writtenSince(dir: string, since: number): Promise<string[]> {
    const { stat } = await import("node:fs/promises");
    const names = await readdir(dir);
    const out: string[] = [];
    for (const n of names) {
      const p = join(dir, n);
      const s = await stat(p);
      if (s.isFile() && s.mtimeMs >= since - 1000) out.push(toWorkspaceRelative(cfg.workspace, p));
    }
    return out.sort();
  }

  function common(file: string) {
    requireSpriteExt(file);
    const abs = resolveInWorkspace(cfg.workspace, file);
    if (!existsSync(abs)) throw new Error(`file not found: ${file}`);
    return abs;
  }

  function selection(a: { layer?: string; tag?: string; frame?: number; fromFrame?: number; toFrame?: number }) {
    const pre: string[] = [];
    if (a.layer) pre.push("--layer", a.layer);
    if (a.tag) pre.push("--tag", a.tag);
    const from = a.frame ?? a.fromFrame;
    const to = a.frame ?? a.toFrame ?? from;
    if (from !== undefined) pre.push("--frame-range", `${from - 1},${(to ?? from) - 1}`);
    return pre;
  }

  const selShape = {
    file: z.string().describe("Path to the .aseprite file"),
    layer: z.string().optional().describe("Export only this layer"),
    tag: z.string().optional().describe("Export only the frames of this tag"),
    fromFrame: z.number().int().min(1).optional(),
    toFrame: z.number().int().min(1).optional(),
    scale: z.number().int().min(1).max(32).optional().describe("Integer upscale (nearest-neighbour)"),
  };

  server.registerTool(
    "export_png",
    {
      title: "Export PNG",
      description:
        "Export flattened PNG image(s). `out` may contain {frame}, {layer} or {tag} placeholders, " +
        "e.g. exports/hero_{frame}.png. When several frames are exported without {frame}, Aseprite numbers the files.",
      inputSchema: {
        ...selShape,
        frame: z.number().int().min(1).optional().describe("Export a single frame"),
        out: z.string().describe("Output .png path"),
        splitLayers: z.boolean().optional().describe("One image per visible layer (use {layer} in out)"),
        trim: z.boolean().optional().describe("Trim transparent borders"),
      },
      annotations: exportAnn,
    },
    async (a) => {
      try {
        const src = common(a.file);
        const out = resolveInWorkspace(cfg.workspace, a.out, { mkdir: true });
        const args = [...selection(a)];
        if (a.splitLayers) args.push("--split-layers");
        if (a.trim) args.push("--trim");
        args.push(src);
        if (a.scale && a.scale > 1) args.push("--scale", String(a.scale));
        args.push("--save-as", out);
        const since = Date.now();
        await runCli(cfg, args);
        return { content: [text(cfg, { written: await writtenSince(dirname(out), since) })] };
      } catch (e) {
        return fail(errMessage(e));
      }
    },
  );

  server.registerTool(
    "export_spritesheet",
    {
      title: "Export sprite sheet",
      description:
        "Export a sprite sheet PNG plus JSON metadata (frames, durations, tags, layers) for game engines " +
        "such as Godot, Unity, Phaser or LÖVE.",
      inputSchema: {
        ...selShape,
        out: z.string().describe("Output sheet .png path"),
        data: z.string().optional().describe("Output .json path (default: same name as out with .json)"),
        format: z.enum(["json-hash", "json-array"]).optional().describe("Default json-hash"),
        sheetType: z.enum(["horizontal", "vertical", "rows", "columns", "packed"]).optional().describe("Default rows"),
        columns: z.number().int().min(1).optional().describe("Columns for sheetType rows"),
        rows: z.number().int().min(1).optional().describe("Rows for sheetType columns"),
        splitLayers: z.boolean().optional(),
        trim: z.boolean().optional(),
        padding: z.number().int().min(0).optional().describe("Shape padding between frames"),
        borderPadding: z.number().int().min(0).optional(),
        extrude: z.boolean().optional().describe("Duplicate edge pixels to avoid bleeding"),
        mergeDuplicates: z.boolean().optional(),
        ignoreEmpty: z.boolean().optional(),
        powerOfTwo: z.boolean().optional(),
        noData: z.boolean().optional().describe("Write only the PNG, no JSON"),
      },
      annotations: exportAnn,
    },
    async (a) => {
      try {
        const src = common(a.file);
        const out = resolveInWorkspace(cfg.workspace, a.out, { mkdir: true });
        const data = a.noData
          ? undefined
          : resolveInWorkspace(cfg.workspace, a.data ?? a.out.replace(/\.[^./\\]+$/, "") + ".json", { mkdir: true });
        const args = [...selection(a)];
        if (a.splitLayers) args.push("--split-layers");
        if (a.trim) args.push("--trim");
        if (a.ignoreEmpty) args.push("--ignore-empty");
        if (a.mergeDuplicates) args.push("--merge-duplicates");
        if (a.extrude) args.push("--extrude");
        if (a.padding !== undefined) args.push("--shape-padding", String(a.padding));
        if (a.borderPadding !== undefined) args.push("--border-padding", String(a.borderPadding));
        args.push(src);
        if (a.scale && a.scale > 1) args.push("--scale", String(a.scale));
        args.push("--sheet", out, "--sheet-type", a.sheetType ?? "rows");
        if (a.columns) args.push("--sheet-columns", String(a.columns));
        if (a.rows) args.push("--sheet-rows", String(a.rows));
        if (a.powerOfTwo) args.push("--power-of-two-size");
        if (data) args.push("--data", data, "--format", a.format ?? "json-hash", "--list-tags", "--list-layers");
        await runCli(cfg, args);
        const written = [out, ...(data ? [data] : [])].filter((p) => existsSync(p));
        let summary: Args = {};
        if (data && existsSync(data)) {
          const meta = JSON.parse(await readFile(data, "utf8"));
          const frames = Array.isArray(meta.frames) ? meta.frames.length : Object.keys(meta.frames ?? {}).length;
          summary = { frames, size: meta.meta?.size, tags: (meta.meta?.frameTags ?? []).map((t: Args) => t.name) };
        }
        return { content: [text(cfg, { written, ...summary })] };
      } catch (e) {
        return fail(errMessage(e));
      }
    },
  );

  server.registerTool(
    "export_gif",
    {
      title: "Export animated GIF",
      description: "Export an animated GIF (or .webp) using the sprite's frame durations. Use `tag` for one animation.",
      inputSchema: { ...selShape, out: z.string().describe("Output .gif or .webp path") },
      annotations: exportAnn,
    },
    async (a) => {
      try {
        const ext = extname(a.out).toLowerCase();
        if (ext !== ".gif" && ext !== ".webp") throw new Error("out must end in .gif or .webp");
        const src = common(a.file);
        const out = resolveInWorkspace(cfg.workspace, a.out, { mkdir: true });
        const args = [...selection(a), src];
        if (a.scale && a.scale > 1) args.push("--scale", String(a.scale));
        args.push("--save-as", out);
        await runCli(cfg, args);
        if (!existsSync(out)) throw new Error(`Aseprite did not write ${basename(out)}`);
        return { content: [text(cfg, { written: [out] })] };
      } catch (e) {
        return fail(errMessage(e));
      }
    },
  );
}
