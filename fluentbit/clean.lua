-- Lua function to remove request with no kanji and/or kana

-- clean.lua
function clean(tag, ts, record)
    local t = record["text"]
    if not t or #t == 0 then return -1, 0, 0 end          
    t = t:gsub("%c", " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    if #t == 0 then return -1, 0, 0 end

    -- MARK as rejected and pass through.
    if string.find(t, "[\227-\233]") == nil then
        record["text"] = t
        record["status"] = "rejected"
        record["reason"] = "no_japanese"
        return 1, ts, record
    end

    record["text"] = t
    record["status"] = "accepted"
    return 1, ts, record
end
