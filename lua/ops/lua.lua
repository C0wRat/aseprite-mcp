-- Escape hatch: run arbitrary Aseprite Lua. Only reachable when the server
-- enables the run_lua tool (ASEPRITE_ALLOW_LUA=true).
--
-- The code runs with the normal Aseprite globals plus:
--   sprite  -- the sprite opened from args.file (if given), saved afterwards
--   params  -- args.params (any JSON value)
--   H       -- the aseprite-mcp helper library
-- Whatever the code returns is JSON-encoded into the result.

return function(H)
  local ops = {}

  ops.run_lua = function(p)
    local env = setmetatable({
      sprite = p.file and H.edit(p.file) or nil,
      params = p.params,
      H = H,
    }, { __index = _G })
    local fn, err = load(p.code, "run_lua", "t", env)
    if not fn then error("syntax error: " .. err) end
    local value = fn()
    return { value = value }
  end

  return ops
end
