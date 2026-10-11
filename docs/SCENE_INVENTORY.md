# Scene inventory and spatial graph

Based on viewing each panorama in full. Names are **provisional**. Angles are yaw/pitch in degrees (yaw 0 = centre of the equirect image, positive to the right; pitch positive = up) and are read from a 1800 × 900 preview, so treat them as ±2°.

Nothing below was confirmed on site. "Visual" means supported by what the photos themselves show.

## Scenes

### Scene 01 — Exterior, Gate 1 (`scene-01`, captured 14:41)
- **What is visible:** sunny road in front of the building. Sign: "Talent World International Schools" (English and Arabic) with "Girls School" underneath; a numbered "GATE 1" sign beside a pair of dark double doors; a second, taller building block with the school logo; parked cars; open sand either side of the road.
- **Doors / entries:** the Gate 1 double doors (yaw ≈ 7°). Other doors on the wall to the right (yaw ≈ 40–60°) are not identified.
- **Adjacent spaces identifiable:** none. Nothing here shows what is behind the Gate 1 doors.
- **Start view:** yaw 5°, pitch 3° (sign and Gate 1 in frame).
- **Info points:** school signage (−6°, 16°), Gate 1 (17°, 4°).
- **Link:** *candidate only* Gate 1 doors → Scene 04, **unverified and hidden from visitors**.

### Scene 02 — Covered hall, stage end (`scene-02`, 14:43)
- **What is visible:** fabric-roofed hall on white steel arches; floor painted purple, blue and green with white court lines; tiered blue seating on the left; a raised stage area at the far end; wall-mounted air conditioners.
- **Doors / entries seen:** double glass door at the far left edge (yaw ≈ −170°); open doorway into an interior corridor (yaw ≈ 46°); a glass door with a frosted panel on the right wall (yaw ≈ 124°). **None of these can be matched to another scene.**
- **Start view:** yaw −40°, pitch −5° (stage and seating).
- **Info points:** tiered seating (−90°, −10°), painted floor (0°, −38°).
- **Link:** → Scene 03 (visual, **approximate position**).

### Scene 03 — Covered hall, building entrance (`scene-03`, 14:44)
- **What is visible:** the same hall from farther from the stage. A rounded, columned entrance with wide steps, stainless handrails and a ramp rail leads to glass doors; through them a bright interior with green balloons is visible.
- **Doors / entries:** glass doors at the top of the steps (yaw ≈ 0°, pitch ≈ 8°).
- **Start view:** yaw −45°, pitch −3°.
- **Info points:** stepped entrance (20°, −22°), stage area (−110°, 3°), seating (−158°, −10°).
- **Links:** → Scene 04 through the glass doors (visual, **exact**); → Scene 02 toward the stage (visual, approximate).

### Scene 04 — Lobby, reception desk (`scene-04`, 14:45)
- **What is visible:** wood-panelled reception desk with the Talent World Schools logo and three framed portraits above it; two dark sofas and a rug; green-and-white balloons and pennants; a wall graphic "Think. Explore. Discover. Innovate."; a stairway on the left.
- **Doors / entries:** glass door on the left (yaw ≈ −172°) through which the hall's blue seating and painted floor are visible; a window onto the hall on the right (yaw ≈ 168°); dark doors/openings at yaw ≈ 38° and ≈ 78° (not identified).
- **Start view:** yaw 0°, pitch 0° (reception desk).
- **Info points:** reception desk (0°, −10°), wall graphic (94°, −4°).
- **Links:** → Scene 03 through the glass door (visual, **exact**); → Scene 05 (visual, approximate).

### Scene 05 — Lobby, stairs and corridor (`scene-05`, 14:46)
- **What is visible:** the same lobby from much farther back: reception desk and sofas small in the distance (yaw ≈ −14°); staircases both left (yaw ≈ −170°) and right (yaw ≈ 150°); a corridor with a person at its far end (yaw ≈ 104°); wall text "Be Curious / Be Kind / Be Confident / Be Respectful / Be You"; a "Skills Display" board; "Your future is created by what you do today."
- **Start view:** yaw −14°, pitch 0° (toward reception).
- **Info points:** Skills Display (−66°, 1°), values wall (140°, 10°), staircase message (−168°, −2°).
- **Link:** → Scene 04 (visual, approximate).

## Spatial graph

```
Scene 01 ┄┄(unverified)┄┄ Scene 04 ──── Scene 03 ──── Scene 02
                              │
                           Scene 05
```

| Link | Basis | Placement |
|---|---|---|
| 03 ⇄ 04 (hall entrance ⇄ lobby glass door) | Both ends of the doorway are visible: Scene 04 shows the hall through its glass door; Scene 03 shows the glass doors and the lit lobby beyond. | exact |
| 02 ⇄ 03 (along the hall) | Same hall: identical seating, floor artwork and stage. Scene 03 is farther from the stage. | approximate |
| 04 ⇄ 05 (along the lobby) | Same reception desk, sofas, flags and decorations. Scene 05 is much farther from the desk. | approximate |
| 01 → 04 | **No evidence.** Kept as an unverified candidate. | — |

"Approximate" links connect two views of the *same open space*, so the relationship is sound, but the arrow position and arrival direction are estimates. Refine them in the editor (`?edit=1`).

## What needs on-site confirmation

1. Where the Gate 1 doors lead, and how a visitor gets from Scene 01 into the building.
2. The exact walking line between 02 ↔ 03 and 04 ↔ 05 (where the camera stood in each).
3. The unidentified doors and corridors listed above, if more panoramas are captured.
4. The real room names; labels here are provisional.
