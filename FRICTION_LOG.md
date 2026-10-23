# Friction Log — VER-DÉ for Fire TV

## 1. No Fire TV simulator on Windows
- **Task:** Run and record the Fire TV app without a physical device.
- **Steps:** Read Fire TV and Vega docs; tried to set up the Vega Virtual Device.
- **Expected:** An official Fire TV simulator usable on Windows.
- **Actual:** The Vega Virtual Device supports macOS/Linux only and runs Vega (React Native) apps only — not Fire OS APKs.
- **Severity:** High
- **Workaround:** Android TV emulator (API 36, x86_64) in Android Studio, which Amazon's docs point to for testing Fire OS apps.
- **Suggestion:** Ship a Fire OS virtual device image for the Android Emulator, or Windows support for the Vega Virtual Device.

## 2. Device availability outside the US
- **Task:** Test on real Fire TV hardware.
- **Expected:** Ability to buy or borrow a Fire TV device locally.
- **Actual:** Not affordable or quickly available in the Philippines within the hackathon window.
- **Severity:** High
- **Workaround:** Emulator recording, clearly labeled in the demo.
- **Suggestion:** A remote device lab or loaner program for hackathon participants.

## 3. Emulator setup: virtualization loop
- **Task:** Start the Android TV emulator.
- **Steps:** Clicked "Enable" for Windows Hypervisor Platform in Android Studio; restarted several times.
- **Expected:** Feature enabled after one restart.
- **Actual:** Warning returned after every restart; the real cause (Intel VT-x disabled in BIOS) was never shown.
- **Severity:** Medium
- **Workaround:** Checked VirtualizationFirmwareEnabled in PowerShell, enabled Intel VMX in BIOS.
- **Suggestion:** Detect and explain "virtualization disabled in firmware" directly.

## 4. Default SDK location on a full system drive
- **Task:** First-run Android Studio setup.
- **Actual:** Setup failed with low-disk errors; the default SDK path was on C:.
- **Severity:** Medium
- **Workaround:** Freed space, moved the SDK to E:\Android\Sdk with ANDROID_AVD_HOME on E:.
- **Suggestion:** Show required space and offer another drive before downloading.

## 5. Installing an APK during emulator boot
- **Task:** Drag-and-drop the APK onto the emulator.
- **Actual:** "The APK failed to install. Error: Could not parse error string."
- **Severity:** Low
- **Workaround:** Waited for the home screen; installed with adb install -r.
- **Suggestion:** Queue the install until boot completes, or show "device still booting."

## 6. Gemini API during development
- **Task:** Call Gemini from the serverless function.
- **Actual:** 400 for a thinking_level field in the old format, then 503 "high demand" the night before recording.
- **Severity:** Medium
- **Workaround:** Updated to thinkingConfig; added retries and fallback models; keyword engine as final fallback.
- **Suggestion:** (For any AI-in-app guidance from Amazon) document resilient patterns — retries, fallbacks — for TV apps where a failure is very visible.
