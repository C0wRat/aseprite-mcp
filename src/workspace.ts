import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/**
 * Resolves a user-supplied path against the workspace root and refuses
 * anything that escapes it. Optionally creates the parent directory.
 */
export function resolveInWorkspace(root: string, p: string, opts: { mkdir?: boolean } = {}): string {
  if (typeof p !== "string" || p.trim() === "") throw new Error("path must be a non-empty string");
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path '${p}' is outside the workspace (${root}). Set ASEPRITE_WORKSPACE to allow it.`);
  }
  if (opts.mkdir) mkdirSync(dirname(abs), { recursive: true });
  return abs;
}

export function toWorkspaceRelative(root: string, abs: string): string {
  return relative(root, abs) || ".";
}

const SPRITE_EXT = /\.(aseprite|ase)$/i;

export function requireSpriteExt(p: string): void {
  if (!SPRITE_EXT.test(p)) throw new Error(`'${p}' must end in .aseprite or .ase`);
}
