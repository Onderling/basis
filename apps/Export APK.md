Three options, in order of effort:

  1. Same WiFi, just open Expo Go (no cable, no APK)

  npx expo start → scan the QR with Expo Go on each phone. Works for as many
  phones as you want, all on the same LAN. If they're on different networks, npx
   expo start --tunnel proxies through Expo's relay (slower but no LAN setup).

  2. EAS Build → APK (best for "give it to a friend")

  You already have eas.json in apps/mesh-demo, so you've used this before. For
  Pinboard-mobile (or any other app):

  cd apps/pinboard-mobile
  eas build --platform android --profile preview

  The preview profile in eas.json should look like:
  "preview": { "distribution": "internal", "android": { "buildType": "apk" } }

  EAS uploads the APK and gives you a shareable URL + QR code. Anyone scans it,
  downloads, sideloads — done. No Play Store, no cable, free tier covers ~30
  builds/month.

  3. Local APK build (if you don't want to wait for EAS queue)

  eas build --platform android --profile preview --local
  Needs Android SDK + Java installed locally. Produces an .apk you can scp /
  drop in Drive / serve over python -m http.server and let phones download.

  iOS caveat

  Without a paid Apple Developer account ($99/yr), there's no APK equivalent —
  Expo Go remains the only cable-free path. With a paid account: TestFlight or
  eas build --profile preview --platform ios for ad-hoc distribution.

