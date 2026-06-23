# Last stable version
FROM fluent/fluent-bit@sha256:c96ee743cba9b1d5a38654931f411700af80bb7652697afbe67daad46cae237b

# Copy local config to image
COPY fluent-bit.conf /fluent-bit/etc/fluent-bit.conf
# Filter reuest that have no japanese characters (Kanji and/or Kana)
COPY clean.lua       /fluent-bit/etc/clean.lua

# Expose port 9100 (system) from port 2010 (container)
EXPOSE 9100 2100

# Starts the fluent-bit process (not necessary as it is default behaviour)
# CMD ["/fluent-bit/bin/fluent-bit", "-c", "/fluent-bit/etc/fluent-bit.conf"]