# Battle presentation

The dawn summit background is stored at `public/assets/arena/mt-silver-dawn.webp`
(431 KiB). It was created with the built-in imagegen tool; the exact final prompt
and provenance are in `public/assets/arena/credits.json`. Red and Gold are original
editable canvas pixel artwork in `src/trainers.js`, with a shared hand/ball anchor
for their recall beams. The earlier procedural terrain remains a loading fallback.

`src/pokedex-sizes.js` caches the 50 roster species' height values from
[PokéAPI Pokemon.height](https://pokeapi.co/docs/v2#pokemon), converted from
decimetres to metres on 2026-10-13. Battles make no external sizing API requests.
Rendering uses 42 world pixels per metre and measures the opaque idle sprite,
excluding transparent frame padding. Eevee, Togepi, Pikachu and Mew have a 22-pixel
minimum for readability. For Gyarados and Steelix, the dex measurement is their
long body; estimated folded-pose factors of 2 and 2.2 respectively map that length
onto the sprite's longest axis. These pose factors are artistic approximations,
not additional Pokédex facts. Yuna has no canonical dex entry and uses 84% of her
previous battle sprite scale. Preview and MVP art keep their fitted panel size.
Collision radii, movement, damage and network snapshots are unchanged.

Camera and status markers use measured sprite bounds so large species remain
visible. Poké Ball timelines are cosmetic: a faint recall takes 0.85 seconds and
finishes before the forced party picker is shown; a normal replacement combines
a short recall and release within the existing protection window. A voluntary
pause freezes the presentation. Forced online selection can finish the recall
while the shared combat simulation is paused. The server's 15-second selection,
60-second pause, and 3-2-1 resume rules are untouched.

All 18 elemental styles combine the existing cast/release layers with an impact
silhouette, cached light texture, shock front and brief ground afterglow. Mobile
keeps the existing 360-particle / 120-effect caps and uses fewer plume segments.
Reduced motion retains attack information with fewer moving accents and without
camera shake. Textures are cached rather than regenerated per frame.

Run `npm test` and `npm run build` for regression checks. With `npm run dev`,
`/test/visual-presentation.html` provides deterministic impact, recall, release,
manual-switch and size-pair controls, plus a rendering stress check. It is outside
the production build. Browser CPU submission timing is not a real-device FPS guarantee.
