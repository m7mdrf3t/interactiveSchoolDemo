#!/usr/bin/env python3
"""Download original panoramic photos from Insta360 Cloud share links.

Usage:
    python3 insta360_dl.py URL [URL ...]
    python3 insta360_dl.py -f links.txt -o panos

Each link looks like https://cloud-<endpoint>.insta360.com/share/<endpoint>/<linkCode>
Files are saved under the original camera filename (.insp is a JPEG, so a
.jpg copy is written by default).
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0"
LINK_RE = re.compile(r"https?://cloud-([a-z]+)\.insta360\.com/share/([a-z]+)/([A-Za-z0-9]+)")


def get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def resolve(link):
    m = LINK_RE.match(link.strip())
    if not m:
        raise ValueError(f"not an Insta360 Cloud share link: {link}")
    host, endpoint, code = m.groups()

    # The share page embeds the mediaId in __NEXT_DATA__.
    html = get(link.strip()).decode("utf-8", "replace")
    nd = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not nd:
        raise RuntimeError("share page layout changed: __NEXT_DATA__ not found")
    media_id = json.loads(nd.group(1))["props"]["query"]["mediaId"]

    api = f"https://service-{endpoint}.insta360.com/cloud/service/sharePlay/link/media/detail"
    qs = urllib.parse.urlencode({"linkCode": code, "mediaId": media_id})
    body = json.loads(get(f"{api}?{qs}", {
        "x-insta360-platform": "web/*",
        "X-Equipment-Code": "web",
        "Referer": f"https://cloud-{host}.insta360.com/",
    }))
    if body.get("code") != 0:
        raise RuntimeError(f"API error: {body.get('msg')}")
    return host, body["data"]


def download(link, outdir, keep_insp):
    host, data = resolve(link)
    if data.get("mediaType") != "pano_picture":
        print(f"  note: mediaType is {data.get('mediaType')!r}, trying anyway")
    url = data["paths"]["previewPaths"]["imageData"]["path"]
    stem = Path(data["mediaName"]).stem
    dest = outdir / f"{stem}.jpg"
    blob = get(url, {"Referer": f"https://cloud-{host}.insta360.com/"})
    if len(blob) != data.get("mediaSize"):
        print(f"  warning: got {len(blob)} bytes, expected {data.get('mediaSize')}")
    dest.write_bytes(blob)
    if keep_insp:
        (outdir / data["mediaName"]).write_bytes(blob)
    print(f"  saved {dest} ({len(blob) / 1e6:.1f} MB, {data.get('cameraType', data.get('shareMediaInfo', {}).get('cameraType', '?'))})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("urls", nargs="*")
    ap.add_argument("-f", "--file", help="text file with one share link per line")
    ap.add_argument("-o", "--out", default="panoramas", help="output directory (default: panoramas)")
    ap.add_argument("--insp", action="store_true", help="also save a copy with the original .insp extension")
    args = ap.parse_args()

    links = list(args.urls)
    if args.file:
        links += [l.strip() for l in Path(args.file).read_text().splitlines() if l.strip() and not l.startswith("#")]
    if not links:
        ap.error("no links given")

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    failed = 0
    for link in links:
        print(link)
        try:
            download(link, outdir, args.insp)
        except Exception as e:
            failed += 1
            print(f"  FAILED: {e}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
