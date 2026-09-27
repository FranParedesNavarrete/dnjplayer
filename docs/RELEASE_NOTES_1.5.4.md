# dnjplayer v1.5.4

One fix: the app no longer quietly fills your disk. macOS only.

### 🐛 Fixes

- **Streamed files stop piling up on disk.** Playing from Mega does not really
  stream — the bridge the app uses downloads each file to a hidden folder while
  it serves it, so that skipping back is instant. That folder was never being
  cleared: one user's had grown to **2.6 GB**, and it would have kept going for
  as long as the app was used. It is now kept to a budget, cleaned every few
  minutes, and a file you are watching is never removed while you watch it.

### 📝 Notes

- The limit is about 4 GB, trimmed back to 1 GB when it is passed, and only files
  untouched for fifteen minutes are removed. In practice that means the episode
  you are on and the next one stay put, and the ones you finished are cleared.
- The trade-off is that replaying something you watched a while ago downloads it
  again. That is the right way round for a queue you watch once.
- If you want the folder emptied completely rather than just bounded, signing out
  of Mega clears it: that cache belongs to the session.
- This changes a setting in MEGAcmd itself, which is shared with anything else on
  your Mac that uses it.
