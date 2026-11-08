-- Tilesets, tilemap layers, tile placement and tilemap export.
--
-- Tile index 0 is always the empty tile in Aseprite. Tilesets are referred
-- to by their 0-based index in sprite.tilesets.

return function(H)
  local ops = {}
  local pc = app.pixelColor

  local function tileset(spr, idx)
    idx = H.int(idx) or 0
    local ts = spr.tilesets[idx + 1]
    if not ts then error("tileset " .. idx .. " not found (sprite has " .. #spr.tilesets .. ")") end
    return ts, idx
  end

  local function tilesetIndexOf(spr, ts)
    for i, t in ipairs(spr.tilesets) do
      if t == ts then return i - 1 end
    end
  end

  ops.create_tileset = function(p)
    local spr = H.edit(p.file)
    local tw, th = H.int(p.tileWidth, "tileWidth"), H.int(p.tileHeight, "tileHeight")
    local ts = spr:newTileset(Rectangle(0, 0, tw, th), (H.int(p.tiles) or 0) + 1)
    if p.name then ts.name = p.name end
    return { tileset = tilesetIndexOf(spr, ts), tiles = #ts - 1 }
  end

  ops.add_tilemap_layer = function(p)
    local spr = H.edit(p.file)
    if p.name and H.findLayer(spr, p.name) then
      error("a layer named '" .. p.name .. "' already exists")
    end
    local ts
    if p.tileset ~= nil then
      ts = tileset(spr, p.tileset)
    elseif not (p.tileWidth and p.tileHeight) then
      error("give an existing tileset index, or tileWidth and tileHeight to create one")
    end
    local size = ts and ts.grid.tileSize or Size(H.int(p.tileWidth), H.int(p.tileHeight))
    local before = #spr.tilesets
    app.command.NewLayer { tilemap = true, gridBounds = Rectangle(0, 0, size.width, size.height) }
    local layer = app.layer
    if ts then
      local auto = layer.tileset
      layer.tileset = ts
      if #spr.tilesets > before and auto ~= ts then spr:deleteTileset(auto) end
    end
    if p.name then layer.name = p.name end
    return { name = layer.name, tileset = tilesetIndexOf(spr, layer.tileset) }
  end

  -- Draws pixels into one tile. Use tile = <current tile count + 1> to append
  -- a new tile. Pixel coordinates are relative to the tile (0..tileWidth-1).
  ops.draw_tile = function(p)
    local spr = H.edit(p.file)
    local ts, tsIdx = tileset(spr, p.tileset)
    local idx = H.int(p.tile, "tile")
    if idx < 1 then error("tile index must be >= 1 (0 is the empty tile)") end
    if idx > #ts then error("tile " .. idx .. " skips ahead; next new tile index is " .. #ts) end
    local tile
    if idx == #ts then
      tile = spr:newTile(ts)
    else
      tile = ts:tile(idx)
    end
    local img = tile.image:clone()
    if p.clear then img:clear(spr.colorMode == ColorMode.INDEXED and spr.transparentColor or 0) end
    if p.fill then img:clear(H.pixel(spr, p.fill)) end
    local w, h = img.width, img.height
    local n = H.eachInputPixel(spr, p, function(x, y, v)
      if x >= 0 and y >= 0 and x < w and y < h then img:drawPixel(x, y, v) end
    end)
    tile.image = img
    return { tileset = tsIdx, tile = idx, pixels = n, tiles = #ts - 1 }
  end

  -- Normalizes a tilemap cel so it covers the whole canvas grid at (0,0).
  local function mapCel(spr, layer, frame)
    local size = layer.tileset.grid.tileSize
    local cols = math.ceil(spr.width / size.width)
    local rows = math.ceil(spr.height / size.height)
    local cel = layer:cel(frame)
    local img = Image(ImageSpec { colorMode = ColorMode.TILEMAP, width = cols, height = rows })
    img:clear(0)
    if cel then
      local ox = cel.position.x // size.width
      local oy = cel.position.y // size.height
      for it in cel.image:pixels() do
        local x, y = it.x + ox, it.y + oy
        if x >= 0 and y >= 0 and x < cols and y < rows then img:drawPixel(x, y, it()) end
      end
      cel.image = img
      cel.position = Point(0, 0)
    else
      cel = spr:newCel(layer, frame, img, Point(0, 0))
    end
    return cel, cols, rows, size
  end

  -- grid: array of rows, each an array of tile indices. -1 leaves a cell
  -- unchanged, 0 clears it. (col, row) offsets the grid in tile units.
  ops.set_tiles = function(p)
    local spr = H.edit(p.file)
    local layer = H.layer(spr, p.layer, "tilemap")
    local frame = H.frame(spr, p.frame)
    local count = #layer.tileset
    local cel, cols, rows = mapCel(spr, layer, frame)
    local img = cel.image
    local oc, orow = H.int(p.col) or 0, H.int(p.row) or 0
    local placed = 0
    for r, line in ipairs(p.grid) do
      for c, v in ipairs(line) do
        v = H.int(v, "tile index")
        if v >= 0 then
          if v >= count then
            error("tile " .. v .. " does not exist (tileset has tiles 1.." .. (count - 1) .. ")")
          end
          local x, y = oc + c - 1, orow + r - 1
          if x < 0 or y < 0 or x >= cols or y >= rows then
            error(string.format("cell (%d,%d) is outside the %dx%d map; resize the canvas first", x, y, cols, rows))
          end
          img:drawPixel(x, y, pc.tile(v, 0))
          placed = placed + 1
        end
      end
    end
    return { placed = placed, mapColumns = cols, mapRows = rows }
  end

  local function readGrid(spr, layer, frame)
    local size = layer.tileset.grid.tileSize
    local cols = math.ceil(spr.width / size.width)
    local rows = math.ceil(spr.height / size.height)
    local grid = {}
    for r = 1, rows do
      grid[r] = {}
      for c = 1, cols do grid[r][c] = 0 end
    end
    local cel = layer:cel(frame)
    if cel then
      local ox = cel.position.x // size.width
      local oy = cel.position.y // size.height
      for it in cel.image:pixels() do
        local x, y = it.x + ox, it.y + oy
        if x >= 0 and y >= 0 and x < cols and y < rows then
          grid[y + 1][x + 1] = pc.tileI(it())
        end
      end
    end
    return grid, cols, rows, size
  end

  ops.get_tilemap = function(p)
    local spr = H.open(p.file)
    local layer = H.layer(spr, p.layer, "tilemap")
    local grid, cols, rows, size = readGrid(spr, layer, H.frame(spr, p.frame))
    return {
      layer = layer.name,
      tileset = tilesetIndexOf(spr, layer.tileset),
      tileWidth = size.width,
      tileHeight = size.height,
      columns = cols,
      rows = rows,
      grid = grid,
    }
  end

  -- Writes <out>.png (tileset atlas, excluding the empty tile 0),
  -- <out>.json (simple map data) and/or <out>.tmj (Tiled map).
  ops.export_tilemap = function(p)
    local spr = H.open(p.file)
    local layer = H.layer(spr, p.layer, "tilemap")
    local ts = layer.tileset
    local grid, cols, rows, size = readGrid(spr, layer, H.frame(spr, p.frame))
    local tw, th = size.width, size.height
    local n = #ts - 1
    if n < 1 then error("tileset has no tiles to export") end
    local atlasCols = H.int(p.columns) or math.min(n, 16)
    local atlasRows = math.ceil(n / atlasCols)
    local atlas = Image(atlasCols * tw, atlasRows * th, ColorMode.RGB)
    for i = 1, n do
      local timg = H.toRGB(spr, ts:tile(i).image)
      atlas:drawImage(timg, Point(((i - 1) % atlasCols) * tw, ((i - 1) // atlasCols) * th))
    end
    local pngPath = p.out .. ".png"
    atlas:saveAs(pngPath)
    local pngName = app.fs.fileName(pngPath)

    local flat = {}
    for r = 1, rows do
      for c = 1, cols do flat[#flat + 1] = grid[r][c] end
    end

    local written = { pngPath }
    local format = p.format or "both"
    if format == "json" or format == "both" then
      local f = assert(io.open(p.out .. ".json", "wb"))
      f:write(json.encode({
        tileset = {
          image = pngName,
          tileWidth = tw,
          tileHeight = th,
          columns = atlasCols,
          tileCount = n,
        },
        map = {
          layer = layer.name,
          columns = cols,
          rows = rows,
          data = flat,
        },
        note = "data is row-major; 0 = empty, n = tile n, located at atlas cell n-1",
      }))
      f:close()
      written[#written + 1] = p.out .. ".json"
    end
    if format == "tiled" or format == "both" then
      local f = assert(io.open(p.out .. ".tmj", "wb"))
      f:write(json.encode({
        type = "map",
        version = "1.10",
        orientation = "orthogonal",
        renderorder = "right-down",
        infinite = false,
        width = cols,
        height = rows,
        tilewidth = tw,
        tileheight = th,
        nextlayerid = 2,
        nextobjectid = 1,
        layers = { {
          id = 1,
          name = layer.name,
          type = "tilelayer",
          x = 0,
          y = 0,
          width = cols,
          height = rows,
          opacity = 1,
          visible = true,
          data = flat,
        } },
        tilesets = { {
          firstgid = 1,
          name = (ts.name ~= "" and ts.name) or "tileset",
          image = pngName,
          imagewidth = atlas.width,
          imageheight = atlas.height,
          tilewidth = tw,
          tileheight = th,
          columns = atlasCols,
          tilecount = n,
          margin = 0,
          spacing = 0,
        } },
      }))
      f:close()
      written[#written + 1] = p.out .. ".tmj"
    end
    return { written = written, columns = cols, rows = rows, tiles = n }
  end

  return ops
end
