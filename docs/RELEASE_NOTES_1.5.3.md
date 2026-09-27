# dnjplayer v1.5.3

Sign in with two-factor authentication, and a player that stops interrupting
long sessions. macOS only; nothing here changes Windows.

### ✨ New

- **Accounts with two-factor authentication can sign in.** Turning 2FA on at Mega
  used to make the app unusable: it sat on the sign-in screen for a minute and
  then reported a timeout, because Mega was quietly asking for your code and
  nobody was answering. Enter your email and password as always, and if the
  account has 2FA you now get a six-digit code screen. Pasting the code straight
  from your authenticator app works, spaces and all.

### 🐛 Fixes

- **No more stopping to buffer in the middle of an episode.** The player kept
  about four and a half minutes of video ahead of you — not because that was the
  intention, but because the limit was set in megabytes, and what four and a half
  minutes weighs depends entirely on the file. It is now set in **minutes**: the
  player keeps **20 minutes** ahead, which for a normal episode means it has the
  whole thing well before you get there. Pausing to let it load also works now;
  before, it filled that small buffer and simply stopped.
- **One interruption instead of six.** When playback did run out of data it
  resumed after a single second and ran out again moments later, so one network
  hiccup turned into a flurry of "Buffering" messages. It now waits for a real
  cushion before resuming.
- **Losing less when the app dies.** Changing your audio output — from Bluetooth
  headphones to the laptop speakers, say — can crash the app. That is a fault in
  the video engine, not something this app can prevent, but your place in the
  episode is now saved every 15 seconds instead of every minute, so a crash costs
  you seconds rather than a minute of rewinding.

### 🎨 Improvements

- **The update notice no longer shoves the page around.** It used to appear as a
  bar that pushed everything down the moment a new version was published, moving
  whatever you were about to click. It is now a small floating notice at the top
  that displaces nothing, turns into its own progress bar while downloading, and
  stays out of the way entirely while you are watching something.

### 📝 Notes

- If playback still stops to buffer, the log file now records how much was loaded
  at the moment it ran out, and how long each interruption lasted. On macOS it is
  in `~/Library/Logs/com.dnjplayer.app/`.
- Keeping 20 minutes of video ready costs memory — around 1.7 GB while an episode
  is playing. That is a deliberate trade for not being interrupted, and it is
  released when playback stops.
