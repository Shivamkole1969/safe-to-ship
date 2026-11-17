'use strict';
// App-store blockers for Capacitor, Expo / React Native and native Android/iOS projects.

// Google Play: new apps and updates must target Android 16 (API 36) since 31 Aug 2026.
// https://support.google.com/googleplay/android-developer/answer/11926878 (checked 18 Nov 2026)
const PLAY_MIN_TARGET = 36;

module.exports = function mobile(ctx) {
  const out = [];
  const gradle = ctx.files.filter((f) => /(^|\/)app\/build\.gradle(\.kts)?$/.test(f) || /(^|\/)android\/variables\.gradle$/.test(f));
  for (const f of gradle) {
    const text = ctx.read(f);
    const m = /targetSdk(?:Version)?\s*[=:]?\s*(\d{2})/.exec(text);
    if (m && Number(m[1]) < PLAY_MIN_TARGET) {
      out.push({
        id: 'android-target-sdk', severity: 'high', file: f, line: ctx.lineOf(text, m.index),
        title: 'Android targetSdk is ' + m[1] + '; Google Play requires ' + PLAY_MIN_TARGET + ' for new apps and updates',
        detail: 'Play Console refuses uploads below the current target API level (Android 16 / API 36 since 31 Aug 2026).',
        fix: 'Set targetSdkVersion (and compileSdkVersion) to ' + PLAY_MIN_TARGET + ', then test permissions and edge-to-edge layout. Rule: https://support.google.com/googleplay/android-developer/answer/11926878'
      });
    }
    if (/debuggable\s*(true|=\s*true)/.test(text)) {
      out.push({ id: 'android-debuggable', severity: 'high', file: f, title: 'A build type is marked debuggable', detail: 'Play rejects debuggable release builds, and they expose app internals.', fix: 'Remove `debuggable true` from the release build type.' });
    }
  }
  for (const f of ctx.files.filter((x) => /AndroidManifest\.xml$/.test(x) && !/\/build\//.test(x))) {
    const text = ctx.read(f);
    if (/usesCleartextTraffic\s*=\s*"true"/.test(text)) {
      out.push({ id: 'android-cleartext', severity: 'medium', file: f, title: 'The app allows unencrypted http:// traffic', detail: 'Data sent over plain http can be read or changed on public Wi-Fi.', fix: 'Remove android:usesCleartextTraffic="true" and use https everywhere (or a network security config for one specific dev host).' });
    }
    if (/android\.permission\.(READ_SMS|RECEIVE_SMS|READ_CALL_LOG|MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES|ACCESS_BACKGROUND_LOCATION|REQUEST_INSTALL_PACKAGES)/.test(text)) {
      out.push({ id: 'android-restricted-permission', severity: 'medium', file: f, title: 'The app asks for a restricted Android permission', detail: 'SMS, call log, all-files, all-packages, background location and install-packages permissions need a declaration form in Play Console and are often rejected.', fix: 'Remove any permission the app does not truly need, or prepare the Play Console permission declaration with a video of the feature that uses it.' });
    }
  }
  for (const f of ctx.files.filter((x) => /Info\.plist$/.test(x))) {
    const text = ctx.read(f);
    const re = /<key>(NS\w+UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[2].trim().length < 15) {
        out.push({ id: 'ios-usage-description', severity: 'medium', file: f, line: ctx.lineOf(text, m.index), title: m[1] + ' has a missing or vague explanation', detail: 'Apple rejects apps whose permission prompts do not say clearly why access is needed (Guideline 5.1.1).', fix: 'Write a full sentence, for example "We use the camera so you can scan receipts into your expense list."' });
      }
    }
  }
  if (ctx.has('app.json') && /"expo"\s*:/.test(ctx.read('app.json'))) {
    const text = ctx.read('app.json');
    if (!/"package"\s*:/.test(text)) {
      out.push({ id: 'expo-no-android-package', severity: 'low', file: 'app.json', title: 'Expo config has no android.package', detail: 'EAS needs a permanent package name before the first Play upload; it can never change afterwards.', fix: 'Add `"android": { "package": "com.yourname.appname" }` (and `"ios": { "bundleIdentifier": ... }`).' });
    }
  }
  const isMobile = gradle.length || ctx.deps.has('@capacitor/core') || ctx.deps.has('expo') || ctx.deps.has('react-native');
  if (isMobile && !ctx.files.some((f) => /privacy/i.test(f))) {
    out.push({ id: 'mobile-store-checklist', severity: 'info', file: null, title: 'Store submission reminders', detail: 'Both stores need a public privacy-policy URL, and Google Play needs the Data safety form. New personal Play developer accounts must run a closed test with at least 12 testers for 14 days before production access (use real testers; buying fake ones breaks Play policy).', fix: 'Host a privacy policy page, fill Data safety to match what the app really collects, and line up 12 real testers early.' });
  }
  return out;
};
