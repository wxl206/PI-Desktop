#!/usr/bin/env python3
"""Derive PI-Desktop platform icon resources from the canonical logo.

The tracked ``apps/desktop/build/icon_1024.png`` file is the brand source of
truth. This script preserves that file and emits:

  apps/desktop/build/icon.iconset/  - all macOS iconset sizes
  apps/desktop/build/icon.icns      - PNG-backed macOS application icon
  apps/desktop/build/icon.ico       - multi-size Windows application icon
  apps/desktop/build/icon.png       - 512px Windows/Linux package icon
  apps/desktop/build/tray-icon-mac.png - transparent macOS template icon

Run: python3 scripts/make-icon.py
"""

from __future__ import annotations

import io
import shutil
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "apps" / "desktop" / "build"
SOURCE = BUILD / "icon_1024.png"

BASE = 1024
ICNS_TYPES = (
    (b"icp4", 16),
    (b"icp5", 32),
    (b"icp6", 64),
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic13", 256),
    (b"ic14", 512),
)


def _png_payload(image: Image.Image, size: int) -> bytes:
    buffer = io.BytesIO()
    image.resize((size, size), Image.Resampling.LANCZOS).save(
        buffer, format="PNG", optimize=True
    )
    return buffer.getvalue()


def _write_icns(master: Image.Image, destination: Path) -> None:
    entries = bytearray()
    for icon_type, size in ICNS_TYPES:
        payload = _png_payload(master, size)
        entries.extend(struct.pack(">4sI", icon_type, len(payload) + 8))
        entries.extend(payload)
    destination.write_bytes(
        b"icns" + struct.pack(">I", len(entries) + 8) + entries
    )


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"canonical logo is missing: {SOURCE}")

    with Image.open(SOURCE) as source:
        master = source.convert("RGBA")
    if master.size != (BASE, BASE):
        raise ValueError(
            f"canonical logo must be {BASE}x{BASE}, got {master.width}x{master.height}"
        )

    BUILD.mkdir(parents=True, exist_ok=True)
    windows_icon = BUILD / "icon.ico"
    master.save(
        windows_icon,
        format="ICO",
        sizes=[
            (16, 16),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        ],
    )
    package_icon = BUILD / "icon.png"
    master.resize((512, 512), Image.LANCZOS).save(package_icon)

    # macOS menu bar icons are template images: the system tints their alpha.
    # The Iterate master is already a transparent horizontal mark, so fit that
    # mark directly instead of trying to infer a silhouette from luminance.
    mark_bounds = master.getchannel("A").getbbox()
    if mark_bounds is None:
        raise ValueError("canonical logo alpha channel is empty")
    mark = master.crop(mark_bounds)
    tray_width = 900
    tray_height = round(mark.height * tray_width / mark.width)
    tray_alpha = mark.getchannel("A").resize(
        (tray_width, tray_height), Image.Resampling.LANCZOS
    )
    mark = Image.new("RGBA", (tray_width, tray_height), (0, 0, 0, 0))
    mark.putalpha(tray_alpha)
    tray_icon_mac = Image.new("RGBA", master.size, (0, 0, 0, 0))
    tray_icon_mac.alpha_composite(
        mark,
        ((BASE - tray_width) // 2, (BASE - tray_height) // 2),
    )
    tray_icon_mac_path = BUILD / "tray-icon-mac.png"
    tray_icon_mac.save(tray_icon_mac_path)

    iconset = BUILD / "icon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()
    sizes = [16, 32, 128, 256, 512]
    for sz in sizes:
        master.resize((sz, sz), Image.LANCZOS).save(iconset / f"icon_{sz}x{sz}.png")
        master.resize((sz * 2, sz * 2), Image.LANCZOS).save(
            iconset / f"icon_{sz}x{sz}@2x.png"
        )

    icns = BUILD / "icon.icns"
    _write_icns(master, icns)
    print(f"used {SOURCE}")
    print(f"wrote {windows_icon}")
    print(f"wrote {package_icon}")
    print(f"wrote {tray_icon_mac_path}")
    print(f"wrote {icns}")


if __name__ == "__main__":
    main()
