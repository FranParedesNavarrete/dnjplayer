# dnjplayer v1.5.5

Anime4K actually works now, gamma joins the picture controls, and the video
settings close when you click away. macOS only.

### ⚠️ Read this first if you use Anime4K

**Anime4K has not been doing anything at all, in any version that shipped it.**
The app was looking for the shader files in the wrong place, and the mistake was
invisible: the files were never opened, so there was no upscaling, and the app
reported success anyway.

It works now — which means **whatever quality level you had selected is suddenly
real**. If you had picked one of the heavier ones (VL, UL), you may find playback
stutters or drops frames, because that setting never cost anything before and so
there was nothing to warn you off it.

If that happens, open the video settings and pick a lower level. On an M4 Pro,
**Type A at M or L** plays a 1080p episode cleanly; **UL** does not, even outside
the app. Type A is also the right mode for 1080p sources — Type C is for 480p and
does extra work that a 1080p file does not need.

### ✨ New

- **A gamma slider**, next to brightness, contrast and saturation, on the same
  scale and cleared by the same reset button.

### 🎨 Improvements

- **The video settings close when you click outside them.** Previously the panel
  stayed open until you pressed its button or its close icon.

### 🐛 Fixes

- **Anime4K loads.** See the note above. The shader files were being packaged
  into a different folder than the one the app looked in, and the same mistake
  broke it in development builds too. If they ever cannot be found again, the app
  now says so instead of pretending it worked.

### 📝 Notes

- Playback inside the app costs more per frame than playing the same file in a
  plain video player — measured at about one frame in six dropped on a setting
  that plays perfectly elsewhere. That is the price of drawing the controls over
  the video, and reducing it is the next piece of work. It is why a quality level
  that looks fine on paper may still not be smooth here.
