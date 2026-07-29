// How the user picks tracks from Google Drive. Two methods exist because
// neither is good everywhere (see docs/architecture.md, picker round trip):
//
//   "redirect" - trigger_onepick, a top-level navigation to Google. Multi-select
//                works on phones and Google's cookies are first-party there
//                (immune to third-party-cookie blocking), but Google shows a
//                consent screen every time and Android's Drive app can strand
//                the return in a browser tab.
//   "in-app"   - the classic iframe Picker. Never leaves the app and consent is
//                needed only once, but phones can only select one file at a
//                time and iOS home-screen apps block the iframe's cookies.
//
// Same plain-localStorage pattern as DriveConfig: the value is read at action
// time (and by the settings page), so no reactive store is needed.
const DB_KEY_PICKER_MODE = "googleDrive.pickerMode"

export type GooglePickerMode = "redirect" | "in-app"

export function getGooglePickerMode(): GooglePickerMode {
  return localStorage.getItem(DB_KEY_PICKER_MODE) === "in-app"
    ? "in-app"
    : "redirect"
}

export function setGooglePickerMode(mode: GooglePickerMode) {
  localStorage.setItem(DB_KEY_PICKER_MODE, mode)
}
