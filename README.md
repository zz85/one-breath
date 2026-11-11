# One Breath

A freediving and spearfishing game for the browser, set on the fictional Langpao Island. It is based on
[Tidewater](https://github.com/dgreenheck/tidewater) by Dan Greenheck, a rod-and-reel fishing game (MIT
licence, see `LICENSE`). Freedive the reef on one breath, hunt the fish that swim there with a speargun, sell your catch to
Joe at the fish stand, and spend it on better gear at Marta's chandlery. Around it is a
real-time tropical island and ocean: swim the reef, drive the boat out to deep water, and watch a humpback
breach. It runs directly on WebGPU and WGSL with its own small rendering engine, no framework.

**Play it:** https://zz85.github.io/one-breath/

**The original Tidewater:** https://dgreenheck.github.io/tidewater/

![Fishing off the pier at golden hour](docs/screenshot.jpg)

![The beach in the late afternoon](docs/screenshot-beach.jpg)

## Requirements

- A browser with WebGPU: a recent Chrome, Edge or Safari.
- A capable GPU. It targets 60 fps at 2560×1267 on an Apple M5 Pro, and dynamic resolution scales
  the render down on slower machines.
- The first load compiles several hundred shaders, which can take a minute or more. Later visits are
  faster because the browser caches them.

## Features

**Spearfishing**
- A band-powered speargun at real scale (75 cm wood, 90 cm teak railgun, 110 cm carbon) with an open
  muzzle, latex bands that you load one at a time, a stainless shaft with flopper and fins, and a mono
  shooting line wrapped on the gun.
- The shaft is simulated under water: quadratic drag (half its speed every ~4.5 m), a slight sink, stopped
  dead by its line. You hunt the fish the reef simulation swims, not spawned targets.
- Hits are tested against each fish's body shape from its anatomy (depth, width along its length), so a
  shot through the tail fin or under the belly misses. Where it hits matters: behind the eye is a stone
  shot, the spine paralyses, a belly or tail shot holds badly. A weak or long shot glances off the scales
  or lodges without opening the flopper.
- After the shot, as on a real reef: a stone shot or a small fish (under 2 kg) is a short haul and a grab.
  A big one runs: hold on and it tows you, costs breath and may tear the shaft out of the flesh; a gun reel
  lets it take line; or let go of the gun (G). On a float line the float tires it at the surface while you
  go up, then you grab the float and pull it in from the top, breathing. Groupers and snappers over the
  reef can bolt into a coral head and wedge themselves in: pulling only tears the shaft out, so leave it,
  go up for air, and reach in by hand once it calms down. No tension gauge: one line on screen says what
  the fish is doing.
- Breath-hold diving: oxygen partial pressure falls with depth on the way up (shallow-water blackout), CO2
  brings the urge to breathe and contractions, hypoxia narrows your vision, and a blackout ends the dive.
  A freediving computer shows depth, dive time and the surface interval.
- Fish are warier of a diver finning hard; a shot or a struggling fish scatters the school.
- Rules of the marine park: parrotfish, Nassau grouper, tarpon, turtles and rays are protected, yellowtail
  and hogfish have a 30 cm minimum. Breaking them costs a fine.
- A full-screen catch card with the fish's length and weight, a fish log with records, and a cooler.
- Joe's fish stand buys your catch; Marta's chandlery sells guns, shafts, a gun reel, fins, freediving
  courses, a bigger hold, fuel, a rebuilt engine, a fish finder and deck floodlights for night dives.
- Walk the deck and the wheelhouse while the boat drifts; the boat burns fuel.
- A first-play guide, contextual tips and a minimap. Progress is saved in the browser.

**Ocean**
- Four-cascade FFT ocean (Tessendorf spectra) with foam, whitecaps, wind streaks and swell.
- Depth-aware breaking waves with peeling shoulders, whitewater, spray and foam lace.
- A shallow-water simulation for swash running up and down the sand.
- Boat wake and bow spray, and a whale wake.
- Caustics on the seabed and in the water, with light shafts.
- A split underwater/above-water view at the waterline, with water droplets on the lens after surfacing.
- Refraction of the seabed through the surface, including behind the pier and boats.

**Sky**
- Physically based atmosphere (Hillaire 2020) with a sun, moon and stars.
- Volumetric cumulus and wispy cirrus with cloud shadows on the land.
- Aerial perspective and sea haze.
- God rays, and a lens flare with occlusion.

**World**
- An island with a beach, hills, headlands and rocks.
- A fishing village, a pier, and the vendors' stalls built from Poly Haven scans.
- Realistic vendor characters (Microsoft Rocketbox) with skinned animation.
- A coral reef with fish.
- Palms, bananas, monstera, elephant ear, heliconia, bird of paradise, broadleaf trees, shrubs and dune
  grass, with impostors and dithered LOD fades.
- Beach debris.
- Birds, crabs and marine snow.
- A humpback whale with an escort of fish, blows, fluke dives and breaches.

**Lighting and post**
- Cascaded shadows with contact-hardening penumbrae, and screen-space contact shadows.
- Ground bounce light.
- GTAO ambient occlusion.
- Temporal upscaling and sharpening.
- Bloom, auto exposure and motion blur.
- Night lighting from lanterns, windows and the boat, plus a flashlight that also works underwater.

**Audio**
- Positional audio from real CC0 field recordings: surf timed to each breaking wave, wind, birds, the boat
  engine, footsteps by surface, underwater ambience and whale song; the speargun's shot, hits, the bands,
  the line and your heartbeat on a long dive are synthesised.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look (click to capture the mouse, Esc to release) |
| Shift | Sprint / boat boost |
| Space | Jump / swim up |
| C | Crouch / dive |
| E | Interact: board the boat, take or leave the helm, step ashore, trade with the fish buyer or the chandlery |
| V | Boat camera at the helm (1st / 3rd person) |
| G | Take out / put away the speargun |
| R | Hold to load a band (two pulls for a two-band gun) |
| Right mouse | Hold to aim down the shaft |
| Q | Aim on / off, for a trackpad (then a click shoots, a held click hauls) |
| Left mouse | Shoot (under water only) · hold to haul the line in |
| E | Grab a fish that's in reach, reach into the reef for a holed fish, take your gun or the float line back (also: interact) |
| G (fish on) | Let go of the gun |
| I or Tab | Cooler / fish hold and the fish log |
| F | Free camera |
| L | Flashlight |
| T | Pause time |
| M | Mute |
| H | Settings panel |
| P | Photo mode |
| F1 or ? | All controls |

On a phone or tablet, touch controls come up at the first touch (or add `?touch` to the URL): put your
left thumb down anywhere on the left side for a movement stick (push it all the way to sprint), drag on the
right side to look, and use the buttons that appear for what you can do at the moment: Fire (tap to shoot,
hold to haul), Aim, Load, Gun, Dive, Up, Use, Cam at the helm, and Bag. The prompts name the buttons.
The stick is analog: a light push walks or swims slowly. Touch-only devices start on the Phone quality
preset; change it in the Performance tab, or with `?quality=high`.

### Spearfishing

Swim out from the beach or take the boat to the reef and drop in. Press G for the gun and hold R to pull
each band back to the shaft. Dive (C, or look down and swim), glide in slowly and hold the right mouse
button to aim down the shaft; shoot within about three gun lengths. Hold the left mouse button to haul the
line: a missed shaft comes back on it, a speared fish comes in on it. A small fish comes straight in; a big
one runs, so ease off when it pulls hard, or press G to let go of the gun and, with a float line, pull it
in from the surface. A fish holed up in the reef: let go, breathe, and come back to reach in (E). Once the
fish is in reach, E grabs it and it goes in the cooler. Every dive is one
breath: watch the urge to breathe on your dive computer, turn back at the first contractions, and breathe
up at the surface between dives. Yellowtail school over the reef, grunts and snappers hang around the pier
piles, jacks and barracuda patrol the drop-off. Sell your catch to Joe at the fish stand on the beach by
the pier, and spend it at Marta's chandlery by the boathouse. The boat burns diesel at the helm; fill up at
the chandlery. Progress is saved in the browser.

## URL options

Add these to the URL, for example `?fly&noAudio`:

| Option | Effect |
|---|---|
| `fly` | Start in the free camera |
| `noAudio` | Disable sound |
| `noClouds` | Skip the volumetric clouds |
| `noHaze` | Skip the haze and sun shafts |
| `noCaustics` | Skip caustics |
| `noVeg` | Skip vegetation |
| `noSim` | Skip the swash (shallow-water) simulation |
| `hunt` | Practice: start under water by a school of jacks with the gun loaded, calm fish and endless breath. `hunt=barracuda` for another kind (`hunt=list` names them), N for the next school, `__hunt('grunt')` from the console |
| `dist=3` | With `hunt`: how far from the school (m) |
| `gear` | With `hunt`: the best gear (110 cm carbon gun, best shaft, reel, float line, carbon fins), kept in your save; it gives exactly the money it costs |
| `wild` | With `hunt`: wary fish and a real breath-hold |
| `quality=phone` | The phone preset (lower resolution, smaller shadow map, coarser ocean mesh, no sun shafts or water reflections); `quality=high` the full one. Touch-only devices pick `phone` |
| `touch` | Touch controls from the start |
| `tune` | Measure the frame rate at each preset and render scale (about a minute: hold still), show a table and keep the best. Also `__tune()` in the console, or a long press on the frame-rate panel on a touch screen |
| `scale=0.8` | Internal render scale (0.5 to 1) |

## Running locally

```sh
npm install
npm run dev      # http://127.0.0.1:5189
npm run build    # static build in dist/
```

Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.

## Project layout

| Folder | Contents |
|---|---|
| `src/game/` | The spearfishing game: speargun, shaft and hit physics, the fish on the line, breath-hold, rules, catch card, cooler and log, vendors and stalls, guide, minimap, HUD |
| `src/engine/` | The rendering engine: math, scene graph and geometry, GPU resources, WGSL shader composition, materials, lighting and shadows |
| `src/ocean/` | FFT ocean, water surface and material, shore waves, breakers, swash, wake, caustics, underwater lighting |
| `src/sky/` | Atmosphere, clouds, sky and environment |
| `src/world/` | Terrain, village, pier, reef, fish, vegetation, rocks, debris, wildlife, whale, boat |
| `src/post/` | Post chain: AO, underwater composite, haze, TAAU, motion blur, bloom, lens flare, droplets |
| `src/materials/` | Shared lighting: shadow filtering, bounce light, contact shadows, local lights, LOD fades |
| `src/player/` | Walking, swimming, the boat and the free camera |
| `src/audio/` | The sample-based soundscape |
| `src/ui/` | Settings panel, loading screen and HUD |
| `tools/` | Scripts that fetch and convert the characters, stall props and fishing sounds |
| `test/` | Headless engine smoke test and game-logic tests (`npm test`), and HUD / loader dev pages |

## Credits and license

The code is released under the MIT license; see [LICENSE](LICENSE). Third-party assets (CC0 audio from
Freesound, CC0 scans from Poly Haven, MIT characters from Microsoft Rocketbox, OFL / Apache fonts) and
technique references are listed in [CREDITS.md](CREDITS.md).
