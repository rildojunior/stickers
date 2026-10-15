#!/bin/sh
# Compila e instala o app no iPhone conectado, assinado com o Apple ID grátis do Xcode.
# A assinatura gratuita vale 7 dias: rode `npm run ios:install` de novo para renovar.
set -eu

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/ios/App/build"

# Time: o OU do certificado "Apple Development" criado pelo Xcode (ou IOS_TEAM_ID).
TEAM="${IOS_TEAM_ID:-$(security find-certificate -c "Apple Development" -p 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1)}"
if [ -z "$TEAM" ]; then
  echo "Nenhum time encontrado. Abra o Xcode > Settings > Accounts, entre com seu Apple ID e tente de novo." >&2
  exit 1
fi

# Primeiro iPhone conectado (cabo ou mesma rede Wi-Fi).
DEVICE="${IOS_DEVICE_ID:-$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && /(available|connected)/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{4}-/) { print $i; exit } }')}"
if [ -z "$DEVICE" ]; then
  echo "Nenhum iPhone encontrado. Conecte pelo cabo, desbloqueie e toque em Confiar." >&2
  exit 1
fi

echo "Time $TEAM · iPhone $DEVICE"
mkdir -p "$BUILD_DIR"
xcodebuild -project "$ROOT/ios/App/App.xcodeproj" -scheme App -configuration Debug \
  -destination "id=$DEVICE" -derivedDataPath "$BUILD_DIR" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic build > "$BUILD_DIR.log" 2>&1 || {
  grep -E "error:" "$BUILD_DIR.log" | head -20 >&2
  echo "A compilação falhou. Log completo: $BUILD_DIR.log" >&2
  exit 1
}

APP="$BUILD_DIR/Build/Products/Debug-iphoneos/App.app"
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" dev.rildo.figurinhas || \
  echo "Instalado. Se não abrir: Ajustes > Geral > VPN e Gerenciamento de Dispositivos > confiar no seu Apple ID."
