# dnjplayer v1.5.6

One fix: no more transparent patches around the picture. macOS only.

### 🐛 Fixes

- **Playing content of a different size no longer leaves transparent gaps.** Go
  from one video to another with a different resolution — a smaller episode after
  a wide film, say — and parts of the picture area could turn see-through, showing
  your desktop behind the app. The only way out was leaving full screen and
  entering it again.

  The video engine was resizing its own output to match each file's pixel
  dimensions, and on macOS that output is the layer the app positions underneath
  its controls. So every change of resolution moved it out from under the space
  reserved for it, and whatever it no longer covered was simply not being painted
  by anything. It is now the app that decides that size, not the engine — and the
  app re-checks it whenever a video's dimensions change, so nothing can drift
  again.

### 📝 Notes

- Full screen is also kept across the change now, instead of being the workaround
  for it.
