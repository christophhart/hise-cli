#!/usr/bin/env python3
"""Post-process screencast .cast files: gzip + generate HTML preview.

Run after vitest generates .cast files from .tape scripts:
    python3 screencasts/generate.py

This script:
1. Gzips each .cast file to .cast.gz (max compression)
2. Removes the uncompressed .cast files (they're gitignored)
3. Generates a self-contained index.html with embedded asciinema-player
   widgets. The .cast.gz data is base64-inlined so the HTML works
   from file:// without a local HTTP server.
"""

import base64
import gzip
import glob
import json
import os
import sys

SCREENCASTS_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Gzip .cast files ────────────────────────────────────────────────

cast_files = sorted(glob.glob(os.path.join(SCREENCASTS_DIR, "*.cast")))

if not cast_files:
    print("No .cast files found in screencasts/", file=sys.stderr)
    sys.exit(0)

# name -> { gz_path, b64 data for HTML embedding }
casts = {}

for cast_path in cast_files:
    name = os.path.splitext(os.path.basename(cast_path))[0]
    gz_path = cast_path + ".gz"

    with open(cast_path, "rb") as f_in:
        raw = f_in.read()

    with gzip.open(gz_path, "wb", compresslevel=9) as f_out:
        f_out.write(raw)

    orig_size = len(raw)
    gz_size = os.path.getsize(gz_path)
    print(f"  {name}.cast.gz: {orig_size:,} -> {gz_size:,} bytes ({gz_size * 100 // orig_size}%)")

    # Base64-encode the raw (uncompressed) .cast content for inlining.
    # The player can load from a blob URL containing the raw asciicast.
    b64 = base64.b64encode(raw).decode("ascii")
    casts[name] = b64

    os.remove(cast_path)

# ── Generate index.html ─────────────────────────────────────────────

names = sorted(casts.keys())

player_sections = []
player_inits = []

for name in names:
    title = name.replace("-", " ").title()
    player_sections.append(f"""    <section>
      <h2>{title}</h2>
      <div id="{name}" class="player"></div>
    </section>""")

# Build the JavaScript that creates blob URLs from base64 data
# and initialises the player with each one.
data_entries = []
for name in names:
    data_entries.append(f'      "{name}": "{casts[name]}"')

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>hise-cli Screencasts</title>
  <link rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/asciinema-player@3/dist/bundle/asciinema-player.css">
  <script
    src="https://cdn.jsdelivr.net/npm/asciinema-player@3/dist/bundle/asciinema-player.min.js">
  </script>
  <style>
    body {{
      background: #1f201c;
      color: #d0d0c8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }}
    h1 {{
      color: #90ffb1;
      font-weight: 300;
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }}
    h1 span {{
      color: #75715e;
      font-size: 1rem;
      font-weight: 400;
    }}
    h2 {{
      color: #a6e22e;
      font-weight: 400;
      font-size: 1.2rem;
      margin-top: 2.5rem;
      margin-bottom: 0.75rem;
    }}
    .player {{
      margin-bottom: 1rem;
      border-radius: 8px;
      overflow: hidden;
    }}
  </style>
</head>
<body>
  <h1>hise-cli Screencasts <span>({len(names)} recordings)</span></h1>

{chr(10).join(player_sections)}

  <script>
    // Base64-encoded .cast data, inlined to avoid file:// CORS issues.
    const castData = {{
{",{}".format(chr(10)).join(data_entries)}
    }};

    const opts = {{ speed: 0.4, autoPlay: false, fit: "width" }};

    for (const [name, b64] of Object.entries(castData)) {{
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {{ type: "text/plain" }});
      const url = URL.createObjectURL(blob);
      AsciinemaPlayer.create(url, document.getElementById(name), opts);
    }}
  </script>
</body>
</html>
"""

html_path = os.path.join(SCREENCASTS_DIR, "index.html")
with open(html_path, "w") as f:
    f.write(html)

html_size = os.path.getsize(html_path)
print(f"  index.html: {len(names)} players, {html_size:,} bytes (self-contained)")
print(f"Done. Open screencasts/index.html in a browser to preview.")
