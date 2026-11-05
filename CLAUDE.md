# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Compte-Tubes: a French-language installable PWA (no build step, vanilla ES modules) that counts pipe ends in a photo. See README.md for the user flow.

## Commands

- Run locally: `python3 -m http.server 8000 -d app`
- Detector tests: `python3 tests/make_samples.py <dir> && node tests/detector.test.mjs <dir>` (needs Pillow; fails if any count is off by more than 3 %)
- Deployment: Netlify site `compte-tubes` (https://compte-tubes.netlify.app), Git-connected, publishes `app/` as-is per `netlify.toml`. CI (`.github/workflows/tests.yml`) only runs the detector tests (pipes and screws).

## Architecture

- `app/detector.js` — pure, DOM-free circle detector (`detectCircles`, `scaleFor`). The app rescales images so the pipe radius is ~`WORK_RADIUS` px before detection. Keep it pure so it stays testable in Node.
- `app/worker.js` runs the detector in a module Web Worker; `app/app.js` holds UI state (markers in image pixels, undo stack, calibrate/edit/zone modes, optional counting-zone polygon, pinch-zoom view transform).
- Counting zone: offline detection always runs on the whole photo, then markers are filtered by the polygon (cropping changes detector thresholds and gave different counts). The AI path crops to the zone and greys out the outside.
- `app/ai.js` — optional online count via the Anthropic SDK loaded from jsDelivr at a pinned version, called from the browser with the user's own API key (`dangerouslyAllowBrowser`).
- `app/sw.js` — bump `VERSION` when changing the cached file list.
- UI text is in French.

## Compte-Vis (`app/vis/`)

Second PWA, same structure, served at `/vis/` by the same Netlify site. Counts screws/small parts spread on a plain background.
- `app/vis/screws.js` — pure detector: global background model (dominant colour + per-channel quadratic lighting fit), colour-distance mask, morphology, connected components. `estimateUnit` picks the single-piece area; a component of n units counts n pieces; above `MAX_GROUP` it becomes one "cluster" marker whose `weight` is the area estimate. Keep it DOM-free.
- `app/vis/app.js` keeps the last detection (`det`: comps + label map at work scale) so calibration (tap one isolated screw) and zone changes rebuild markers without re-running detection. Count = sum of marker `weight`.
- Tests: `python3 tests/make_screw_samples.py <dir> && node tests/screws.test.mjs <dir>` (±3 %).
- Each app has its own service worker; cache names are prefixed (`tubes-…`, `vis-…`) and each only deletes its own. Bump the relevant `VERSION` when changing cached files. The Anthropic key is shared through `localStorage` (`anthropicKey`, same origin).
