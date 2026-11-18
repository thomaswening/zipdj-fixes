# ZipDJ fixes

A userscript for members of [ZipDJ](https://www.zipdj.com), the DJ record pool. It fixes annoyances in ZipDJ's member web app, in five places:

- [Track lists](#track-lists): title and mix apart from the release
- [Downloaded tracks](#downloaded-tracks): dimmed in track lists
- [Download manager](#download-manager): links to release, artist and label
- [Download history](#download-history): a Label column and real links
- [Search box](#search-box): keeps the space you just typed

The script sends no requests of its own. It reads titles, releases and labels from data ZipDJ's pages already load. It changes only how pages look and behave in your own browser.

## What it fixes

### Track lists

ZipDJ shows a track as its release's name followed by the mix, so an EP track reads "Musica (EP) One More Time (Extended Mix)". The script shows the title with its mix in brackets, **One More Time (Extended Mix)**, and adds a Release column. A click on a release opens it. For a single, a suffix such as "(Incl. Osadon Remix)" is left out of the title.

![A ZipDJ track list of the label 8bit: each title is followed by its mix in brackets, such as "One More Time (Extended Mix)", and the added Release column shows "Musica (EP)"](docs/images/track-list-release-column.png)

### Downloaded tracks

Track lists dim the tracks you have already downloaded, so new ones stand out when you go through a label or an artist. Hovering a row shows it in full again. ZipDJ's own sign is easy to miss: it only leaves out the download arrow. The replay icon in place of the play icon means you have played the track, not downloaded it. The download history isn't dimmed, since every track there is downloaded.

A track you download now is dimmed the next time its list loads.

![A ZipDJ track list of the label 8bit: the downloaded tracks, such as "Mother (Extended Mix)" and "Musica (Extended Mix)", are dimmed, while the others, such as "Mother (Osadon Remix)", are shown in full](docs/images/track-list-downloaded-dimmed.png)

### Download manager

Each entry links its release, each of its artists and its label, which is added as a third line. For an EP track, the entry shows the track's own title when the track has appeared in a list since the page was loaded. Otherwise it shows the release's name, as ZipDJ does.

![ZipDJ's download manager: each entry shows its title and mix, its artist and its label on three lines, such as "Tribe (Malikk Remix)", Mathias Kaden, 8bit](docs/images/download-manager-links.png)

### Download history

The history gets a Label column. A click on a label lists all of that label's tracks. ZipDJ shows the label on each track page, but not in the history.

Track titles become real links. Middle-click or Ctrl+click opens the release in a new tab, so the history keeps its place and doesn't reload.

![ZipDJ's download history with the added Label column between Genre and Date, showing labels such as Intangible, Axtone and d:vision](docs/images/download-history-labels.png)

### Search box

On the search results page, a space typed right after a letter no longer disappears.

## Status

Version 1.2.0, 18 November 2026. It was tested by injection in Chrome. Version 1.0.0, the first public release, was also tested with Violentmonkey in Firefox.

## Install

1. Install a userscript manager: [Violentmonkey](https://violentmonkey.github.io/) (recommended) or Tampermonkey. In Chrome, also turn on **Allow User Scripts** in the extension's details.
2. Install the script from [Greasy Fork](https://greasyfork.org/scripts/606173-zipdj-fixes) with its install button. Or open [zipdj-fixes.user.js](https://github.com/thomaswening/zipdj-fixes/raw/main/zipdj-fixes.user.js) here on GitHub. The manager offers to install it either way.
3. Reload ZipDJ and open *New Releases*.

The manager checks the address you installed from for new versions. Greasy Fork takes new versions from this repository automatically.

## When it doesn't work

The script depends on how ZipDJ builds its pages. A redesign can break it without any error message. Press F12, open the console and reload the page:

- No line starting with `[ZipDJ fixes]`: the manager doesn't run the script. Check that it is enabled.
- `[ZipDJ fixes] running`, but never `details known for …`: ZipDJ has probably changed how it loads track lists and the history.
- Downloaded tracks aren't dimmed and there is no `downloaded tracks known`: ZipDJ has probably changed how it loads what you have downloaded.
- No `labels known for … tracks in the download manager`: ZipDJ has probably changed how it loads the download manager.

Please [open an issue](https://github.com/thomaswening/zipdj-fixes/issues) with what you see.

## Credit

Written by thomaswening with Claude (Anthropic). It contains no code from ZipDJ.

This project is not affiliated with, endorsed by or connected to ZipDJ Inc. "ZipDJ" is a trademark of its owner. It is used here only to name the site the script works with.

## Licence

GNU General Public License, version 3 or later. See [LICENSE](LICENSE).
