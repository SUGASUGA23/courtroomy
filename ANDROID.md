# Courtroom — Android app

The web app is now also packaged as a **native Android app** using
[Capacitor](https://capacitorjs.com). The web version is unchanged — this just
wraps the same UI in an Android shell. The Android project lives in
`client/android/`.

Because a phone can't talk to `localhost`, the app lets you set the **server
address** on the home screen (the "⚙ Server settings" panel). It also shows
whether it's connected.

---

## 1. One-time setup: install Android Studio

Building an `.apk` needs the Android SDK and a modern Java (JDK 17). The simplest
way to get both is **Android Studio** (free) — it bundles its own Java, so you do
**not** need to install Java separately.

1. Download & install: https://developer.android.com/studio
2. On first launch, let it finish "SDK Components Setup" (downloads the Android
   SDK). Accept the defaults.

> The Java already on this PC is version 8 — too old for the build. Android
> Studio's bundled Java is used automatically when you build from inside it, so
> you can ignore the old Java.

## 2. Build the app

From `courtroom/client`:

```powershell
npm run android:open
```

That rebuilds the web app, copies it into the Android project, and opens it in
Android Studio. Then in Android Studio:

- Wait for the bottom status bar to finish "Gradle sync" (first time downloads
  build tools — can take several minutes).
- **To make an installable file:** menu **Build → Build App Bundle(s) / APK(s) →
  Build APK(s)**. When it finishes, click **locate** — the file is:
  `client/android/app/build/outputs/apk/debug/app-debug.apk`
- **To run on your own phone:** plug the phone in (with USB debugging enabled),
  pick it in the device dropdown, press ▶ Run.

Copy `app-debug.apk` to the phone (email/USB/Drive), tap it, allow "install from
unknown apps," and install.

> Re-build after any code change with `npm run android:sync` (rebuilds + copies
> the web app into the project), then Build APK again in Android Studio.

## 3. Connect the app to your server

The app needs the Courtroom **server** running and reachable.

### Easiest: same Wi-Fi (your PC + phone on one network)

1. Run the server on your PC:
   ```powershell
   cd "courtroom"
   npm run dev
   ```
2. Find your PC's network address — run `ipconfig` and look for the
   **IPv4 Address** (e.g. `192.168.1.50`).
3. On the phone, open the app → **⚙ Server settings** → enter
   `http://192.168.1.50:4000` → **Save & reconnect**. The dot turns green when
   connected.
4. If it won't connect, allow Node.js through **Windows Firewall** (Windows will
   usually prompt the first time the server runs; choose "Private networks").

The server now allows any origin (`CLIENT_ORIGIN=*` in `server/.env`) and the app
allows plain-HTTP (cleartext) so this works without HTTPS.

### Anywhere: host the server online

To play without being on the same Wi-Fi, deploy the `server/` folder to a free
Node host (Render, Railway, Fly.io), then enter that `https://…` URL in Server
settings. (Ask and I can walk you through hosting.)

---

## Quick reference (run inside `courtroom/client`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the web app (browser) — unchanged |
| `npm run android:sync` | Rebuild web app + copy into the Android project |
| `npm run android:open` | …and open it in Android Studio |
| `npm run android:apk` | Build a debug APK from the command line — **needs JDK 17 + `ANDROID_HOME` set** (Android Studio is the easier path) |

App id: `com.courtroom.app` · App name: **Courtroom**
