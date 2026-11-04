# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Compte-Tubes: a French-language installable PWA (no build step, vanilla ES modules) that counts pipe ends in a photo. See README.md for the user flow.

## Commands

- Run locally: `python3 -m http.server 8000 -d app`
- Detector tests: `python3 tests/make_samples.py <dir> && node tests/detector.test.mjs <dir>` (needs Pillow; fails if any count is off by more than 3 %)
- Deployment: GitHub Pages via `.github/workflows/pages.yml` (publishes `app/` on push to `main`).

## Architecture

- `app/detector.js` — pure, DOM-free circle detector (`detectCircles`, `scaleFor`). The app rescales images so the pipe radius is ~`WORK_RADIUS` px before detection. Keep it pure so it stays testable in Node.
- `app/worker.js` runs the detector in a module Web Worker; `app/app.js` holds UI state (markers in image pixels, undo stack, calibrate/edit modes, pinch-zoom view transform).
- `app/ai.js` — optional online count via the Anthropic SDK loaded from jsDelivr at a pinned version, called from the browser with the user's own API key (`dangerouslyAllowBrowser`).
- `app/sw.js` — bump `VERSION` when changing the cached file list.
- UI text is in French.
