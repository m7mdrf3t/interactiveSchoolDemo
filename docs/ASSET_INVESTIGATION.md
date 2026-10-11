# Insta360 source investigation

Investigated 2026-10-11 for the five supplied share links (`cloud-fra.insta360.com/share/fra/…`).

**Method.** I did not drive a browser with devtools. I read the share page's HTML (including its embedded `__NEXT_DATA__`), the page's JavaScript bundles, and replayed the player's own API calls with `curl`, which shows the same requests the Network tab would. The panoramas themselves were then inspected visually.

## Findings

| Question | Finding |
|---|---|
| What are the links? | Next.js player pages for single 360° photos. Page `<title>`/OG tags identify them as Insta360 X6 360° photos. The five pages are independent; nothing in them links one to another. |
| How is the panorama delivered? | As **one equirectangular JPEG per photo**, 8000 × 4000 (2:1), 5–9 MB. Not a cubemap and not tiled. The player projects it client-side. |
| How does the player find it? | The page embeds `mediaId` in `__NEXT_DATA__`. The player calls `GET https://service-fra.insta360.com/cloud/service/sharePlay/link/media/detail?linkCode=…&mediaId=…` and reads `data.paths.previewPaths.imageData.path`. `data.mediaType` is `pano_picture`; `data.mediaName` is the camera filename (`IMG_…_00_004.insp`). |
| Is direct access technically possible? | Yes, but only briefly and conditionally. The image URL is a **signed CloudFront URL** (`Expires`, `Signature`, `Key-Pair-Id`) that expires about 24 h after it is issued. The API itself refuses requests without `X-Equipment-Code` and a `Referer` from `cloud-*.insta360.com`, and the image host returns **403 without that Referer**. |
| CORS? | The image response carries **no `Access-Control-Allow-Origin`** header (checked with an `Origin:` header). A page on another origin cannot load it as a WebGL texture. |
| Can it be exported as a standard 2:1 equirect? | It already is one. The file is a standard JPEG with an Insta360 EXIF block. The downloaded bytes match the `mediaSize` the API reports. |
| Authentication | None for public share links, beyond the headers above. |
| Production decision | **Do not depend on any Insta360 URL at runtime.** Signed URLs expire, the endpoints are undocumented and could change, and CORS blocks third-party rendering. The site ships its own copies of the images. |
| iframe? | Not used. The Insta360 player would prevent native hotspots, camera control and seamless transitions. |

## What was done with the assets

- `tools/insta360_dl.py` fetched the five originals once (a development convenience; it uses the undocumented API above and is not part of the site).
- They are stored as `assets/panoramas/scene-01.jpg … scene-05.jpg` in capture order.
- `tools/build_tiles.py` converts each into multi-resolution cube tiles under `assets/tiles/` so phones with 4096 px texture limits work and first paint is fast.

## Privacy note

The originals contain **EXIF GPS coordinates** (and camera model/serial-style metadata). The generated tiles and thumbnails are re-encoded and contain no EXIF. Before a public deployment either delete `assets/panoramas/*.jpg` (the viewer uses the tiles when present) or strip the metadata from them.

## Content rights

These are the school's own photos shared from the owner's Insta360 account. Confirm you are authorised to republish them before deploying publicly.
