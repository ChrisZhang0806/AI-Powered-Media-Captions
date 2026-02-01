# macOS Installation Guide

## Common Issue: "App is damaged and can't be opened"

If you see this error when opening **AI Media Captions**:

> "AI Media Captions" is damaged and can't be opened. You should move it to the Trash.

**Don't worry! The app is NOT actually damaged.**

### Why This Happens

This is caused by macOS's security feature (Gatekeeper). Since the app is not notarized by Apple, macOS blocks apps downloaded from the internet. Your file is complete and safe.

---

## Solution

### Method 1: Using Terminal (Recommended)

1. Open **Terminal**
   - Press `Command + Space`, type `Terminal`, and press Enter

2. Copy and run the following command:

   **If the app is in the Applications folder:**
   ```bash
   xattr -cr /Applications/AI\ Media\ Captions.app
   ```

   **If the app is in the Downloads folder:**
   ```bash
   xattr -cr ~/Downloads/AI\ Media\ Captions.app
   ```

3. After running the command, double-click the app to open it normally

---

### Method 2: Allow via System Settings

1. Try to open the app (it will show the damaged message)
2. Go to **System Settings** > **Privacy & Security**
3. Scroll down to the Security section
4. You'll see a message about "AI Media Captions" being blocked
5. Click **Open Anyway**
6. Click **Open** in the confirmation dialog

---

## Notes

- This only needs to be done once; the app will work normally afterward
- This is a common issue with unsigned apps downloaded from the internet, not a security risk
- If you're still concerned, you can scan the app with antivirus software before running

---

## Need Help?

If you encounter other issues, please submit an Issue on GitHub:
https://github.com/ChrisZhang0806/AI-Powered-Media-Captions/issues
