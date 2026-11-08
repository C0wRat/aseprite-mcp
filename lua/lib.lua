-- Shared helpers for aseprite-mcp operation modules.
-- Loaded once per Aseprite invocation by runner.lua.

local H = {}

---------------------------------------------------------------------------
-- Sprite cache: every file touched in one invocation is opened once, and
-- dirty sprites are saved together at the end (only if every op succeeded).
---------------------------------------------------------------------------

H.cache = {}

function H.open(path)
  local entry = H.cache[path]
  if entry then return entry.sprite end
  if not app.fs.isFile(path) then
    error("file not found: " .. path)
  end
  local spr = app.open(path)
  if not spr then error("could not open: " .. path) end
  H.cache[path] = { sprite = spr, dirty = false }
  return spr
end

-- Open a sprite that the current op will modify.
function H.edit(path)
  local spr = H.open(path)
  H.cache[path].dirty = true
  app.sprite = spr
  return spr
end

function H.register(path, spr)
  local old = H.cache[path]
  if old and old.sprite ~= spr then old.sprite:close() end
  H.cache[path] = { sprite = spr, dirty = true }
  app.sprite = spr
end

function H.saveAll()
  local saved = {}
  for path, entry in pairs(H.cache) do
    if entry.dirty then
      entry.sprite:saveAs(path)
      saved[#saved + 1] = path
    end
  end
  return saved
end

function H.closeAll()
  for _, entry in pairs(H.cache) do
    pcall(function() entry.sprite:close() end)
  end
  H.cache = {}
end

---------------------------------------------------------------------------
-- Numbers
---------------------------------------------------------------------------

function H.int(v, name)
  if v == nil then return nil end
  local n = math.tointeger(v)
  if n == nil then error((name or "value") .. " must be an integer, got " .. tostring(v)) end
  return n
end

---------------------------------------------------------------------------
-- Layers and frames
---------------------------------------------------------------------------

local function walk(layers, out)
  for _, l in ipairs(layers) do
    out[#out + 1] = l
    if l.isGroup then walk(l.layers, out) end
  end
  return out
end

function H.allLayers(spr)
  return walk(spr.layers, {})
end

function H.layerType(l)
  if l.isGroup then return "group" end
  if l.isTilemap then return "tilemap" end
  return "image"
end

local function layerNames(spr)
  local names = {}
  for _, l in ipairs(H.allLayers(spr)) do names[#names + 1] = l.name end
  return table.concat(names, ", ")
end

function H.findLayer(spr, name)
  for _, l in ipairs(H.allLayers(spr)) do
    if l.name == name then return l end
  end
  return nil
end

-- kind: "image" | "tilemap" | "any". When name is nil, picks the first
-- (top-most in the list order) layer of that kind.
function H.layer(spr, name, kind)
  kind = kind or "image"
  local l
  if name ~= nil then
    l = H.findLayer(spr, name)
    if not l then error("layer '" .. name .. "' not found. Layers: " .. layerNames(spr)) end
  else
    for _, cand in ipairs(H.allLayers(spr)) do
      local t = H.layerType(cand)
      if (kind == "any" and t ~= "group") or t == kind then l = cand break end
    end
    if not l then error("no " .. kind .. " layer in sprite. Layers: " .. layerNames(spr)) end
  end
  local t = H.layerType(l)
  if kind ~= "any" and t ~= kind then
    if t == "tilemap" then
      error("layer '" .. l.name .. "' is a tilemap layer; use draw_tile / set_tiles instead")
    end
    error("layer '" .. l.name .. "' is a " .. t .. " layer, expected " .. kind)
  end
  return l
end

function H.frame(spr, n)
  n = H.int(n, "frame") or 1
  if n < 1 or n > #spr.frames then
    error("frame " .. n .. " out of range (sprite has " .. #spr.frames .. " frames)")
  end
  return n
end

---------------------------------------------------------------------------
-- Colors
---------------------------------------------------------------------------

local function parseHex(s)
  local h = s:gsub("^#", "")
  if not h:match("^%x+$") then return nil end
  if #h == 3 or #h == 4 then
    local r = tonumber(h:sub(1, 1), 16) * 17
    local g = tonumber(h:sub(2, 2), 16) * 17
    local b = tonumber(h:sub(3, 3), 16) * 17
    local a = #h == 4 and tonumber(h:sub(4, 4), 16) * 17 or 255
    return r, g, b, a
  elseif #h == 6 or #h == 8 then
    local r = tonumber(h:sub(1, 2), 16)
    local g = tonumber(h:sub(3, 4), 16)
    local b = tonumber(h:sub(5, 6), 16)
    local a = #h == 8 and tonumber(h:sub(7, 8), 16) or 255
    return r, g, b, a
  end
  return nil
end

-- Returns r, g, b, a (0-255) for a color spec, relative to a sprite palette.
function H.rgba(spr, c)
  if c == nil or c == "transparent" then return 0, 0, 0, 0 end
  if type(c) == "number" then
    local idx = H.int(c, "palette index")
    local pal = spr.palettes[1]
    if idx < 0 or idx >= #pal then
      error("palette index " .. idx .. " out of range (palette has " .. #pal .. " colors)")
    end
    local col = pal:getColor(idx)
    return col.red, col.green, col.blue, col.alpha
  end
  if type(c) == "table" then
    return H.int(c.r or 0), H.int(c.g or 0), H.int(c.b or 0), H.int(c.a or 255)
  end
  local r, g, b, a = parseHex(tostring(c))
  if not r then
    error("invalid color '" .. tostring(c) .. "' (use #rgb, #rrggbb, #rrggbbaa, a palette index, or \"transparent\")")
  end
  return r, g, b, a
end

local function nearestIndex(spr, r, g, b)
  local pal = spr.palettes[1]
  local best, bestD = 0, math.huge
  for i = 0, #pal - 1 do
    if i ~= spr.transparentColor then
      local col = pal:getColor(i)
      local dr, dg, db = col.red - r, col.green - g, col.blue - b
      local d = dr * dr + dg * dg + db * db
      if d < bestD then best, bestD = i, d end
      if d == 0 then break end
    end
  end
  return best
end

-- Converts a color spec to a raw pixel value for the sprite's color mode.
function H.pixel(spr, c)
  local mode = spr.colorMode
  if mode == ColorMode.INDEXED then
    if c == nil or c == "transparent" then return spr.transparentColor end
    if type(c) == "number" then
      local _ = H.rgba(spr, c) -- range check
      return H.int(c)
    end
    local r, g, b, a = H.rgba(spr, c)
    if a == 0 then return spr.transparentColor end
    return nearestIndex(spr, r, g, b)
  end
  local r, g, b, a = H.rgba(spr, c)
  if mode == ColorMode.GRAY then
    local v = math.floor(0.299 * r + 0.587 * g + 0.114 * b + 0.5)
    return app.pixelColor.graya(v, a)
  end
  return app.pixelColor.rgba(r, g, b, a)
end

-- Converts a raw pixel value in the given color mode to r, g, b, a.
function H.unpack(spr, mode, v)
  local pc = app.pixelColor
  if mode == ColorMode.INDEXED then
    if v == spr.transparentColor then return 0, 0, 0, 0 end
    local col = spr.palettes[1]:getColor(v)
    return col.red, col.green, col.blue, col.alpha
  elseif mode == ColorMode.GRAY then
    local g = pc.grayaV(v)
    return g, g, g, pc.grayaA(v)
  end
  return pc.rgbaR(v), pc.rgbaG(v), pc.rgbaB(v), pc.rgbaA(v)
end

function H.hex(r, g, b, a)
  if a == 255 then return string.format("#%02x%02x%02x", r, g, b) end
  return string.format("#%02x%02x%02x%02x", r, g, b, a)
end

function H.paletteHex(spr)
  local pal = spr.palettes[1]
  local out = {}
  for i = 0, #pal - 1 do
    local c = pal:getColor(i)
    out[#out + 1] = H.hex(c.red, c.green, c.blue, c.alpha)
  end
  return out
end

-- Returns an RGB copy of an image (indexed / gray images are converted).
function H.toRGB(spr, img)
  if img.colorMode == ColorMode.RGB then return img end
  local out = Image(img.width, img.height, ColorMode.RGB)
  local mode = img.colorMode
  for it in img:pixels() do
    local r, g, b, a = H.unpack(spr, mode, it())
    out:drawPixel(it.x, it.y, app.pixelColor.rgba(r, g, b, a))
  end
  return out
end

-- Converts an RGB image to the sprite's color mode (for pasting).
function H.fromRGB(spr, img)
  if spr.colorMode == ColorMode.RGB then return img end
  local out = Image(img.width, img.height, spr.colorMode)
  out:clear(spr.colorMode == ColorMode.INDEXED and spr.transparentColor or 0)
  local pc = app.pixelColor
  for it in img:pixels() do
    local v = it()
    local hexs = H.hex(pc.rgbaR(v), pc.rgbaG(v), pc.rgbaB(v), pc.rgbaA(v))
    out:drawPixel(it.x, it.y, H.pixel(spr, pc.rgbaA(v) == 0 and "transparent" or hexs))
  end
  return out
end

---------------------------------------------------------------------------
-- Cels
---------------------------------------------------------------------------

function H.blank(spr, w, h)
  local img = Image(w or spr.width, h or spr.height, spr.colorMode)
  img:clear(spr.colorMode == ColorMode.INDEXED and spr.transparentColor or 0)
  return img
end

-- Returns a cel on an image layer whose image covers the whole canvas at
-- (0,0), so callers can draw with canvas coordinates. Creates it if needed.
function H.cel(spr, layer, frameNo)
  local cel = layer:cel(frameNo)
  if not cel then
    return spr:newCel(layer, frameNo, H.blank(spr), Point(0, 0))
  end
  local b = cel.bounds
  if b.x ~= 0 or b.y ~= 0 or b.width ~= spr.width or b.height ~= spr.height then
    local img = H.blank(spr)
    img:drawImage(cel.image, cel.position)
    cel.image = img
    cel.position = Point(0, 0)
  end
  return cel
end

---------------------------------------------------------------------------
-- Pixel input: explicit pixel lists and "row strings + legend" (ASCII art).
---------------------------------------------------------------------------

-- Calls put(x, y, pixelValue) for every pixel described by p.pixels and/or
-- p.rows + p.legend. Rows are offset by p.x / p.y. Characters missing from
-- the legend are skipped (left unchanged). Returns the number of pixels.
function H.eachInputPixel(spr, p, put)
  local count = 0
  if p.pixels then
    for _, px in ipairs(p.pixels) do
      put(H.int(px.x, "x"), H.int(px.y, "y"), H.pixel(spr, px.color))
      count = count + 1
    end
  end
  if p.rows then
    local legend = {}
    for k, v in pairs(p.legend or {}) do
      if #k ~= 1 then error("legend keys must be single ASCII characters, got '" .. k .. "'") end
      legend[k] = H.pixel(spr, v)
    end
    local ox, oy = H.int(p.x) or 0, H.int(p.y) or 0
    for ry, row in ipairs(p.rows) do
      for rx = 1, #row do
        local v = legend[row:sub(rx, rx)]
        if v ~= nil then
          put(ox + rx - 1, oy + ry - 1, v)
          count = count + 1
        end
      end
    end
  end
  return count
end

return H
