-- aseprite-mcp entry point.
--
-- Invoked as:
--   aseprite --batch --script-param root=<lua dir> \
--            --script-param input=<request.json> \
--            --script-param output=<response.json> \
--            --script runner.lua
--
-- request.json:  { "ops": [ { "op": "<name>", "args": { ... } }, ... ] }
-- response.json: { "ok": true,  "results": [ ... ], "saved": [ ... ] }
--             or { "ok": false, "error": "...", "failedOp": <1-based index>, "results": [ ... ] }
--
-- Ops run in order inside one process. Changes are saved only if every op
-- succeeds, so a batch is all-or-nothing.

local root = app.params.root
local input = app.params.input
local output = app.params.output

local function readFile(path)
  local f = assert(io.open(path, "rb"))
  local s = f:read("a")
  f:close()
  return s
end

local function writeFile(path, s)
  local f = assert(io.open(path, "wb"))
  f:write(s)
  f:close()
end

local function respond(tbl)
  writeFile(output, json.encode(tbl))
end

local H = dofile(app.fs.joinPath(root, "lib.lua"))

local ops = {}
for _, name in ipairs({ "document", "layers", "draw", "animation", "tilemap", "render", "lua" }) do
  local mod = dofile(app.fs.joinPath(root, "ops", name .. ".lua"))
  for k, fn in pairs(mod(H)) do ops[k] = fn end
end

local ok, err = pcall(function()
  local req = json.decode(readFile(input))
  local results = {}
  for i, entry in ipairs(req.ops or {}) do
    local fn = ops[entry.op]
    if not fn then
      respond({ ok = false, error = "unknown op: " .. tostring(entry.op), failedOp = i, results = results })
      return
    end
    local okOp, res = pcall(fn, entry.args or {})
    if not okOp then
      local msg = tostring(res):gsub("^.-:%d+: ", "")
      respond({ ok = false, error = msg, failedOp = i, op = entry.op, results = results })
      return
    end
    results[#results + 1] = res or {}
  end
  local saved = H.saveAll()
  respond({ ok = true, results = results, saved = saved })
end)

if not ok then
  pcall(respond, { ok = false, error = "runner failure: " .. tostring(err) })
end
H.closeAll()
