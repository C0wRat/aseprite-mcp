-- Frames, timing, tags and cel movement.

return function(H)
  local ops = {}

  local dirs = {
    forward = AniDir.FORWARD,
    reverse = AniDir.REVERSE,
    pingpong = AniDir.PING_PONG,
    pingpong_reverse = AniDir.PING_PONG_REVERSE,
  }

  local function copyCels(spr, fromFrame, toFrame)
    for _, l in ipairs(H.allLayers(spr)) do
      if not l.isGroup then
        local cel = l:cel(fromFrame)
        if cel then spr:newCel(l, toFrame, cel.image:clone(), cel.position) end
      end
    end
  end

  -- Inserts `count` frames after frame `after` (default: last frame).
  -- copy=true (default) duplicates the content of frame `after`.
  ops.add_frame = function(p)
    local spr = H.edit(p.file)
    local after = H.int(p.after) or #spr.frames
    H.frame(spr, after)
    local count = H.int(p.count) or 1
    local srcDuration = spr.frames[after].duration
    local created = {}
    for i = 1, count do
      local at = after + i
      local f = spr:newEmptyFrame(at)
      f.duration = p.durationMs and (p.durationMs / 1000) or srcDuration
      if p.copy ~= false then copyCels(spr, after, at) end
      created[#created + 1] = at
    end
    return { created = created, frames = #spr.frames }
  end

  ops.remove_frame = function(p)
    local spr = H.edit(p.file)
    local from = H.frame(spr, p.from or p.frame)
    local to = H.frame(spr, p.to or from)
    if to - from + 1 >= #spr.frames then error("cannot remove every frame") end
    for f = to, from, -1 do spr:deleteFrame(f) end
    return { frames = #spr.frames }
  end

  ops.copy_frame = function(p)
    local spr = H.edit(p.file)
    local from, to = H.frame(spr, p.from), H.frame(spr, p.to)
    for _, l in ipairs(H.allLayers(spr)) do
      if not l.isGroup then
        local existing = l:cel(to)
        if existing then spr:deleteCel(existing) end
      end
    end
    copyCels(spr, from, to)
    return {}
  end

  ops.set_frame_duration = function(p)
    local spr = H.edit(p.file)
    local frames = p.frames
    if frames == nil then
      frames = {}
      for i = 1, #spr.frames do frames[i] = i end
    end
    for _, f in ipairs(frames) do
      spr.frames[H.frame(spr, f)].duration = p.durationMs / 1000
    end
    return { updated = #frames }
  end

  ops.add_tag = function(p)
    local spr = H.edit(p.file)
    for _, t in ipairs(spr.tags) do
      if t.name == p.name then error("tag '" .. p.name .. "' already exists") end
    end
    local tag = spr:newTag(H.frame(spr, p.from), H.frame(spr, p.to))
    tag.name = p.name
    if p.direction then
      local d = dirs[p.direction]
      if not d then error("direction must be forward, reverse, pingpong or pingpong_reverse") end
      tag.aniDir = d
    end
    if p.repeats then tag.repeats = H.int(p.repeats) end
    if p.color then
      local r, g, b, a = H.rgba(spr, p.color)
      tag.color = Color { r = r, g = g, b = b, a = a }
    end
    return { name = tag.name, from = tag.fromFrame.frameNumber, to = tag.toFrame.frameNumber }
  end

  ops.remove_tag = function(p)
    local spr = H.edit(p.file)
    for _, t in ipairs(spr.tags) do
      if t.name == p.name then
        spr:deleteTag(t)
        return { removed = p.name }
      end
    end
    error("tag '" .. p.name .. "' not found")
  end

  -- Shift a cel's content by (dx, dy) pixels, e.g. for bobbing animations.
  ops.move_cel = function(p)
    local spr = H.edit(p.file)
    local layer = H.layer(spr, p.layer, "any")
    local frame = H.frame(spr, p.frame)
    local cel = layer:cel(frame)
    if not cel then error("no cel on layer '" .. layer.name .. "' at frame " .. frame) end
    local pos = cel.position
    cel.position = Point(pos.x + H.int(p.dx or 0), pos.y + H.int(p.dy or 0))
    return { x = cel.position.x, y = cel.position.y }
  end

  return ops
end
