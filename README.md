# School 360° Virtual Tour

A static, Marzipano-based panorama tour engine. Five 360° photos from an Insta360 X6 become a navigable tour with walk-through doorway transitions, a location menu, a schematic map, info points, a guided tour, gyroscope support on phones and a browser-only hotspot editor.

No backend, database or Node server is needed: the project folder **is** the production build.

## Run it locally

Browsers block `fetch` from `file://`, so serve the folder:

```
python3 -m http.server 8080      # then open http://localhost:8080
```

## Deploy

Upload the folder contents as-is.

- **Hostinger shared hosting:** upload everything to `public_html/` (or a subfolder) via File Manager/FTP.
- **GitHub Pages:** push to a repo, then *Settings → Pages → Deploy from branch → / (root)*. `.nojekyll` is included.

All paths are relative, so it works from a subfolder too. Before deploying publicly read the privacy note in [docs/ASSET_INVESTIGATION.md](docs/ASSET_INVESTIGATION.md): the original JPEGs contain GPS EXIF. The viewer works from `assets/tiles/` alone, so you can delete `assets/panoramas/*.jpg` from the deployed copy.

## Project layout

```
index.html            page shell
css/style.css         all styling
js/app.js             viewer, navigation, tour, menu, map
js/editor.js          developer editor (loaded only with ?edit=1)
vendor/marzipano.js   Marzipano 0.10.2 (Apache-2.0)
config/tour.json      THE central config: scenes, hotspots, links, tour order
assets/panoramas/     scene-01.jpg … scene-05.jpg   (2:1 equirectangular masters)
assets/tiles/         generated multi-resolution cube tiles (run tools/build_tiles.py)
assets/thumbs/        generated menu thumbnails
tools/                build_tiles.py, insta360_dl.py, links.txt
docs/                 ASSET_INVESTIGATION.md, SCENE_INVENTORY.md
```

## Exporting the panoramas from Insta360

The tour needs one **2:1 equirectangular JPEG** per scene (for example 8000 × 4000 or larger).

1. Open each photo in **Insta360 Studio** (desktop) or the **Insta360 app**.
2. Export it as a **panorama / original 360° photo** in **JPEG** with a 2:1 ratio. Do not export a "reframed" or flat photo. Menu wording varies by version; look for *Export Original* / *Export Panorama*. Keep the camera's full resolution.
3. Save the five files as:

   ```
   assets/panoramas/scene-01.jpg
   assets/panoramas/scene-02.jpg
   assets/panoramas/scene-03.jpg
   assets/panoramas/scene-04.jpg
   assets/panoramas/scene-05.jpg
   ```
4. Generate the tiles and thumbnails (needs `pip install pillow numpy`):

   ```
   python3 tools/build_tiles.py            # all scenes, or: python3 tools/build_tiles.py scene-03
   ```
5. Reload. Replaced images are picked up automatically through `config/tour.json`.

If a scene has no tiles the viewer falls back to the plain JPEG (downscaled to the device's texture limit). If a scene has neither, it is shown dimmed in the menu/map and a message names the missing file. Nothing fails silently.

The five photos currently in `assets/panoramas/` are the **real school panoramas** downloaded from the supplied Insta360 links (capture order = scene order).

## The navigation graph

Scenes are nodes; each **link hotspot** is a directed edge with its own arrival view (`entry`), so entering and returning through the same doorway each open facing a sensible direction.

Each link has a `status`:

| status | meaning | shown to visitors |
|---|---|---|
| `confirmed` | confirmed on site | yes |
| `visual` | clearly supported by the photos, not yet confirmed on site | yes |
| `unverified` | a candidate only | **no** (dashed in the editor) |

A scene without a walkable link is still reachable from the menu and the map, which never imply physical adjacency. The guided tour order (`tour.order`) is a presentation sequence; the camera only "walks" between scenes that actually have a link and fades between the rest.

**Current state:** 03 ⇄ 04, 02 ⇄ 03 and 04 ⇄ 05 are implemented (`visual`); 01 → 04 is an unverified candidate. See [docs/SCENE_INVENTORY.md](docs/SCENE_INVENTORY.md) for the evidence and what still needs on-site confirmation. After confirming, set `"status": "confirmed"`.

## Hotspot editor

Open `http://localhost:8080/?edit=1` (it does not appear in the normal tour).

- Choose any scene, pick **+ Link** or **+ Info**, click in the panorama to place it. Yaw/pitch are recorded for you.
- Select a hotspot to edit its label, destination, status, position (type it, click to re-place, or move to the crosshair) and text.
- **Preview transition** plays the real walk-through; then **Save current view as arrival view** records where the destination should face.
- **Checks** lists missing return links, unverified/approximate links, scenes with no link and missing images.
- **Download tour.json** and replace `config/tour.json`. Work autosaves as a draft in this browser (`?fresh=1` ignores it, *Discard draft* clears it).

Pitch is "up is positive" everywhere in the config. (Marzipano uses the opposite sign internally; `app.js` converts.)

## Controls

Drag / swipe / arrow keys to look · scroll, pinch or +/− to zoom · tap glowing arrows to move · `M` menu · `F` fullscreen · `Esc` close panels · motion-tracking button on phones (move the phone to look around; iOS asks for motion permission; needs HTTPS).

## Known limits

- Connection geometry for the "approximate" links is an informed estimate; refine with the editor or on-site knowledge.
- Scene names are provisional (flagged in the UI). The school name comes from the signage in `scene-01` and lives in `config/tour.json`.
- Fullscreen is unavailable on iPhone Safari (the button hides itself).
- Not yet checked on real phones; layout was tested at phone viewport sizes in desktop Chrome.
