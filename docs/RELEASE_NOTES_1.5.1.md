# dnjplayer v1.5.1

A follow-up to 1.5.0 that fixes what full screen did to the new player, and stops
the buffering indicator interrupting you. macOS only; nothing here changes
Windows.

### 🐛 Fixes

- **Full screen is now actually full screen.** The button used to maximise the
  window, which on macOS means "as large as the desktop allows" — so the menu bar
  stayed across the top of the picture and the Dock stayed at the bottom. Both are
  now hidden while you watch, and the video runs to the edges of the screen.
- **The green window button no longer breaks playback.** Using it — before or
  after the app's own full-screen button — left you with sound and no picture, no
  controls, and after coming back out, an app whose interface was partly
  transparent: you could see whatever window was behind dnjplayer through it. The
  video layer and the interface are stacked in a way that macOS's own full screen
  reverses, so that is switched off and the green button now zooms the window
  instead, which works. Either button, in any order, is safe.
- **The Dock icon stays dnjplayer's.** It used to turn into mpv's icon once
  playback started, most visibly when entering full screen. The video engine was
  claiming the icon for the whole application; it is claimed back now.
- **Buffering no longer interrupts a film to tell you about nothing.** On a Mega
  stream the "Buffering" badge appeared every few seconds. The picture was not
  actually stopping — the player tops up its buffer constantly and it was
  reporting every top-up. It now stays quiet unless playback has genuinely been
  stopped for over a second, which is the point at which you would start
  wondering whether the app had frozen. That is the only thing it is for.
- The app also records how long each real stall lasted in its log file, so if
  streaming still stutters for you, that file now says by how much.

### 📝 Notes

- Full screen keeps the window in your current desktop Space rather than moving
  it to its own, which is what lets the controls be drawn over the video. Pressing
  `Esc` or `F` leaves it, as before.
- Windows is unaffected: the video layer is still composited above the interface
  there, so the controls remain in a bar below the video and the system's own full
  screen is used.
