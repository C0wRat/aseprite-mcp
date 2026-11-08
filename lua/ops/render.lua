-- Preview rendering: flattened frames as a scaled PNG strip that the server
-- returns to Claude as an image.

return function(H)
  local ops = {}
  local pc = app.pixelColor

  local function framesFor(spr, p)
    if p.tag then
      for _, t in ipairs(spr.tags) do
        if t.name == p.tag then
          local list = {}
          for f = t.fromFrame.frameNumber, t.toFrame.frameNumber do list[#list + 1] = f end
          return list
        end
      end
      error("tag '" .. p.tag .. "' not found")
    end
    if p.frames == "all" then
      local list = {}
      for f = 1, #spr.frames do list[#list + 1] = f end
      return list
    end
    if type(p.frames) == "table" then
      local list = {}
      for _, f in ipairs(p.frames) do list[#list + 1] = H.frame(spr, f) end
      return list
    end
    return { H.frame(spr, p.frame) }
  end

  local function renderFrame(spr, f)
    local img = Image(spr.width, spr.height, ColorMode.RGB)
    img:drawSprite(spr, f, Point(0, 0))
    return img
  end

  ops.render_preview = function(p)
    local spr = H.open(p.file)
    local frames = framesFor(spr, p)
    local w, h = spr.width, spr.height
    local gap = (#frames > 1) and 1 or 0
    local stripW = #frames * w + (#frames - 1) * gap

    local onionBefore = H.int(p.onionBefore) or 0
    local onionAfter = H.int(p.onionAfter) or 0

    local strip = Image(stripW, h, ColorMode.RGB)
    for i, f in ipairs(frames) do
      local x = (i - 1) * (w + gap)
      for k = onionBefore, 1, -1 do
        if f - k >= 1 then
          strip:drawImage(renderFrame(spr, f - k), Point(x, 0), math.floor(110 / k), BlendMode.NORMAL)
        end
      end
      for k = onionAfter, 1, -1 do
        if f + k <= #spr.frames then
          strip:drawImage(renderFrame(spr, f + k), Point(x, 0), math.floor(70 / k), BlendMode.NORMAL)
        end
      end
      strip:drawImage(renderFrame(spr, f), Point(x, 0), 255, BlendMode.NORMAL)
    end

    -- Pick a nearest-neighbour scale so the longest side stays <= maxSize.
    local maxSize = H.int(p.maxSize) or 1024
    local scale = H.int(p.scale)
    local fit = math.max(1, math.floor(maxSize / math.max(stripW, h)))
    if not scale or scale > fit then scale = math.min(fit, scale or 16) end
    local out = strip
    if scale > 1 then
      out = strip:clone()
      out:resize { width = stripW * scale, height = h * scale, method = "nearest" }
    end

    local bg = p.background or "checker"
    if bg ~= "transparent" then
      local final = Image(out.width, out.height, ColorMode.RGB)
      if bg == "checker" then
        local cell = math.max(4, scale * 2)
        local c1, c2 = pc.rgba(204, 204, 204, 255), pc.rgba(153, 153, 153, 255)
        for it in final:pixels() do
          it((((it.x // cell) + (it.y // cell)) % 2 == 0) and c1 or c2)
        end
      else
        local r, g, b = H.rgba(spr, bg)
        final:clear(pc.rgba(r, g, b, 255))
      end
      final:drawImage(out, Point(0, 0), 255, BlendMode.NORMAL)
      out = final
    end

    out:saveAs(p.out)
    return {
      image = p.out,
      frames = frames,
      scale = scale,
      width = out.width,
      height = out.height,
    }
  end

  return ops
end
