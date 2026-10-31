#!/usr/bin/env bash
# Offline APK compilation. Downloaded toolchain and bundled HTML are prerequisites.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="${MEDIFLOW_ANDROID_TOOLS:-$ROOT/.android-tools}"
OUT="$ROOT/outputs/android-build"
ASSETS="$ROOT/android/app/src/main/assets"
SIGNING="$ROOT/.android-signing"
mkdir -p "$OUT" "$SIGNING"
if [[ ! -s "$ASSETS/index.html" ]]; then
  echo 'Missing bundled Android interface. Run npm run build first.' >&2
  exit 1
fi
if [[ ! -d "$TOOLS" ]]; then
  echo "Missing Android toolchain: $TOOLS" >&2
  exit 1
fi
AAPT2=''
ANDROID_JAR=''
ECJ_JAR=''
while IFS= read -r candidate; do
  case "$candidate" in
    */aapt2) [[ -n "$AAPT2" ]] || AAPT2="$candidate" ;;
    */android.jar) [[ -n "$ANDROID_JAR" ]] || ANDROID_JAR="$candidate" ;;
    */ecj.jar) ECJ_JAR="$candidate" ;;
  esac
done < <(rg --files --hidden --no-ignore "$TOOLS")
for required in "$AAPT2" "$ANDROID_JAR" "$ECJ_JAR"; do
  if [[ -z "$required" || ! -f "$required" ]]; then
    echo 'Toolchain must contain aapt2, android.jar and ecj.jar.' >&2
    exit 1
  fi
done
BUILD_TOOLS="$(dirname "$AAPT2")"
for required in d8 zipalign apksigner; do
  if [[ ! -f "$BUILD_TOOLS/$required" ]]; then
    echo "Missing Android build tool: $BUILD_TOOLS/$required" >&2
    exit 1
  fi
done
chmod +x "$BUILD_TOOLS/aapt2" "$BUILD_TOOLS/d8" "$BUILD_TOOLS/zipalign" "$BUILD_TOOLS/apksigner"
rm -rf "$OUT/classes" "$OUT/dex" "$OUT/generated"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/generated"
python3 - "$ROOT/android/app/src/main/AndroidManifest.xml" "$OUT/AndroidManifest.xml" <<'PY'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text()
source=source.replace('<manifest xmlns:android=', '<manifest package="com.mediflow.pharmacy" xmlns:android=',1)
Path(sys.argv[2]).write_text(source)
PY
"$AAPT2" compile --dir "$ROOT/android/app/src/main/res" -o "$OUT/resources.zip"
"$AAPT2" link -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$OUT/AndroidManifest.xml" \
  --java "$OUT/generated" \
  --min-sdk-version 26 --target-sdk-version 35 \
  --version-code 1 --version-name 1.0.0 \
  -A "$ASSETS" "$OUT/resources.zip"
mapfile -t SOURCES < <(rg --files "$ROOT/android/app/src/main/java" "$OUT/generated" -g '*.java')
java -jar "$ECJ_JAR" -source 17 -target 17 -proc:none \
  -classpath "$ANDROID_JAR" -d "$OUT/classes" "${SOURCES[@]}"
mapfile -t CLASSES < <(rg --files "$OUT/classes" -g '*.class')
"$BUILD_TOOLS/d8" --min-api 26 --lib "$ANDROID_JAR" --output "$OUT/dex" "${CLASSES[@]}"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" ./*.dex)
"$BUILD_TOOLS/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
if [[ ! -f "$SIGNING/mediflow-development.jks" ]]; then
  keytool -genkeypair -keystore "$SIGNING/mediflow-development.jks" \
    -storepass android -keypass android -alias mediflow \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname 'CN=MediFlow Development, OU=Android, O=MediFlow, C=PK' -noprompt
  chmod 600 "$SIGNING/mediflow-development.jks"
fi
"$BUILD_TOOLS/apksigner" sign \
  --ks "$SIGNING/mediflow-development.jks" --ks-key-alias mediflow \
  --ks-pass pass:android --key-pass pass:android \
  --out "$ROOT/outputs/MediFlow.apk" "$OUT/aligned.apk"
"$BUILD_TOOLS/apksigner" verify --verbose "$ROOT/outputs/MediFlow.apk"
"$BUILD_TOOLS/zipalign" -c -p 4 "$ROOT/outputs/MediFlow.apk"
"$AAPT2" dump badging "$ROOT/outputs/MediFlow.apk" | head -12
sha256sum "$ROOT/outputs/MediFlow.apk"
echo "Installable development-signed APK: $ROOT/outputs/MediFlow.apk"
