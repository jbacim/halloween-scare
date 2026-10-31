# 🎃 Motion Scare

A standalone Halloween web page. It watches the camera for motion and, when something moves, strobes the phone's flashlight and the screen for 5 seconds while playing a synthesized scream.

## Features
- Motion detection by comparing frames from a small, downscaled copy of the camera image
- Switch between front and rear cameras, or pick a specific camera from a list
- Flashlight strobe (Android Chrome and other browsers that support the `torch` constraint)
- Screen strobe, which is also used as the fallback on iOS and when the front camera is in use
- Scream generated with the Web Audio API, so no audio files are needed
- Adjustable sensitivity, live motion meter, test button, and screen wake lock
- Settings are saved in `localStorage`

## Usage
1. Open the page over HTTPS (GitHub Pages works; so does `http://localhost`).
2. Tap **Arm 🎃** and allow camera access.
3. Point the phone at the doorway and wait.

## Publish to GitHub Pages
Push these files to a repo, then go to **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

## ⚠️ Warning
The page uses flashing lights, which can trigger seizures in people with photosensitive epilepsy.
