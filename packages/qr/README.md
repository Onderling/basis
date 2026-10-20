# @onderling/qr

The one first-match loop that classifies a scanned or pasted text: `classifyQrPayload(text, classifiers)` walks an
app's classifiers in order and returns the first `{kind, payload}` that answers, or `{kind: 'unknown'}`.

Pure JS, with no React Native and no Expo, so both the web router and the phone's scanner use it. `@onderling/react-native/qr`
re-exports it for React Native apps. `lint-one-scan-loop` keeps it the only such loop and keeps it free of React Native.
