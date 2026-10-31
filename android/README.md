# MediFlow for Android

Offline, single-device Android medical-store management. Java Activity and Android WebView render the bundled React application. Validated business actions save a versioned snapshot in native SQLite. No Internet or storage permissions are requested.

## Build in GitHub Actions

The repository includes `.github/workflows/android-apk.yml`. It builds in GitHub's runner, without depending on the author's local network or Android toolchain. The workflow has been prepared but has not yet been run successfully or produced a verified APK in this workspace.

1. Put the complete project source in a GitHub repository, including `src/`, `android/`, `.github/`, `domain.mjs`, `offline-client.mjs`, `build.mjs`, `index.html`, `package.json` and tests. A private repository keeps the application source private.
2. Open **Actions → Build Android APK → Run workflow** on the `main` branch. The workflow also runs after pushes to `main`.
3. Once the run succeeds, open its **Artifacts** section and download **MediFlow-APK**. Unzip it to obtain `app-release.apk`.
4. Install the APK on Android 8.0 or newer. Android may ask you to allow installation from the app used to open the APK.

The workflow installs Node 22, Java 17, Android platform/build tools 35 and Gradle 8.11.1. It runs the business tests, bundles all JavaScript/CSS into `app/src/main/assets/index.html`, then compiles the Android project. It requires no hosted website and no app secrets for the first development build.

## Build locally

Requires Node 22+, JDK 17+, Android SDK platform 35/build tools and Gradle 8.11.1. From the project root:

```sh
npm install --no-audit --no-fund
npm test
npm run build:android
gradle --no-daemon -p android assembleRelease
```

Set `ANDROID_HOME` to an installed Android SDK if Gradle cannot find it. The resulting APK is `android/app/build/outputs/apk/release/app-release.apk`.

## Signing and updates

The release configuration currently uses Android's development signing key, making the first build directly installable. A fresh cloud runner may generate a different development key. Its APK will not update an existing installation signed with another key. Before distributing updates, configure and retain one private signing keystore, keep its passwords in CI secrets, and increase `versionCode` for each release. The current workflow does not upload or expose any signing key.

Export a backup before replacing an installation. Uninstalling the app to change signing keys removes local records. The `.debug` application variant uses a separate package name and installation.

## Build troubleshooting

- **No workflow listed:** confirm `.github/workflows/android-apk.yml` is present on the default branch and GitHub Actions is enabled for the repository.
- **Bundle command missing:** use the full current source; `package.json` must include `build:android`.
- **Dependencies cannot download:** inspect the failed Actions step; GitHub-hosted runners need access to npm, Google Maven and Gradle distributions.
- **No APK artifact:** the upload happens only after tests, the interface bundle and Android compilation all pass. Open the first failed step to see its actual error.
- **App will not update:** check that the signing key matches and the version code is compatible. Back up records before uninstalling.

## Native bridge

`window.NativeStore` methods are synchronous unless noted:

- `load()` returns a JSON string `{state: object|null, version: number}`. A failed read returns `{ok:false,error,version:-1}`; never replace a failed read with empty data.
- `save(expectedVersion, JSON.stringify(state))` performs a native SQLite transaction and returns a JSON string `{ok:true,version}` or `{ok:false,error,version}`. The UI must only confirm an action after a successful save. The version guards against stale writes. Snapshot capacity is 1.5 MB.
- `exportFile(name, content, mime)` opens Android's Save document picker. It returns `{ok:true,pending:true}` immediately. Completion dispatches a `native-export` browser CustomEvent with `{ok,name,error?}`.
- `printReceipt(html)` opens the Android print dialog. Save as PDF and available Android print services work through the system dialog.

A standard HTML file input opens Android's document picker for backup imports. Restore validation and explicit confirmation remain in the bundled business domain. No broad filesystem permissions are needed.

The app's database persists across app restarts and ordinary updates signed with the same key. Uninstalling the app or clearing app data removes local records. Export backups through Settings regularly and before uninstalling. There is no cloud synchronization or automatic cloud backup in this version.

The wrapper blocks network loads, navigation to external origins, JavaScript popups and device-permission requests. Debugging and file URL access are disabled. Documents are read or written only after the user chooses them in the system picker.
