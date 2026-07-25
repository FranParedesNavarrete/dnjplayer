# dnjplayer v1.4.0

### ✨ New

- **Play your own files.** A new **Local Files** section lets you browse your
  computer and external drives and play video straight from them — no need for a
  second player alongside dnjplayer. Add a folder once and it's saved for next
  time, so your series live one click away. Only playable files are listed, so
  pointing it at your Downloads folder won't bury you in installers and PDFs.
  It works **with no MEGAcmd and no Mega account**, so the app is now useful
  before you ever log in.
- **Choose your audio and subtitle track.** Files with several audio tracks or
  subtitle tracks — the norm in anime — no longer force you to take whatever came
  first. Pick either from the new track panel in the player, or cycle them with
  **A** (audio) and **S** (subtitles). Subtitle cycling includes an "off" step;
  audio cycling never mutes your video.
- **Load external subtitles.** Got a `.srt` you downloaded separately? Load it
  from the track panel. For local files, a subtitle sitting next to the video with
  a matching name is picked up automatically.
- **Preferred languages.** Set your preferred audio and subtitle language once in
  Settings (for example Japanese audio with Spanish subtitles) and every file you
  open starts that way.
- **Local content in History and Favorites.** Watch history and favorites now
  cover both sources, each row marked with where it came from. Favouriting a local
  folder and clicking it later takes you straight back into it.

### 🎨 Improvements

- Local folder listings are sorted naturally, so `Ep 2` comes before `Ep 10`
  instead of after it.
- Folders that have gone away — an external drive you unplugged — now say so
  clearly and offer a way back, instead of showing a raw error.

### 🐛 Fixes

- **Fixed a crash that closed the app** when cycling audio tracks. The cause was
  in the bundled native mpv wrapper, on the code path that *requests* a property;
  the app no longer uses it.
- Symlinked video files showed the size of the link (a few bytes) instead of the
  real file, and broken symlinks appeared as playable. Relevant to Linux/NAS
  libraries.
- Searching a local folder is now bounded in time and scope, so searching from the
  root of a big drive can't hang the interface.
- **Windows:** drive letters are now enumerated without touching each drive, so a
  disconnected network drive no longer freezes the list for up to 45 seconds, and
  an empty card reader no longer triggers the "no disk in drive" system dialog.
- Corrected the docs: the Queue page is the **playback** queue for the chapters
  you have lined up, not a pre-processing queue, and the Docker pre-processing
  pipeline — designed back when this was going to be a web app, never implemented
  — is gone from the documentation.

### 📝 Notes

- Switching audio or subtitle track on a **Mega stream** pauses for a second or
  two while mpv re-buffers the new track over HTTP, then resumes on its own. This
  is inherent to streaming; local files switch instantly.
- Existing watch history and favorites carry over untouched — this release adds
  local entries alongside them without migrating anything.
