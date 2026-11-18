# ZipDJ fixes

A userscript for members of [ZipDJ](https://www.zipdj.com), the DJ record pool. It fixes three annoyances in ZipDJ's member web app:

- **Labels in the download history.** The history gets a Label column. A click on a label lists all of that label's tracks. The label is shown on each track page, but the history doesn't show it.
- **Real links in the download history.** Track titles become links. Middle-click or Ctrl+click opens the release in a new tab, so the history keeps its place and doesn't reload.
- **Spaces in the search box.** On the search results page, a space typed right after a letter no longer disappears.

![ZipDJ's download history with the added Label column between Genre and Date, showing labels such as Intangible, Axtone and d:vision](docs/images/download-history-labels.png)

The script sends no requests of its own. It reads the labels from data the history page already loads, and it changes only how pages look and behave in your own browser.

## Status

Version 1.0.0, first public release, 18 November 2026. It was tested with Violentmonkey in Firefox and by injection in Chrome.

## Install

1. Install a userscript manager: [Violentmonkey](https://violentmonkey.github.io/) (recommended) or Tampermonkey. In Chrome, also turn on **Allow User Scripts** in the extension's details.
2. Install the script from [Greasy Fork](https://greasyfork.org/scripts/606173-zipdj-fixes) with its install button. Or open [zipdj-fixes.user.js](https://github.com/thomaswening/zipdj-fixes/raw/main/zipdj-fixes.user.js) here on GitHub. The manager offers to install it either way.
3. Reload ZipDJ and open *Download History* from your account menu.

The manager checks the address you installed from for new versions. Greasy Fork takes new versions from this repository automatically.

## When it doesn't work

The script depends on how ZipDJ builds its pages. A redesign can break it without any error message. Press F12, open the console and reload the page:

- No line starting with `[ZipDJ fixes]`: the manager doesn't run the script. Check that it is enabled.
- `[ZipDJ fixes] running`, but never `labels known for …`: ZipDJ has probably changed how it loads the history.

Please [open an issue](https://github.com/thomaswening/zipdj-fixes/issues) with what you see.

## Credit

Written by thomaswening with Claude (Anthropic). It contains no code from ZipDJ.

This project is not affiliated with, endorsed by or connected to ZipDJ Inc. "ZipDJ" is a trademark of its owner. It is used here only to name the site the script works with.

## Licence

GNU General Public License, version 3 or later. See [LICENSE](LICENSE).
