import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.js";

export interface Op {
  op: string;
  args: Record<string, unknown>;
}

export interface RunResult {
  ok: boolean;
  results: unknown[];
  saved?: string[];
  error?: string;
  failedOp?: number;
  op?: string;
}

export class AsepriteError extends Error {}

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs Aseprite and resolves when the process exits. We listen for "exit"
 * rather than "close" so a helper process that inherits stdio (e.g. Steam)
 * cannot keep the call hanging.
 */
function runProcess(cfg: Config, args: string[]): Promise<ProcResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cfg.asepritePath, ["--batch", ...cfg.extraArgs, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cfg.workspace,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new AsepriteError(`Aseprite timed out after ${cfg.timeoutMs} ms`));
    }, cfg.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new AsepriteError(`failed to start Aseprite (${cfg.asepritePath}): ${err.message}`));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      // Give buffered output a moment to arrive, then detach.
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        resolvePromise({ code, stdout, stderr });
      }, 20);
    });
  });
}

/** Runs a list of Lua ops in a single Aseprite process (all-or-nothing). */
export async function runOps(cfg: Config, ops: Op[]): Promise<RunResult> {
  const dir = await mkdtemp(join(tmpdir(), "aseprite-mcp-"));
  try {
    const input = join(dir, "request.json");
    const output = join(dir, "response.json");
    await writeFile(input, JSON.stringify({ ops }));
    const proc = await runProcess(cfg, [
      "--script-param", `root=${cfg.luaDir}`,
      "--script-param", `input=${input}`,
      "--script-param", `output=${output}`,
      "--script", join(cfg.luaDir, "runner.lua"),
    ]);
    let raw: string;
    try {
      raw = await readFile(output, "utf8");
    } catch {
      throw new AsepriteError(
        `Aseprite produced no result (exit ${proc.code}).` +
          (proc.stderr || proc.stdout ? `\n${(proc.stderr + proc.stdout).trim()}` : ""),
      );
    }
    return JSON.parse(raw) as RunResult;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Runs Aseprite's own CLI (used for exports). Throws on non-zero exit. */
export async function runCli(cfg: Config, args: string[]): Promise<string> {
  const proc = await runProcess(cfg, args);
  const out = (proc.stdout + proc.stderr).trim();
  if (proc.code !== 0) throw new AsepriteError(`Aseprite exited with ${proc.code}: ${out}`);
  return out;
}
