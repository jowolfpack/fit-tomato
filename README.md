# 🍅 fit tomato

A silent interval timer for handpicked workouts, transcribed from YouTube videos without the talking and music.
Static site (plain HTML/CSS/JS, no build step, no backend), made for GitHub Pages.

## Run locally

The page loads `workouts.json` with `fetch`, which browsers block for `file://` URLs. Start the dev server in the project folder:

```sh
python scripts/serve.py
```

It works like `python -m http.server 8000`, but also supports range requests. Without those, the voice tracks can't jump to the right spot, and Safari/iPhone may not play them at all.

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
     "source": "link to the original video (optional)",
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
The "Voice clips" toggle only appears on the workout page once at least one clip is listed, and never on workouts that have their own voice track.

## Voice tracks (optional)

A workout can have any number of recordings that play along with the timer, e.g. one per friend.
Put them in `audio/<workout-id>/` and list them in the workout:

```json
"tracks": [
  { "title": "das Leben genießen", "src": "audio/bauchfleischzerstoerung/das-leben-geniessen.m4a" },
  { "title": "Another one", "by": "Anna", "src": "audio/bauchfleischzerstoerung/another-one.m4a" }
]
```

- `title` is the name shown in the app and on the phone's lock screen. `by` is optional and is shown next to it.
- Second 0 of a recording is the moment you tap START: 5 seconds of get-ready countdown, then the workout.
- The timer is the master clock. Pause, skip and back move the recording to the matching spot, and it is re-synced if it drifts more than 0.4 s.
- The workout page lists **Silentio** (timer only) and every track. During the workout, the speaker button (🔊/🔇) next to ✕ opens the same list. The choice is remembered per workout.
- Tracks only work at 100% length, because scaled workouts no longer match the recording; at other lengths the workout runs silent. Workouts with tracks never play the random voice clips.
- Keep files small: `ffmpeg -i in.m4a -ac 1 -c:a aac -b:a 80k -movflags +faststart out.m4a`

## Deploy

Push to GitHub, then go to **Settings → Pages → Deploy from branch → `main` / root**.
