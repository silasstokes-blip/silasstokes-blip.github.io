# silasheaphy.dev

Plain HTML, CSS and JavaScript. No build step. GitHub Pages serves whatever is on `main`.

## Layout

```
index.html              Home: headshot and bio, live Critters sim, Featured Work, Other Projects
about.html              About page and skill lists
404.html                Not-found page (GitHub Pages uses it automatically)
work/<project>.html     One page per project
assets/css/site.css     All styles. Colors, fonts and sizes are tokens at the top
assets/js/site.js       Hover previews, lightbox, YouTube embeds, copy button, launch countdown
assets/js/critters-sim.js   The Critters and You simulation, ported from the GameMaker source
assets/js/critters-view.js  Draws the sim, legend, graph and controls; hold the mouse to spear
assets/fonts/           Funnel Display, Funnel Sans, Martian Mono, UnifrakturMaguntia (SIL Open Font License)
media/<project>/        logo.webp, poster.webp or backdrop.webp, shot-NN.webp (+ -sm), loop.webm/.mp4, thumb.webp
beachCar.html, beachCarOG.html, beachCar/, html5game/   The playable Beach Car builds (unchanged)
```

## Common edits

**Change text on a project.** Open `work/<project>.html` and edit the paragraphs inside `<article class="prose">`. The facts box is the `<dl>` inside `<aside>`.

**Change a project's color.** Each page sets it on `<body style="--project: #43eb56">`. Home tiles and Other Projects rows set it on the element. That color is also the hover color for the project's title.

**Add a project.**
1. Copy an existing `work/*.html` file and rename it.
2. Put media in `media/<slug>/`. WebP for images, about 1600px wide for screenshots and 720px for the `-sm` gallery thumbnails.
3. Add a row to Other Projects in `index.html` (copy an `index-row`), or a tile to Featured Work.
4. Fix the Previous/Next links at the bottom of its neighbors.

## Video

Hero and hover loops come in two formats: `loop.webm` (VP9) first, `loop.mp4` (H.264) as the fallback. To re-encode from a new source:

```
ffmpeg -i in.mp4 -an -vf scale=1680:-2 -c:v libx264 -crf 30 -preset slow -pix_fmt yuv420p -movflags +faststart loop.mp4
ffmpeg -i loop.mp4 -c:v libvpx-vp9 -b:v 0 -crf 40 -row-mt 1 -an loop.webm
```

## The Critters simulation

`critters-sim.js` follows `simulate_creatures`, `simulate_grass_growth`, `create_creature` and the `obj_game` step event from the Critters repo, with the same constants and update order. The player, hunger, shop and house are left out, the way the game's title screen runs it. Every creature is drawn as one grid cell. Holding the mouse button keeps the spear out at the pointer; it kills anything within two cells.
