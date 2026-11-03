# 🍅 fit tomato

A silent interval timer for handpicked workouts, transcribed from YouTube videos without the talking and music.
Static site (plain HTML/CSS/JS, no build step, no backend), made for GitHub Pages.

## Run locally

The page loads `workouts.json` with `fetch`, which browsers block for `file://` URLs. Start a tiny server in the project folder:

```sh
python -m http.server 8000
```

Then open <http://localhost:8000>. To test on your phone, use your computer's LAN IP, e.g. `http://192.168.0.23:8000`.
(Wake Lock only works over HTTPS or on localhost, so on the phone it only works on GitHub Pages.)

## Add a workout

Everything lives in `workouts.json`, which has three parts:

1. **`categories`**: id → display name per language.
2. **`exercises`**: the exercise library, shared by all workouts. The key is a lowercase id (`a-z`, `0-9`, `-`).
   ```json
   "hip-lift": {
     "name":        { "en": "Hip Lift", "de": "Hüftheben" },
     "description": { "en": "Feet in the air (candle)…", "de": "Füße in die Luft (Kerze)…" },
     "media": "media/hip-lift.webp"
   }
   ```
3. **`workouts`**: an ordered list of steps that point to exercises:
   ```json
   {
     "id": "my-workout",
     "name": { "en": "My Workout", "de": "Mein Workout" },
     "category": "core",
     "author": "who transcribed it",
     "credit": "who made the original video",
     "steps": [
       { "exercise": "hip-lift", "duration": 30 },
       { "exercise": "rest", "duration": 15 }
     ]
   }
   ```

Rules:
- Durations are in seconds. Copy them from the original, with no extra transition time.
- A rest is just another exercise (e.g. `"rest"`) and is scaled like everything else.
- Any text field can be a plain string instead of `{ "en", "de" }`. It is then shown in both languages.

## Pictures

Put one file per exercise in `media/`, named after the exercise id. `.webp`, `.png`, `.jpg`, `.gif`, `.svg`, `.webm` and `.mp4` all work. Set the path in the exercise's `media` field.
Until a file exists, the player shows the exercise description inside the ring instead.
Square images work best, because they are shown inside a circle.

## Voice clips (optional)

Drop MP3s into `audio/` and list them in `audio/voice.json`:

```json
{ "start": ["audio/start-1.mp3"], "half": [], "last10": [], "end": [] }
```

One clip is picked at random for each moment: workout start, halfway, last 10 seconds, and end.
The toggle on the workout page stays greyed out until at least one clip is listed.

## Deploy

Push to GitHub, then go to **Settings → Pages → Deploy from branch → `main` / root**.
