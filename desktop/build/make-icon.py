#!/usr/bin/env python3
"""
Generate the application icon: a citadel standing black against a dying sun.

    pip install pillow && python3 desktop/build/make-icon.py

Writes icon.png (1024, for Linux and macOS), icon.ico (for Windows) and tray.png next to
itself. Those three files are committed, so a normal build never runs this — it is here so the
icon is a thing that can be changed and re-derived rather than a binary nobody can edit.

Drawn rather than sourced: a release carrying the default Electron icon looks like somebody
else's program in the taskbar, and this is the one image the app leaves on a desktop. The
palette is the app's own — see web/src/index.css.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

S = 1024
VOID = (7, 6, 16, 255)
GOLD = (226, 169, 79)
GOLD_HIGH = (242, 201, 126)
GOLD_DEEP = (168, 118, 47)
VIOLET = (120, 86, 200)

HERE = Path(__file__).parent


def build() -> Image.Image:
    img = Image.new("RGBA", (S, S), VOID)

    # Violet bleeding down from above: the same layer the dashboard's background has.
    sky = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sky_draw = ImageDraw.Draw(sky)
    for i in range(40):
        t = i / 39
        r = int(S * (0.20 + 0.75 * t))
        sky_draw.ellipse(
            [S // 2 - r, int(S * 0.05) - r, S // 2 + r, int(S * 0.05) + r],
            fill=VIOLET + (int(14 * (1 - t)),),
        )
    img = Image.alpha_composite(img, sky)

    # The sun: filled, brighter towards its rim so it reads as a sun and not a dot.
    cx, cy, radius = S // 2, int(S * 0.585), int(S * 0.235)
    sun = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sun_draw = ImageDraw.Draw(sun)
    for i in range(radius, 0, -1):
        t = i / radius
        colour = tuple(round(a + (b - a) * (t**1.6)) for a, b in zip(GOLD_DEEP, GOLD_HIGH))
        sun_draw.ellipse([cx - i, cy - i, cx + i, cy + i], fill=colour + (255,))
    sun = sun.filter(ImageFilter.GaussianBlur(S * 0.004))

    halo = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    halo_draw = ImageDraw.Draw(halo)
    for i in range(30):
        t = i / 29
        r = int(radius * (1.0 + 1.4 * t))
        halo_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD + (int(20 * (1 - t)),))
    halo = halo.filter(ImageFilter.GaussianBlur(S * 0.02))

    img = Image.alpha_composite(img, halo)
    img = Image.alpha_composite(img, sun)
    draw = ImageDraw.Draw(img)

    # The citadel, cut out of the sun rather than drawn on top of it.
    def tower(x: float, w: float, top: float) -> None:
        draw.rectangle([x, top, x + w, int(S * 0.815)], fill=VOID)
        draw.polygon([(x - w * 0.20, top), (x + w / 2, top - w * 1.15), (x + w * 1.20, top)], fill=VOID)

    tower(int(S * 0.345), int(S * 0.058), int(S * 0.585))
    tower(int(S * 0.462), int(S * 0.076), int(S * 0.470))
    tower(int(S * 0.598), int(S * 0.058), int(S * 0.600))
    # The span between them, which is what makes three towers one building.
    draw.rectangle([int(S * 0.345), int(S * 0.715), int(S * 0.656), int(S * 0.742)], fill=VOID)

    # The ground, and the last light along its edge.
    draw.rectangle([0, int(S * 0.815), S, S], fill=VOID)
    draw.line(
        [int(S * 0.13), int(S * 0.815), int(S * 0.87), int(S * 0.815)],
        fill=GOLD + (230,),
        width=max(3, S // 200),
    )

    # Rounded, so the corners are not four hard pixels against a light desktop.
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    img.putalpha(mask)
    return img


def main() -> None:
    icon = build()
    icon.save(HERE / "icon.png")
    icon.resize((256, 256), Image.LANCZOS).save(
        HERE / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    # The tray draws this at 16 or 24 points. Resampling from the master keeps it from turning
    # into three grey smudges.
    icon.resize((32, 32), Image.LANCZOS).save(HERE / "tray.png")
    print(f"wrote icon.png, icon.ico and tray.png in {HERE}")


if __name__ == "__main__":
    main()
