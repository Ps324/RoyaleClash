# Royal Arena

A self-contained desktop browser game inspired by real-time lane battlers. It uses original names, artwork and code; it does **not** include Supercell/Clash Royale assets, branding, card art, sounds or copied source code.

## Play on a laptop

### Fastest
Open `index.html` in Chrome, Edge or Firefox.

### Local web server (recommended)
```bash
python -m http.server 8000
```
Then open `http://localhost:8000`.

## Controls

- **Mouse** — click one of the four cards, then click a valid deployment position
- **1–4** — select a card in hand
- **Esc / right-click** — cancel selection
- **R** — restart the battle
- **M** — mute/unmute generated sound effects

## Gameplay

- Two lanes with two bridges
- Two Guard Towers + one Citadel per side
- Elixir resource, 8-card deck and 4-card hand
- Melee, ranged, tank, swarm and siege-style troops
- Area and stun spells
- Tower targeting and projectiles
- Enemy AI that deploys troops and spells
- 3-minute regulation battle + 1-minute sudden-death overtime when tied
- Crown scoring and instant victory when the Citadel falls
- Double elixir in the final minute

## Tech

- HTML5 Canvas
- Vanilla JavaScript
- Web Audio API (generated effects only)
- No dependencies
- No external art/fonts/audio

## GitHub Pages

The project is fully static. It can be hosted directly with GitHub Pages after choosing the desired branch/folder as the Pages source (or by adapting the repository's existing Pages workflow).
