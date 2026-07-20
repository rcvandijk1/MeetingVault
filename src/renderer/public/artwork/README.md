# Header artwork

Drop the two header images here with these exact filenames — the header
CSS (`src/renderer/src/styles/app.css`, `--header-art-image`) already
points at them and swaps automatically with the theme toggle:

- `header-dark.jpg` — used when the app is in dark theme.
- `header-light.jpg` — used when the app is in light theme.

## How it's composited

The header renders the image full-bleed behind a semi-transparent bar
(logo, status, and the theme/collapse buttons sit in that bar, in front
of the art). A mask fades the image to transparent over its bottom ~45%,
so it blends into the bar color instead of showing a hard edge — that's
what sells the "reaching over the top of the panel" look, so keep the
subject (face, hands, whatever) in the upper-to-middle two-thirds of the
image and let the bottom third stay relatively plain/dark (dark theme) or
plain/light (light theme).

Recommended size: at least 1600×640, roughly a 2.5:1 aspect ratio. Until
these files are added, the header falls back to a plain gradient — nothing
breaks, it's just artwork-less.

Collapsing the header (the chevron button) hides the art entirely and
shrinks down to a thin bar, regardless of whether these files are present.
