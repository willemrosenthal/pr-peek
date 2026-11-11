// Makes the iPhone app's icon and launch screen from the web app's icon. Run `pnpm icons`
// here after changing apps/web/public/icon.svg.
import sharp from "sharp";

const ICON = new URL("../web/public/icon.svg", import.meta.url).pathname;
const ASSETS = new URL("ios/App/App/Assets.xcassets/", import.meta.url);
// The icon's violet. iOS wants a full square and rounds the corners itself, so the
// icon's own rounded corners are filled with it.
const VIOLET = "#5b2bd1";
// The app's gray (tokens.css), behind the icon while the app opens.
const GRAY = "#f2f2f5";

await sharp(ICON, { density: 300 })
  .resize(1024, 1024)
  .flatten({ background: VIOLET })
  .png()
  .toFile(new URL("AppIcon.appiconset/AppIcon-512@2x.png", ASSETS).pathname);

// The launch screen fills the screen with this image, cropped to fit, so the icon sits
// in the middle of a big square.
const SPLASH = 2732;
const logo = await sharp(ICON, { density: 300 })
  .resize(320, 320)
  .png()
  .toBuffer();
const splash = await sharp({
  create: { width: SPLASH, height: SPLASH, channels: 3, background: GRAY },
})
  .composite([{ input: logo, gravity: "center" }])
  .png()
  .toBuffer();
for (const name of ["", "-1", "-2"]) {
  await sharp(splash).toFile(
    new URL(`Splash.imageset/splash-${SPLASH}x${SPLASH}${name}.png`, ASSETS)
      .pathname,
  );
}
