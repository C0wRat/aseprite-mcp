-- Drawing on image layers. All coordinates are canvas pixels, origin top-left.

return function(H)
  local ops = {}

  -- Resolves file/layer/frame and returns sprite, cel image and a clipped
  -- putPixel function.
  local function target(p)
    local spr = H.edit(p.file)
    local layer = H.layer(spr, p.layer, "image")
    local frame = H.frame(spr, p.frame)
    local img = H.cel(spr, layer, frame).image
    local w, h = img.width, img.height
    local function put(x, y, v)
      if x >= 0 and y >= 0 and x < w and y < h then img:drawPixel(x, y, v) end
    end
    return spr, img, put, layer, frame
  end

  local function brush(put, size)
    size = H.int(size) or 1
    if size <= 1 then return put end
    local off = size // 2
    return function(x, y, v)
      for dy = 0, size - 1 do
        for dx = 0, size - 1 do put(x + dx - off, y + dy - off, v) end
      end
    end
  end

  local function line(put, x0, y0, x1, y1, v)
    local dx, dy = math.abs(x1 - x0), -math.abs(y1 - y0)
    local sx = x0 < x1 and 1 or -1
    local sy = y0 < y1 and 1 or -1
    local err = dx + dy
    while true do
      put(x0, y0, v)
      if x0 == x1 and y0 == y1 then break end
      local e2 = 2 * err
      if e2 >= dy then err = err + dy; x0 = x0 + sx end
      if e2 <= dx then err = err + dx; y0 = y0 + sy end
    end
  end

  ops.draw_pixels = function(p)
    local spr, _, put = target(p)
    local n = H.eachInputPixel(spr, p, put)
    return { pixels = n }
  end

  ops.draw_line = function(p)
    local spr, _, put = target(p)
    local v = H.pixel(spr, p.color)
    local pts = p.points or { { x = p.x1, y = p.y1 }, { x = p.x2, y = p.y2 } }
    local b = brush(put, p.width)
    for i = 1, #pts - 1 do
      line(b, H.int(pts[i].x), H.int(pts[i].y), H.int(pts[i + 1].x), H.int(pts[i + 1].y), v)
    end
    return { segments = #pts - 1 }
  end

  ops.draw_rect = function(p)
    local spr, _, put = target(p)
    local v = H.pixel(spr, p.color)
    local x, y, w, h = H.int(p.x), H.int(p.y), H.int(p.width), H.int(p.height)
    if p.filled then
      for yy = y, y + h - 1 do
        for xx = x, x + w - 1 do put(xx, yy, v) end
      end
    else
      local b = brush(put, p.lineWidth)
      line(b, x, y, x + w - 1, y, v)
      line(b, x, y + h - 1, x + w - 1, y + h - 1, v)
      line(b, x, y, x, y + h - 1, v)
      line(b, x + w - 1, y, x + w - 1, y + h - 1, v)
    end
    return {}
  end

  -- Ellipse inside the bounding box (x, y, width, height).
  ops.draw_ellipse = function(p)
    local spr, _, put = target(p)
    local v = H.pixel(spr, p.color)
    local x, y, w, h = H.int(p.x), H.int(p.y), H.int(p.width), H.int(p.height)
    local cx, cy = x + w / 2, y + h / 2
    local rx, ry = w / 2, h / 2
    local function inside(px, py)
      local nx = (px + 0.5 - cx) / rx
      local ny = (py + 0.5 - cy) / ry
      return nx * nx + ny * ny <= 1.0
    end
    for yy = y, y + h - 1 do
      for xx = x, x + w - 1 do
        if inside(xx, yy) then
          if p.filled
            or not inside(xx - 1, yy) or not inside(xx + 1, yy)
            or not inside(xx, yy - 1) or not inside(xx, yy + 1) then
            put(xx, yy, v)
          end
        end
      end
    end
    return {}
  end

  ops.fill = function(p)
    local spr, img = target(p)
    local v = H.pixel(spr, p.color)
    local x, y = H.int(p.x), H.int(p.y)
    local w, h = img.width, img.height
    if x < 0 or y < 0 or x >= w or y >= h then error("fill point outside canvas") end
    local from = img:getPixel(x, y)
    if from == v then return { pixels = 0 } end
    local n = 0
    if p.contiguous == false then
      for it in img:pixels() do
        if it() == from then it(v); n = n + 1 end
      end
      return { pixels = n }
    end
    local stack = { { x, y } }
    while #stack > 0 do
      local pt = table.remove(stack)
      local px, py = pt[1], pt[2]
      if px >= 0 and py >= 0 and px < w and py < h and img:getPixel(px, py) == from then
        img:drawPixel(px, py, v)
        n = n + 1
        stack[#stack + 1] = { px + 1, py }
        stack[#stack + 1] = { px - 1, py }
        stack[#stack + 1] = { px, py + 1 }
        stack[#stack + 1] = { px, py - 1 }
      end
    end
    return { pixels = n }
  end

  ops.clear = function(p)
    local spr, img, put = target(p)
    local v = H.pixel(spr, "transparent")
    if p.x == nil then
      img:clear(v)
    else
      for yy = H.int(p.y), H.int(p.y) + H.int(p.height) - 1 do
        for xx = H.int(p.x), H.int(p.x) + H.int(p.width) - 1 do put(xx, yy, v) end
      end
    end
    return {}
  end

  ops.replace_color = function(p)
    local spr, img = target(p)
    local from, to = H.pixel(spr, p.from), H.pixel(spr, p.to)
    local n = 0
    for it in img:pixels() do
      if it() == from then it(to); n = n + 1 end
    end
    return { pixels = n }
  end

  ops.paste_image = function(p)
    local spr, img = target(p)
    local src = Image { fromFile = p.source }
    if not src then error("could not load image: " .. p.source) end
    if src.colorMode ~= ColorMode.RGB then
      local spr2 = Sprite { fromFile = p.source }
      src = H.toRGB(spr2, src)
      spr2:close()
    end
    src = H.fromRGB(spr, src)
    img:drawImage(src, Point(H.int(p.x) or 0, H.int(p.y) or 0), 255, BlendMode.NORMAL)
    return { width = src.width, height = src.height }
  end

  -- Read pixels back as row strings + legend (the same format draw_pixels
  -- accepts). Without a layer, reads the flattened (visible) frame.
  ops.read_pixels = function(p)
    local spr = H.open(p.file)
    local frame = H.frame(spr, p.frame)
    local src
    if p.layer then
      local layer = H.layer(spr, p.layer, "image")
      src = H.blank(spr)
      local cel = layer:cel(frame)
      if cel then src:drawImage(cel.image, cel.position) end
      src = H.toRGB(spr, src)
    else
      src = Image(spr.width, spr.height, ColorMode.RGB)
      src:drawSprite(spr, frame, Point(0, 0))
    end
    local x, y = H.int(p.x) or 0, H.int(p.y) or 0
    local w = H.int(p.width) or (spr.width - x)
    local h = H.int(p.height) or (spr.height - y)
    if w * h > 16384 then error("region too large (max 16384 pixels); read a smaller region") end

    local chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@$%^&*+=?<>~"
    local legend, lookup, nextChar = { ["."] = "transparent" }, {}, 1
    local rows = {}
    local pc = app.pixelColor
    for yy = y, y + h - 1 do
      local row = {}
      for xx = x, x + w - 1 do
        local ch = "."
        if xx >= 0 and yy >= 0 and xx < spr.width and yy < spr.height then
          local v = src:getPixel(xx, yy)
          if pc.rgbaA(v) > 0 then
            local hx = H.hex(pc.rgbaR(v), pc.rgbaG(v), pc.rgbaB(v), pc.rgbaA(v))
            ch = lookup[hx]
            if not ch then
              if nextChar > #chars then error("too many distinct colors to encode; read a smaller region") end
              ch = chars:sub(nextChar, nextChar)
              nextChar = nextChar + 1
              lookup[hx] = ch
              legend[ch] = hx
            end
          end
        end
        row[#row + 1] = ch
      end
      rows[#rows + 1] = table.concat(row)
    end
    return { x = x, y = y, width = w, height = h, legend = legend, rows = rows }
  end

  return ops
end
