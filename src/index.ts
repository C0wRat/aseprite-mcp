import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { cleanupPreviews, registerTools } from "./tools.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const cfg = loadConfig();
  mkdirSync(cfg.workspace, { recursive: true });

  const server = new McpServer(
    { name: "aseprite", version: VERSION },
    {
      instructions:
        "Tools for creating pixel art with Aseprite: sprites, animations and tilemaps. " +
        "Paths are relative to the workspace (" + cfg.workspace + "). " +
        "Workflow: create_sprite (with a palette) → draw (draw_pixels with ASCII rows is the most compact) → " +
        "render_preview to look at the result → refine → animate (add_frame, add_tag) → export. " +
        "Use `batch` to run many steps in one call; it is faster and all-or-nothing. " +
        "Frames are 1-based; tile 0 is the empty tile.",
    },
  );

  registerTools(server, cfg);

  const shutdown = async () => {
    await cleanupPreviews();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);

  await server.connect(new StdioServerTransport());
  console.error(`aseprite-mcp ${VERSION} ready (aseprite: ${cfg.asepritePath}, workspace: ${cfg.workspace})`);
}

main().catch((err) => {
  console.error(`aseprite-mcp: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
