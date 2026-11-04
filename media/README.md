Exercise pictures, 3:2 landscape WebP, named after the exercise id in `workouts.json` (e.g. `hip-lift.webp`).

An exercise's `media` can be one path or a list of two; a list is shown stacked (e.g. the two phases of a movement).
A workout's `readyMedia` is shown on the "get ready" screen. Missing files fall back to a text placeholder.

Don't edit these by hand: put the original photos in `pictures/` (git-ignored) and run `python scripts/build_media.py`.
It crops, resizes and strips all metadata (GPS!) from the photos.
