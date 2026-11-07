# 09. Apple signing (steps for you)

The last part of [plan 09](09-desktop-tauri.md), step 9.8. It signs and notarizes the Mac app, so other people's Macs open it with no warning. Notarization is Apple's automated malware check.

Do parts 1 to 7. Then tell Claude, who does part 8. Part 9 is testing together.

## 1. Join the Apple Developer Program

- [x] Go to https://developer.apple.com/programs/enroll and sign in with your Apple ID. It needs two-factor sign in.
- [x] Enroll as an **Individual**. Your name shows as the developer. (Organization needs a D-U-N-S number, a business ID, and takes longer.)
- [x] Pay the $99 a year. Approval is usually a few hours, up to 2 days.

## 2. Make a certificate request on your Mac

- [x] Open **Keychain Access**.
- [x] Menu: **Keychain Access > Certificate Assistant > Request a Certificate From a Certificate Authority**.
- [x] Fill it in:
  - **User Email Address:** your email.
  - **Common Name:** anything, like `Git Buddy Code Signing`. Apple ignores it. It only labels the private key in your keychain.
  - **CA Email Address:** leave empty.
  - **Request is:** choose **Saved to disk**.
  - **Let me specify key pair information:** leave unticked.
- [x] Click Continue and save the file to your Desktop.

The private key stays in your keychain, not in this file. You only need the file once, in part 3. Delete it after.

## 3. Create the "Developer ID Application" certificate

- [x] Go to https://developer.apple.com/account/resources/certificates and click **+**.
- [x] Choose **Developer ID Application**. Not "Apple Development" or "Mac App Distribution".
- [x] Upload the request file from part 2. Download the `.cer` file.
- [x] Double click the `.cer`. In the Add Certificates window, set **Keychain** to **login**, not iCloud, then click Add. The private key from part 2 is in login, so the certificate must go there too. iCloud fails with error -25294.
- [x] If Keychain Access says the certificate is "not trusted", Apple's middle certificate is missing. Download https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer (also linked as **Developer ID - G2** at the bottom of the Create a New Certificate page), double click it, and add it to **login** too.

## 4. Export it as a .p12 file

- [x] In Keychain Access, open **login > My Certificates**.
- [x] Find **Developer ID Application: Your Name (TEAMID)**. Expand it and check there's a private key under it. If not, the request was made on another Mac.
- [x] Right click it, choose **Export**, and save it as `git-buddy.p12`.
- [x] Set a strong password. Save it in your password manager.
- [x] Check it, and get the exact signing name, needed in part 6. It should say `1 valid identities found`:

  ```sh
  security find-identity -v -p codesigning
  ```

  It looks like `Developer ID Application: Your Name (AB12CD34EF)`.

## 5. Create an App Store Connect API key

This key lets CI send the app to Apple's notarization.

- [x] Go to https://appstoreconnect.apple.com, then **Users and Access > Integrations > App Store Connect API > Team Keys**.
- [x] If asked, request access first. Then click **+** (Generate API Key).
- [x] Name it `Git Buddy CI`, role **Developer**.
- [x] Download the `.p8` file. **You can only download it once.**
- [x] Note the **Key ID** (on the key's row) and the **Issuer ID** (above the table).

## 6. Add the GitHub secrets

Run these from the repo root. Each plain `gh secret set NAME` asks you to paste the value. The lines with `<` or `|` read the value from a file instead.

```sh
base64 -i ~/Desktop/git-buddy.p12 | gh secret set APPLE_CERTIFICATE
gh secret set APPLE_CERTIFICATE_PASSWORD      # the .p12 password
gh secret set APPLE_SIGNING_IDENTITY          # "Developer ID Application: Your Name (TEAMID)"
gh secret set APPLE_API_ISSUER                # the Issuer ID
gh secret set APPLE_API_KEY                   # the Key ID
gh secret set APPLE_API_PRIVATE_KEY < ~/Downloads/AuthKey_XXXX.p8
gh secret set KEYCHAIN_PASSWORD               # any long random string, used only on the CI machine
```

- [x] All seven set.
- [x] `gh secret list` shows 10 secrets (these 7, plus `RELEASE_DEPLOY_KEY` and the two `TAURI_SIGNING_...` ones).

## 7. Clean up

- [x] Put the `.p12`, its password, and the `.p8` in your password manager.
- [x] Delete the loose files: the request file, the `.cer`, the `.p12`, and the `.p8`.

## 8. Claude: the workflow change

Tell Claude the secrets are in. Claude opens a PR that:

- [x] Passes the new secrets from `release.yml` to `desktop-release.yml`, then into the `tauri-action` step.
- [x] Writes the `.p8` to a file on the CI machine and sets `APPLE_API_KEY_PATH` to it. Tauri needs a file path.
- [x] Removes `"signingIdentity":"-"` from the workflow's `--config`.
- [x] Removes the "Open Anyway" note from the release notes.
- [x] Ticks the signing step in [plan 09](09-desktop-tauri.md) and updates the Status table.

## 9. Test it

- [x] A Mac build only runs when `apps/desktop` changed. Wait for the next `feat` or `fix` that touches it, or ask Claude for a small `fix(desktop)` change. Done: a hand run of **Desktop release** for `v1.19.0`.
- [x] Download the new `.dmg` on a Mac that has never run Git Buddy, or ask a friend. It opens with no warning.
- [x] Check in Terminal: `spctl -a -vv "/Applications/Git Buddy.app"` says `accepted` and `Notarized Developer ID`. The release build runs this check too, before it publishes.
- [x] Your current copy still updates. Updates are checked with Tauri's own key, not Apple's. macOS may ask once more for notification or login item permission, since the app's signature changed.

Then finish plan 09's [Done when](09-desktop-tauri.md#done-when) checks, and Claude moves both files to `docs/completed/`. Done on 7 November 2026.
