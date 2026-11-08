-- Document-level operations: create, inspect, resize, palette, color mode.

return function(H)
  local ops = {}

  local modes = {
    rgb = ColorMode.RGB,
    indexed = ColorMode.INDEXED,
    grayscale = ColorMode.GRAY,
  }

  local function modeName(m)
    if m == ColorMode.INDEXED then return "indexed" end
    if m == ColorMode.GRAY then return "grayscale" end
    if m == ColorMode.TILEMAP then return "tilemap" end
    return "rgb"
  end

  local function setPalette(spr, colors)
    if #colors == 0 then error("palette needs at least one color") end
    local pal = Palette(#colors)
    for i, c in ipairs(colors) do
      local r, g, b, a = H.rgba(spr, c)
      pal:setColor(i - 1, Color { r = r, g = g, b = b, a = a })
    end
    spr:setPalette(pal)
  end

  local function aniDirName(d)
    if d == AniDir.REVERSE then return "reverse" end
    if d == AniDir.PING_PONG then return "pingpong" end
    if d == AniDir.PING_PONG_REVERSE then return "pingpong_reverse" end
    return "forward"
  end

  local function info(path, spr)
    local frames = {}
    for i, f in ipairs(spr.frames) do
      frames[i] = { frame = i, durationMs = math.floor(f.duration * 1000 + 0.5) }
    end

    local tilesetIndex = {}
    local tilesets = {}
    for i, ts in ipairs(spr.tilesets) do
      tilesetIndex[ts] = i - 1
      local size = ts.grid.tileSize
      tilesets[#tilesets + 1] = {
        index = i - 1,
        name = ts.name,
        tileWidth = size.width,
        tileHeight = size.height,
        tiles = #ts - 1, -- tile 0 is always the empty tile
      }
    end

    local layers = {}
    for _, l in ipairs(H.allLayers(spr)) do
      local entry = {
        name = l.name,
        type = H.layerType(l),
        visible = l.isVisible,
        opacity = l.opacity,
        parent = (l.parent and l.parent ~= spr) and l.parent.name or nil,
        background = l.isBackground or nil,
      }
      if l.blendMode then
        for k, v in pairs(BlendMode) do
          if v == l.blendMode and type(k) == "string" then entry.blendMode = k:lower() end
        end
      end
      if l.isTilemap then entry.tileset = tilesetIndex[l.tileset] end
      local celFrames = {}
      for _, cel in ipairs(l.cels) do celFrames[#celFrames + 1] = cel.frameNumber end
      entry.celFrames = celFrames
      layers[#layers + 1] = entry
    end

    local tags = {}
    for _, t in ipairs(spr.tags) do
      tags[#tags + 1] = {
        name = t.name,
        from = t.fromFrame.frameNumber,
        to = t.toFrame.frameNumber,
        direction = aniDirName(t.aniDir),
        repeats = t.repeats,
      }
    end

    local palette = H.paletteHex(spr)
    return {
      file = path,
      width = spr.width,
      height = spr.height,
      colorMode = modeName(spr.colorMode),
      transparentIndex = spr.colorMode == ColorMode.INDEXED and spr.transparentColor or nil,
      frames = frames,
      layers = layers,
      tags = tags,
      tilesets = tilesets,
      paletteSize = #palette,
      palette = palette,
    }
  end

  ops.create_sprite = function(p)
    local spr
    if p.source then
      spr = app.open(p.source)
      if not spr then error("could not open source image: " .. p.source) end
    else
      local w, h = H.int(p.width, "width"), H.int(p.height, "height")
      if not w or not h then error("width and height are required (or give a source image)") end
      local mode = modes[p.colorMode or "rgb"]
      if not mode then error("colorMode must be rgb, indexed or grayscale") end
      spr = Sprite(w, h, mode)
      spr.layers[1].name = p.layerName or "Layer 1"
    end
    if p.palette then setPalette(spr, p.palette) end
    if p.background then
      local cel = H.cel(spr, spr.layers[1], 1)
      cel.image:clear(H.pixel(spr, p.background))
    end
    H.register(p.file, spr)
    return info(p.file, spr)
  end

  ops.get_sprite_info = function(p)
    local spr = H.open(p.file)
    local res = info(p.file, spr)
    if p.includePalette == false then res.palette = nil end
    return res
  end

  ops.resize_sprite = function(p)
    local spr = H.edit(p.file)
    local w, h = H.int(p.width), H.int(p.height)
    if p.scale then
      w = math.floor(spr.width * p.scale + 0.5)
      h = math.floor(spr.height * p.scale + 0.5)
    end
    if not w or not h then error("give width and height, or scale") end
    app.command.SpriteSize { ui = false, width = w, height = h, lockRatio = false, method = p.method or "nearest" }
    return { width = spr.width, height = spr.height }
  end

  ops.crop_sprite = function(p)
    local spr = H.edit(p.file)
    spr:crop(Rectangle(H.int(p.x), H.int(p.y), H.int(p.width), H.int(p.height)))
    return { width = spr.width, height = spr.height }
  end

  ops.set_palette = function(p)
    local spr = H.edit(p.file)
    setPalette(spr, p.colors)
    return { paletteSize = #spr.palettes[1] }
  end

  ops.set_color_mode = function(p)
    local spr = H.edit(p.file)
    local fmt = ({ rgb = "rgb", indexed = "indexed", grayscale = "gray" })[p.colorMode]
    if not fmt then error("colorMode must be rgb, indexed or grayscale") end
    app.command.ChangePixelFormat { ui = false, format = fmt, dithering = p.dithering or "none" }
    return { colorMode = modeName(spr.colorMode) }
  end

  return ops
end
