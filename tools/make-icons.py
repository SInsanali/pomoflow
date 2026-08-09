#!/usr/bin/env python3
"""Generate src/icons/{16,32,48,128}.png.

The icons are the only binary assets in the repo, so they are generated rather
than committed blind — rerun this to change the mark or the colour.

The mark is a timer disc with a wedge cut out of it, drawn 4x oversampled and
box-filtered down for antialiasing. No third-party imaging library: PNG is
simple enough to emit directly with zlib.
"""

import math
import struct
import zlib
from pathlib import Path

# Dusk pomodoro accent — warm enough to stay visible on both light and dark
# Chrome toolbars.
FG = (232, 106, 44)
SIZES = (16, 32, 48, 128)
SS = 4  # supersampling factor
OUT = Path(__file__).resolve().parent.parent / "src" / "icons"


def coverage(size):
    """Alpha per pixel, 0.0-1.0, for the disc-with-wedge mark."""
    hi = size * SS
    cx = cy = hi / 2 - 0.5
    radius = hi * 0.46
    acc = [[0.0] * size for _ in range(size)]

    for y in range(hi):
        for x in range(hi):
            dx, dy = x - cx, y - cy
            if dx * dx + dy * dy > radius * radius:
                continue
            # Cut a wedge from 12 o'clock clockwise to 3 o'clock, so the mark
            # reads as elapsed time rather than a plain dot.
            angle = math.atan2(dx, -dy) % (2 * math.pi)
            if 0 <= angle <= math.pi / 2:
                continue
            acc[y // SS][x // SS] += 1.0

    n = SS * SS
    return [[v / n for v in row] for row in acc]


def png_bytes(size):
    alpha = coverage(size)
    raw = bytearray()
    for row in alpha:
        raw.append(0)  # filter type 0 (None)
        for a in row:
            raw += bytes((FG[0], FG[1], FG[2], round(a * 255)))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"{size}.png"
        path.write_bytes(png_bytes(size))
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
