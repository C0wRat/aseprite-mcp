-- Layer management.

return function(H)
  local ops = {}

  local function blendMode(name)
    if name == nil then return nil end
    local v = BlendMode[name:upper()]
    if v == nil then error("unknown blend mode '" .. name .. "'") end
    return v
  end

  local function applyProps(spr, l, p)
    if p.newName ~= nil then l.name = p.newName end
    if p.visible ~= nil then l.isVisible = p.visible end
    if p.opacity ~= nil then l.opacity = H.int(p.opacity, "opacity") end
    if p.blendMode ~= nil then l.blendMode = blendMode(p.blendMode) end
    if p.parent ~= nil then
      if p.parent == "" then
        l.parent = spr
      else
        local g = H.findLayer(spr, p.parent)
        if not g or not g.isGroup then error("parent '" .. p.parent .. "' is not a group layer") end
        l.parent = g
      end
    end
    if p.stackIndex ~= nil then l.stackIndex = H.int(p.stackIndex, "stackIndex") end
  end

  ops.add_layer = function(p)
    local spr = H.edit(p.file)
    if p.name and H.findLayer(spr, p.name) then
      error("a layer named '" .. p.name .. "' already exists")
    end
    local l = (p.type == "group") and spr:newGroup() or spr:newLayer()
    if p.name then l.name = p.name end
    applyProps(spr, l, { visible = p.visible, opacity = p.opacity, blendMode = p.blendMode, parent = p.parent, stackIndex = p.stackIndex })
    return { name = l.name, type = H.layerType(l), stackIndex = l.stackIndex }
  end

  ops.remove_layer = function(p)
    local spr = H.edit(p.file)
    local l = H.findLayer(spr, p.layer)
    if not l then error("layer '" .. p.layer .. "' not found") end
    spr:deleteLayer(l)
    return { removed = p.layer }
  end

  ops.set_layer_props = function(p)
    local spr = H.edit(p.file)
    local l = H.findLayer(spr, p.layer)
    if not l then error("layer '" .. p.layer .. "' not found") end
    applyProps(spr, l, p)
    return { name = l.name, visible = l.isVisible, opacity = l.opacity, stackIndex = l.stackIndex }
  end

  ops.duplicate_layer = function(p)
    local spr = H.edit(p.file)
    local src = H.findLayer(spr, p.layer)
    if not src then error("layer '" .. p.layer .. "' not found") end
    if src.isGroup or src.isTilemap then error("only image layers can be duplicated") end
    local l = spr:newLayer()
    l.name = p.newName or (src.name .. " copy")
    l.parent = src.parent
    l.stackIndex = src.stackIndex + 1
    l.opacity = src.opacity
    l.blendMode = src.blendMode
    for _, cel in ipairs(src.cels) do
      spr:newCel(l, cel.frameNumber, cel.image:clone(), cel.position)
    end
    return { name = l.name }
  end

  return ops
end
