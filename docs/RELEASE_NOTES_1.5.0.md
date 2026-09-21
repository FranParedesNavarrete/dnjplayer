# dnjplayer v1.5.0

### ✨ New

- **A player that gets out of the way.** The timeline, the title and the action
  buttons are now drawn **on top of the video** and fade in only when you move
  the mouse — the way you expect a video player to behave. No more fixed bar
  sitting under the picture and stealing screen space: while you watch, you see
  only the video. (macOS for now — see Notes.)
- **It remembers where you stopped.** Open an episode you left half-watched and
  it picks up where you were, without asking. The rules are deliberately boring:
  a position is only kept once you are a second into the file, and it is
  forgotten once you pass 90% — so pressing Play on something you finished
  starts it over instead of dropping you in the credits.
- **You get told when something goes wrong.** Until now a video that failed to
  load left you staring at a black screen with a working progress bar and no
  explanation, forever. Now a message appears, stays until you dismiss it, and
  can expand to show the technical detail — the part worth pasting into a bug
  report.
- **The app keeps a log.** dnjplayer now writes a log file to disk, so "it
  doesn't play" can finally be diagnosed. On macOS it lives in
  `~/Library/Logs/com.dnjplayer.app/`. If you report a problem, send that file.
- **More keyboard control.** `J` / `L` step back and forward like the players you
  already use, `Shift` + arrows nudge one second at a time for subtitle sync
  hunting, `G` / `H` shift the subtitle delay, and **holding** `Space` plays at
  2× until you let go.
- **The next episode starts instantly.** In a queue, dnjplayer now opens the
  following episode's stream while you are still watching the current one, so the
  jump between chapters is immediate instead of leaving you on a black screen
  wondering whether the app has frozen. Measured on a Mega stream: the gap went
  from about six seconds to a tenth of one.
- **You can see when it is buffering, and how far ahead.** A spinner appears when
  playback actually stalls waiting for data — after a short grace period, so a
  momentary hiccup no longer makes it flicker — and the timeline now shows how
  much of the video has been downloaded ahead of where you are.

### 🎨 Improvements

- **Fewer interruptions on Mega streams.** The player is now configured for
  network playback — a much larger read-ahead buffer and a seekable cache — so
  streams stutter and re-buffer noticeably less, and jumping around the timeline
  no longer restarts the download from scratch every time.
- **Dragging the timeline is smooth again.** Scrubbing used to fire a seek on
  every pixel of movement, dozens per drag, each one a new request over the
  network. Now it seeks once, when you let go.
- **A dead connection is noticed in twenty seconds, not sixty.** If the Mega
  bridge is restarted behind the app's back, dnjplayer now gives up on the stale
  stream three times faster, quietly reconnects and keeps playing; only if that
  fails too does it tell you. Before, you got a frozen picture for up to a minute
  and then nothing.
- **Better picture.** The player switched to mpv's newer renderer, with a higher
  quality scaler and debanding enabled — cleaner upscaling and no more visible
  banding in skies and fades, which is where anime shows it most.
- **The volume slider finally goes all the way to 150%.** The top third of it
  silently did nothing before, because the player refused to go past 130.
- **System shortcuts no longer trigger player actions.** `Cmd+R` used to wipe
  your brightness, contrast and saturation settings, because the app saw it as
  the "reset" shortcut. Keyboard combinations that include Cmd, Ctrl or Alt are
  now left to the system and the menus.
- **Caps Lock no longer breaks every shortcut.** Shortcuts are matched
  regardless of letter case.

### 🐛 Fixes

- **Listing a large Mega folder no longer hangs for a minute.** Any folder whose
  listing was big enough to fill the operating system's pipe buffer would lock up
  the bridge until it timed out, leaving you on a spinner for the full minute and
  then showing nothing. Small folders hid the bug. Listings that used to take a
  minute now take a fraction of a second.
- **Your Mega password can no longer appear on screen.** If a login took long
  enough to time out, the error message printed the command that was run — and
  the password travels as one of its arguments, so it ended up in the error
  banner in plain text. Command arguments are no longer put into error messages
  at all. The password was never sent or stored anywhere by this app: it could
  only be displayed, on your own screen, in that one timeout case.
- **Quitting the app no longer leaves your Mega drive shared.** dnjplayer used to
  exit without telling MEGAcmd to stop serving your files over HTTP on your
  machine, so the share stayed up in the background until the next reboot. It is
  now shut down on exit.

### 📝 Notes

- **The overlay player is macOS-only in this release.** On **Windows** the video
  layer is still drawn on top of the interface at the system level, so nothing can
  be painted over it yet and the controls remain in a bar below the video, as
  before. Everything else in this release — resume, streaming tuning, picture
  quality, the shortcuts, the fixes and the log file — applies to Windows too.
  Lifting the video underneath the interface on Windows is the next piece of this
  work.
- Resume is skipped for clips shorter than a minute: re-watching one is quicker
  than thinking about it.
- Switching audio or subtitle track on a **Mega stream** still pauses for a
  second or two while the new track buffers over HTTP, then resumes by itself.
  That is inherent to streaming; local files switch instantly.
- Your watch history, favorites and saved local folders carry over untouched.
- Under the hood this release also adds the project's first automated tests (149
  on the interface side, 32 on the backend) and a continuous-integration check
  that runs them on every change — invisible to you, but it is why this release
  is more boring than the last.
