# dnjplayer v1.5.2

Three fixes to the new full-screen player, all found while actually watching
something. macOS only; nothing here changes Windows.

### 🐛 Fixes

- **"Buffering" no longer sticks on screen.** Once the badge appeared it could
  stay there for the rest of the file, over a video that was playing perfectly
  well. It was not reporting a real stall: the piece of code that decides when to
  take the badge away was cancelling its own timer every time it ran, so the badge
  went up and had no way back down.
- **In full screen, the title and the controls hide again.** They could stay on
  screen permanently. The player keeps them up while your pointer is resting on
  them, which is right — but entering full screen resizes the window underneath a
  pointer that has not moved, and the controls could slide out from under the
  cursor without the app ever being told the pointer had left. It then waited
  forever for a pointer that was no longer there.
- **No more desktop showing through the top of the screen in full screen.** A
  narrow strip along the top edge was left transparent, so you could see your
  desktop behind the app while watching. The video layer now covers the whole
  screen in full screen instead of just the area the page occupies, which fills
  that strip and gives you clean black bars around the picture rather than a
  window with a video inside it.

### 📝 Notes

- If the controls ever fail to hide again, the log file now records which
  condition is holding them up, and real buffering stalls are recorded with their
  duration. On macOS that file is in `~/Library/Logs/com.dnjplayer.app/`.
