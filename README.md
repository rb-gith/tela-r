# Tela

A simple, private catalogue for artworks. Add a photo and a title, fill in the rest when you like, and browse your work as a clean gallery on your phone. It works offline, needs no account, and keeps everything on the device.

This is the gionzana version. *Tela* is Italian for "canvas".

## Screens

| Screen | What it shows |
|--------|---------------|
| **Gallery** | Your pieces in two staggered columns, newest first and never cropped, with search and status filters |
| **Piece** | The picture with a museum-style label: title, year, technique, size, status, series, location and notes |
| **Add or edit a piece** | A photo and title are required; everything else is optional |
| **Settings** | Artist name, export and restore |

## How to use

- **Add a piece:** tap **+ add a piece**, choose a photo from your phone, crop or rotate it if you like, and give it a title.
- **Crop or rotate later:** tap **edit** on a piece, then **crop or rotate**. Drag the orange corners to resize the box, or drag inside it to move it. A crop replaces the saved picture, so to undo it later, add the photo again from your phone.
- **Find a piece:** search by title, technique or series, or tap a status. Accents don't matter.
- **See it large:** tap the picture on a piece's page. Pinch or double-tap to zoom.
- **Change or delete a piece:** tap **edit** on its page.
- **Share a piece:** tap **share this piece** to send a picture card through your phone's share menu.

## What stays private

A shared card only shows the title, year, technique, size and artist name, when they're filled in. Status, series, location and notes never leave the phone in a card. Set or remove the artist name in **Settings**.

The ZIP export does contain everything, so keep it somewhere private.

## Your data

Everything is stored on the phone, in the browser's storage. Nothing is ever sent anywhere, and nothing is stored in this repo.

Photos are resized when added, to at most 2000 pixels on their longest side. Your original photo stays where it was on your phone.

App updates don't touch your data, but clearing Chrome's data or changing phones erases it. To keep a copy, use **Settings → export ZIP**, and keep the file somewhere safe. The app gently reminds you if you've made changes and haven't exported for 30 days.

The ZIP contains:

| In the ZIP | What it's for |
|------------|---------------|
| `images/` | Your pictures, named after each piece |
| `catalogue.csv` | All the details, for Excel or Google Sheets |
| `tela-data.json` | What **restore from ZIP** uses to rebuild the catalogue |

**Restore from ZIP** replaces everything currently in the app.

## Install on Android

Open the GitHub Pages address in Chrome, then tap **⋮ → Install app**. The app then opens full-screen from your home screen and works offline.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page shell |
| `styles.css` | Colors, gallery and layout |
| `brand.js` | What makes this the gionzana version; another version only changes this and the icons |
| `lang.js` | All the text |
| `zip.js` | Creates and reads the ZIP files |
| `app.js` | Pieces, photos, gallery, sharing and export |
| `manifest.webmanifest` | App name, colors and icons for "Install app" |
| `sw.js` | Offline support |
| `icons/` | App icons and the logo |

There are no libraries and no build step.

After changing any app file, bump `VERSION` in `sw.js` (e.g. `'v1'` → `'v2'`) so installed copies update.

To try the app with sample pieces, add `?demo` to the address and open Settings. **load sample pieces** and **reset everything** both replace your data, so don't use them on the copy you track your work with.

## Credits

Made by gionzana. If you enjoy it, you can [buy me a coffee](https://buymeacoffee.com/gionzana) ☕
