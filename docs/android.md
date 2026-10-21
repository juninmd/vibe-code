# Android app

The web UI ships as an Android app through [Capacitor](https://capacitorjs.com) (`packages/web/android`).
The app is a thin client: on first launch it asks for the Harness server URL
(e.g. `http://192.168.0.10:3000`), validates `GET /health`, and stores it.
Requests to `/api/*` and the `/ws` socket then go to that server (`src/native/`).

## Build

Requires JDK 17+ and Android Studio / SDK.

```bash
cd packages/web
bun run android:sync   # vite build + cap sync
bun run android:open   # open in Android Studio (or: bun run android:run)
```

Debug APK without Studio: `cd packages/web/android && ./gradlew assembleDebug`.

## Notes

- WebView scheme is `http` with cleartext allowed so LAN servers work; prefer HTTPS when exposed publicly.
- Key-protected servers: enter the access key on the login screen (sent as Bearer / `api_key`).
- GitHub OAuth login is cookie based and is not supported in the app; use an access key.
- The service worker is not registered inside the app.
- To change the server, clear the app data.
