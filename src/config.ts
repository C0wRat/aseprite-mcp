import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  asepritePath: string;
  /** Extra flags passed to every Aseprite invocation (e.g. --noinapp for Steam). */
  extraArgs: string[];
  workspace: string;
  luaDir: string;
  previewScale: number;
  allowLua: boolean;
  timeoutMs: number;
}

const home = homedir();

const CANDIDATES = [
  // Linux (Steam)
  join(home, ".local/share/Steam/steamapps/common/Aseprite/aseprite"),
  join(home, ".steam/steam/steamapps/common/Aseprite/aseprite"),
  join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common/Aseprite/aseprite"),
  // Linux (system / self-built)
  "/usr/bin/aseprite",
  "/usr/local/bin/aseprite",
  join(home, ".local/bin/aseprite"),
  // macOS
  "/Applications/Aseprite.app/Contents/MacOS/aseprite",
  join(home, "Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app/Contents/MacOS/aseprite"),
  // Windows
  "C:\\Program Files\\Aseprite\\Aseprite.exe",
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite\\Aseprite.exe",
  "C:\\Program Files\\Steam\\steamapps\\common\\Aseprite\\Aseprite.exe",
];

function findOnPath(name: string): string | undefined {
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (dir && existsSync(p)) return p;
    }
  }
  return undefined;
}

export function findAseprite(): string | undefined {
  const fromEnv = process.env.ASEPRITE_PATH;
  if (fromEnv) return fromEnv.replace(/^~(?=\/|$)/, home);
  return findOnPath("aseprite") ?? CANDIDATES.find((p) => existsSync(p));
}

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : dflt;
}

export function loadConfig(): Config {
  const asepritePath = findAseprite();
  if (!asepritePath) {
    throw new Error(
      "Aseprite not found. Set ASEPRITE_PATH to the aseprite executable " +
        "(e.g. ~/.local/share/Steam/steamapps/common/Aseprite/aseprite).",
    );
  }
  // Steam builds ship steam_appid.txt next to the binary; --noinapp keeps
  // headless runs from registering as Steam playtime.
  const isSteam = existsSync(join(dirname(asepritePath), "steam_appid.txt"));

  // dist/server.js -> ../lua ; src/config.ts (tsx/dev) -> ../lua
  const here = dirname(fileURLToPath(import.meta.url));
  const luaDir = process.env.ASEPRITE_LUA_DIR ?? resolve(here, "..", "lua");

  return {
    asepritePath,
    extraArgs: isSteam ? ["--noinapp"] : [],
    workspace: resolve((process.env.ASEPRITE_WORKSPACE ?? process.cwd()).replace(/^~(?=\/|$)/, home)),
    luaDir,
    previewScale: num(process.env.ASEPRITE_PREVIEW_SCALE, 8),
    allowLua: bool(process.env.ASEPRITE_ALLOW_LUA, false),
    timeoutMs: num(process.env.ASEPRITE_TIMEOUT_MS, 30000),
  };
}
