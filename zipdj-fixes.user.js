// ==UserScript==
// @name         ZipDJ fixes
// @namespace    https://github.com/thomaswening
// @version      1.2.0
// @description  Track lists: title and mix apart from the release, roomier rows and columns. Download manager: links to release, artist and label. Download history: a Label column and titles as real links. Search: keeps the space you just typed.
// @author       thomaswening
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/thomaswening/zipdj-fixes
// @supportURL   https://github.com/thomaswening/zipdj-fixes/issues
// @match        https://www.zipdj.com/app/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

// No @downloadURL or @updateURL on purpose: a userscript manager updates from the address
// the script was installed from, so the same file serves installs from GitHub and Greasy Fork.
//
// Why the script works this way:
// - Track lists and the download history ask ZipDJ's track search for their tracks. Its
//   answer holds the label, the release and, for an EP, the track title apart from the mix.
//   The download manager loads its own list, which holds the label. The script listens to
//   both answers. It cannot ask by itself: Cloudflare blocks such requests.
// - It runs in the page itself ("@grant none", "@inject-into page"), where the app's
//   XMLHttpRequest and fetch live, and starts as early as it can to see the first request.
// - It adds its own elements next to the app's and hides the app's with CSS instead of
//   changing them, because the app redraws its own elements at any time.
// - On the search results page the app rewrites the URL with the trimmed text after every
//   keystroke and then sets the box from that URL, which drops a space typed in between.

(function () {
  'use strict';

  const LOG_PREFIX = '[ZipDJ fixes]';
  const TRACK_SEARCH_URL_PATTERN = /\/manage-elasticsearch\/zipdj-user-tracks-[^/]+\/_search/;
  const DOWNLOAD_MANAGER_URL_PATTERN = /\/api\/zdmapi\/download-manager(?:[?#]|$)/;
  const SINGLE_RELEASE_TYPE = 'single';
  // A single is often named after its title plus what it contains, as in "Mother (Incl.
  // Osadon Remix)" or "Mother (Remixes)". That suffix is no part of the track's title.
  const RELEASE_CONTENTS_SUFFIX_PATTERN = /\s*\((?:incl\.?\s[^)]*|(?:the\s)?remixes)\)\s*$/i;

  const PLAY_LINK_SELECTOR = 'a.zd-item-play';
  const HISTORY_ROW_SELECTOR = 'tr.zd-row-downloadhistory[data-tr-id]';
  const HISTORY_TITLE_CELL_SELECTOR = 'td.zd-title-d-h';
  const HISTORY_GENRE_CELL_SELECTOR = 'td.zd-label';
  const GENRE_HEADER_TEXT = 'Genre';
  const LIST_TITLE_CELL_SELECTOR = 'td.zd-title';
  const LIST_TITLE_LINK_SELECTOR = 'a.zd-album-title';
  const LIST_NEW_INDICATOR_SELECTOR = '.zd-new-indicator';
  const LIST_ARTIST_HEADER_SELECTOR = 'td.zd-artist';
  const LIST_TITLE_HEADER_TEXT = 'Track / Mix';
  const DOWNLOAD_MANAGER_ROW_SELECTOR = 'li.zd-dm-row';
  const DOWNLOAD_MANAGER_APP_INFO_SELECTOR = ':scope > a.album-title';
  const SEARCH_INPUT_SELECTOR = 'input[placeholder^="Search for Tracks"]';

  // The app's own colour classes, so added text matches the text next to it.
  const APP_BRIGHT_TEXT_CLASS = 'zd-text-dddddd';
  const APP_DIM_TEXT_CLASS = 'zd-text-6b7883';

  const ADDED_MARKER_CLASS = 'zdx-added';
  const OWN_ELEMENT_CLASS = 'zdx-own';
  const LABEL_CELL_CLASS = 'zdx-label-cell';
  const RELEASE_CELL_CLASS = 'zdx-release-cell';
  const SPLIT_TITLE_CLASS = 'zdx-split-title';
  const TITLE_TEXT_CLASS = 'zdx-title-text';
  const DOWNLOAD_MANAGER_ROW_CLASS = 'zdx-dm-row';
  const DOWNLOAD_MANAGER_INFO_CLASS = 'zdx-dm-info';
  const DOWNLOAD_MANAGER_LINE_CLASS = 'zdx-dm-line';
  const LINK_CLASS = 'zdx-link';
  const IN_APP_LINK_ATTRIBUTE = 'data-zdx-in-app';
  const SHOWN_TRACK_ATTRIBUTE = 'data-zdx-shown';
  const GUARDED_ATTRIBUTE = 'data-zdx-guarded';
  const MIDDLE_MOUSE_BUTTON = 1;
  const RELEASE_HEADER_TEXT = 'Release';
  // A fixed width: the app's columns use percentages that already add up to the whole
  // table, so a percentage here would be squeezed to almost nothing.
  const RELEASE_COLUMN_WIDTH = '140px';
  const LABEL_HEADER_TEXT = 'Label';

  /**
   * What the script knows about each track, by track ID. Each answer fills in what it has,
   * so a field is undefined until some answer has named it.
   * @type {Map<string, {labelName?: string, releaseId?: number, releaseName?: string,
   *   releaseType?: string, trackTitle?: string, trackMix?: string}>}
   */
  const tracksById = new Map();
  let typedSearchText = null;

  // ---- What ZipDJ's answers say ----------------------------------------------------------

  function rememberTrack(trackId, fields) {
    const known = tracksById.get(trackId) || {};
    for (const [name, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) known[name] = value;
    }
    tracksById.set(trackId, known);
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function rememberSearchedTracks(responseText) {
    const hits = parseJson(responseText)?.hits?.hits;
    if (!Array.isArray(hits)) return;
    for (const hit of hits) {
      const source = hit._source || {};
      rememberTrack(String(hit._id), {
        labelName: source.label_name,
        releaseId: source.track_release_id,
        releaseName: source.track_release_name,
        releaseType: source.release_type,
        trackTitle: source.track_title,
        trackMix: source.track_mix,
      });
    }
    console.info(LOG_PREFIX, `details known for ${tracksById.size} tracks`);
    onPageChanged();
  }

  // The download manager's list names the release "release_label" and gives no track title.
  function rememberDownloadManagerTracks(responseText) {
    const items = parseJson(responseText)?.download_item_list;
    if (!Array.isArray(items)) return;
    for (const item of items) {
      rememberTrack(String(item.track_id), {
        labelName: item.label_name,
        releaseId: item.release_id,
        releaseName: item.release_label,
        trackMix: item.track_mix,
      });
    }
    console.info(LOG_PREFIX, `labels known for ${items.length} tracks in the download manager`);
    onPageChanged();
  }

  const responseListeners = [
    { urlPattern: TRACK_SEARCH_URL_PATTERN, listener: rememberSearchedTracks },
    { urlPattern: DOWNLOAD_MANAGER_URL_PATTERN, listener: rememberDownloadManagerTracks },
  ];

  function listenerFor(url) {
    return responseListeners.find(({ urlPattern }) => urlPattern.test(String(url)))?.listener;
  }

  function hookResponses() {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      const listener = listenerFor(url);
      if (listener) this.addEventListener('load', () => listener(this.responseText));
      return originalOpen.apply(this, arguments);
    };

    const originalFetch = window.fetch;
    window.fetch = function (input) {
      const response = originalFetch.apply(this, arguments);
      const listener = listenerFor(typeof input === 'string' ? input : input && input.url);
      if (listener) response.then((answer) => answer.clone().text()).then(listener, () => {});
      return response;
    };
  }

  /** The track's own title: an EP names it, a single only through the release's name. */
  function titleOf(track) {
    if (track.trackTitle) return track.trackTitle;
    if (track.releaseType === SINGLE_RELEASE_TYPE && track.releaseName) {
      return track.releaseName.replace(RELEASE_CONTENTS_SUFFIX_PATTERN, '');
    }
    return undefined;
  }

  // ---- Links -----------------------------------------------------------------------------

  function releaseUrl(releaseId) {
    return `/app/single?track_release_id[0]=${releaseId}`;
  }

  function labelUrl(labelName) {
    return `/app/member/newrelease/track-view?label_name[0]=${encodeURIComponent(labelName)}`;
  }

  function artistUrl(artistId) {
    return `/app/member/newrelease/track-view?artist_id[0]=${artistId}`;
  }

  function makeLink(href, element) {
    element.setAttribute('href', href);
    element.classList.add(LINK_CLASS);
  }

  /** A link that a plain click follows inside the app instead of loading a new page. */
  function createInAppLink(href, text) {
    const link = document.createElement('a');
    makeLink(href, link);
    link.setAttribute(IN_APP_LINK_ATTRIBUTE, '');
    link.textContent = text;
    link.title = text;
    return link;
  }

  function createText(text, className) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  function removeOwnElements(container) {
    container.querySelectorAll(`.${OWN_ELEMENT_CLASS}`).forEach((element) => element.remove());
  }

  // Ctrl, Shift or Cmd + click, or middle-click, on one of our links: keep the app's own
  // click handler from also navigating this tab, so only the browser opens a new tab.
  function isNewTabClick(event) {
    return event.ctrlKey || event.metaKey || event.shiftKey || event.button === MIDDLE_MOUSE_BUTTON;
  }

  // A plain click on an added link goes through the app's router instead of a full page
  // load, which would take as long as a fresh visit to the site.
  function navigateInApp(href) {
    history.pushState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  function handleClick(event) {
    const link = event.target.closest?.(`a.${LINK_CLASS}`);
    if (!link) return;
    if (isNewTabClick(event)) {
      event.stopImmediatePropagation();
      return;
    }
    if (link.hasAttribute(IN_APP_LINK_ATTRIBUTE)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigateInApp(link.getAttribute('href'));
    }
    // A plain click on a history title is left to the app, which already opens the release.
  }

  // ---- Download history ------------------------------------------------------------------

  function addLabelCell(genreCell, labelName) {
    const cell = document.createElement('td');
    cell.className = `${genreCell.className} ${LABEL_CELL_CLASS}`;
    cell.title = labelName;
    if (labelName) cell.appendChild(createInAppLink(labelUrl(labelName), labelName));
    genreCell.after(cell);
  }

  function enhanceHistoryRow(row) {
    if (row.classList.contains(ADDED_MARKER_CLASS)) return;
    const track = tracksById.get(row.dataset.trId);
    if (!track || track.labelName === undefined) return;

    const genreCell = row.querySelector(HISTORY_GENRE_CELL_SELECTOR);
    if (genreCell) addLabelCell(genreCell, track.labelName);

    if (track.releaseId !== undefined) {
      for (const titleLink of row.querySelectorAll(`${HISTORY_TITLE_CELL_SELECTOR} a`)) {
        makeLink(releaseUrl(track.releaseId), titleLink);
      }
    }
    row.classList.add(ADDED_MARKER_CLASS);
  }

  // The header row lives in a table of its own, apart from the data rows.
  function addHistoryLabelHeader() {
    if (!document.querySelector(`tr.${ADDED_MARKER_CLASS}`)) return;
    const genreHeader = [...document.querySelectorAll(HISTORY_GENRE_CELL_SELECTOR)].find(
      (cell) =>
        !cell.closest(HISTORY_ROW_SELECTOR) && cell.textContent.trim() === GENRE_HEADER_TEXT,
    );
    if (!genreHeader || genreHeader.nextElementSibling?.classList.contains(LABEL_CELL_CLASS)) {
      return;
    }
    const header = genreHeader.cloneNode(false);
    header.classList.add(LABEL_CELL_CLASS);
    header.textContent = LABEL_HEADER_TEXT;
    genreHeader.after(header);
  }

  function enhanceHistory() {
    document.querySelectorAll(HISTORY_ROW_SELECTOR).forEach(enhanceHistoryRow);
    addHistoryLabelHeader();
  }

  // ---- Track lists: title and mix, then the release --------------------------------------

  // The app reuses a row for another track when the list changes, so each row records which
  // track it shows and whether the script knew the track's details when it drew the row.
  function shownTrackKey(trackId, track, hasReleaseColumn = false) {
    const pendingMark = track ? '' : ':pending';
    const releaseColumnMark = hasReleaseColumn ? ':release' : '';
    return `${trackId}${pendingMark}${releaseColumnMark}`;
  }

  function addReleaseCell(titleCell, releaseName, releaseId) {
    const cell = document.createElement('td');
    cell.className = `zd-text-ellipsis ${RELEASE_CELL_CLASS} ${OWN_ELEMENT_CLASS}`;
    if (releaseName && releaseId !== undefined) {
      cell.appendChild(createInAppLink(releaseUrl(releaseId), releaseName));
    }
    titleCell.after(cell);
  }

  // Shows "Title (Mix)" in place of the app's "Release Mix", which mixes up the two.
  function addSplitTitle(titleCell, title, mix) {
    const titleLink = titleCell.querySelector(LIST_TITLE_LINK_SELECTOR);
    if (!titleLink) return;
    const text = createText(title, `${TITLE_TEXT_CLASS} ${APP_BRIGHT_TEXT_CLASS} ${OWN_ELEMENT_CLASS}`);
    if (mix) text.appendChild(createText(` (${mix})`, APP_DIM_TEXT_CLASS));
    titleLink.insertBefore(text, titleLink.querySelector(LIST_NEW_INDICATOR_SELECTOR));
    titleCell.classList.add(SPLIT_TITLE_CLASS);
  }

  function enhanceListRow(titleCell, hasReleaseColumn) {
    const row = titleCell.closest('tr');
    const playLink = row.querySelector(PLAY_LINK_SELECTOR);
    if (!playLink) return;
    const trackId = playLink.dataset.id;
    const track = tracksById.get(trackId);
    const key = shownTrackKey(trackId, track, hasReleaseColumn);
    if (row.getAttribute(SHOWN_TRACK_ATTRIBUTE) === key) return;

    removeOwnElements(row);
    titleCell.classList.remove(SPLIT_TITLE_CLASS);
    if (hasReleaseColumn) {
      const releaseName = track?.releaseName ?? playLink.dataset.release;
      const releaseId = track?.releaseId ?? playLink.dataset.release_id;
      addReleaseCell(titleCell, releaseName, releaseId);
    }
    const title = track && titleOf(track);
    if (title) addSplitTitle(titleCell, title, track.trackMix);
    row.setAttribute(SHOWN_TRACK_ATTRIBUTE, key);
  }

  // The header row lives in a table of its own, where the title comes before the cover and
  // play cells. So the Release cell goes before the Artist cell, whose look it copies.
  function addListReleaseHeaders(titleHeaders) {
    for (const titleHeader of titleHeaders) {
      const artistHeader = titleHeader.parentElement.querySelector(LIST_ARTIST_HEADER_SELECTOR);
      if (!artistHeader) continue;
      if (artistHeader.previousElementSibling?.classList.contains(RELEASE_CELL_CLASS)) continue;
      const header = artistHeader.cloneNode(true);
      header.className = `zd-text-ellipsis ${RELEASE_CELL_CLASS}`;
      const textHolder = header.querySelector('a') || header;
      textHolder.textContent = RELEASE_HEADER_TEXT;
      artistHeader.before(header);
    }
  }

  // Only lists headed "Track / Mix" get the Release column. A release's own page lists its
  // tracks under another header, and a Release column would only repeat the page's title.
  function enhanceTrackLists() {
    const allTitleCells = [...document.querySelectorAll(LIST_TITLE_CELL_SELECTOR)];
    const titleHeaders = allTitleCells.filter(
      (cell) => cell.textContent.trim() === LIST_TITLE_HEADER_TEXT,
    );
    const hasReleaseColumn = titleHeaders.length > 0;
    for (const titleCell of allTitleCells) {
      if (titleCell.querySelector(LIST_TITLE_LINK_SELECTOR)) {
        enhanceListRow(titleCell, hasReleaseColumn);
      }
    }
    addListReleaseHeaders(titleHeaders);
  }

  // ---- Download manager ------------------------------------------------------------------

  function parseArtists(playLink) {
    const artists = parseJson(playLink.dataset.artist_details || '');
    if (Array.isArray(artists) && artists.length > 0) return artists;
    return [{ artist_name: playLink.dataset.artist || '' }];
  }

  function createLine(...children) {
    const line = document.createElement('span');
    line.className = DOWNLOAD_MANAGER_LINE_CLASS;
    line.append(...children);
    return line;
  }

  function createTitleLine(playLink, track) {
    const releaseName = track?.releaseName ?? playLink.dataset.release;
    const releaseId = track?.releaseId ?? playLink.dataset.release_id;
    const mix = track?.trackMix ?? playLink.dataset.track;
    const title = (track && titleOf(track)) || releaseName;
    const link = createInAppLink(releaseUrl(releaseId), title);
    if (mix) link.appendChild(createText(` (${mix})`, APP_DIM_TEXT_CLASS));
    link.title = releaseName;
    return createLine(link);
  }

  function createArtistLine(playLink) {
    const parts = parseArtists(playLink).flatMap((artist, index) => {
      const separator = index > 0 ? [', '] : [];
      const name = artist.artist_name;
      const element =
        artist.artist_id === undefined
          ? document.createTextNode(name)
          : createInAppLink(artistUrl(artist.artist_id), name);
      return [...separator, element];
    });
    return createLine(...parts);
  }

  function createLabelLine(labelName) {
    return createLine(labelName ? createInAppLink(labelUrl(labelName), labelName) : '');
  }

  function enhanceDownloadManagerRow(row) {
    const playLink = row.querySelector(PLAY_LINK_SELECTOR);
    const appInfo = row.querySelector(DOWNLOAD_MANAGER_APP_INFO_SELECTOR);
    if (!playLink || !appInfo) return;
    const trackId = playLink.dataset.id;
    const track = tracksById.get(trackId);
    const key = shownTrackKey(trackId, track);
    if (row.getAttribute(SHOWN_TRACK_ATTRIBUTE) === key) return;

    removeOwnElements(row);
    const info = document.createElement('div');
    info.className = `${DOWNLOAD_MANAGER_INFO_CLASS} ${OWN_ELEMENT_CLASS}`;
    info.append(
      createTitleLine(playLink, track),
      createArtistLine(playLink),
      createLabelLine(track?.labelName),
    );
    appInfo.after(info);
    row.classList.add(DOWNLOAD_MANAGER_ROW_CLASS);
    row.setAttribute(SHOWN_TRACK_ATTRIBUTE, key);
  }

  function enhanceDownloadManager() {
    document.querySelectorAll(DOWNLOAD_MANAGER_ROW_SELECTOR).forEach(enhanceDownloadManagerRow);
  }

  // ---- Search box ------------------------------------------------------------------------

  function rememberTypedSearchText(event) {
    if (event.target.matches?.(SEARCH_INPUT_SELECTOR)) typedSearchText = event.target.value;
  }

  function isTrimmedCopyOfTypedText(newValue) {
    return (
      typedSearchText !== null &&
      newValue !== typedSearchText &&
      String(newValue).trimEnd() === typedSearchText.trimEnd()
    );
  }

  // When the app sets the box to what the user typed minus trailing spaces, keep the spaces.
  // Chains to the setter already on the element, which React uses to track the value.
  function guardSearchInput(input) {
    if (input.hasAttribute(GUARDED_ATTRIBUTE)) return;
    input.setAttribute(GUARDED_ATTRIBUTE, '');
    const previous =
      Object.getOwnPropertyDescriptor(input, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() {
        return previous.get.call(this);
      },
      set(newValue) {
        previous.set.call(this, isTrimmedCopyOfTypedText(newValue) ? typedSearchText : newValue);
      },
    });
  }

  function guardSearchInputs() {
    document.querySelectorAll(SEARCH_INPUT_SELECTOR).forEach(guardSearchInput);
  }

  // ---- Roomier look ----------------------------------------------------------------------

  // Values to tweak to taste. ZipDJ's own: 40px rows, 12px text, 11px in the download manager.
  const ROOMY_ROW_HEIGHT = '48px';
  const ROOMY_FONT_SIZE = '13px';
  // Shares, like the app's own 100% title, 53% artist, 30% label and 40% genre, which the
  // table scales to fit. Pixels would crush the title and artist with the download manager
  // open.
  const ROOMY_LABEL_COLUMN_WIDTH = '45%';
  const ROOMY_GENRE_COLUMN_WIDTH = '45%';
  const ROOMY_DOWNLOAD_MANAGER_FONT_SIZE = '12px';
  const ROOMY_DOWNLOAD_MANAGER_LINE_HEIGHT = '1.5';

  // Track lists and the download history both live in this container. Each of their rows
  // holds a table of its own, apart from the header row's table.
  const TRACK_LIST_SCOPE = '.zd-track-view';
  const BODY_ROW_TABLE_SELECTOR = 'table.zd-body-row-table';
  // The app sets this class on the body while the download manager panel is open.
  const DOWNLOAD_MANAGER_OPEN_SELECTOR = 'body.zd-slide-open';
  const RELEASE_DATE_CELL_SELECTOR = '.zd-release';

  // The app sets these sizes with "!important", so the script has to as well.
  function addRoomyStyles() {
    const style = document.createElement('style');
    style.textContent = `
      ${TRACK_LIST_SCOPE} table.zd-inner-table td { font-size: ${ROOMY_FONT_SIZE} !important; }
      ${TRACK_LIST_SCOPE} ${BODY_ROW_TABLE_SELECTOR} > tbody > tr > td {
        height: ${ROOMY_ROW_HEIGHT} !important; white-space: nowrap;
      }
      ${TRACK_LIST_SCOPE} .zd-label { width: ${ROOMY_LABEL_COLUMN_WIDTH} !important; }
      ${TRACK_LIST_SCOPE} .zd-genre { width: ${ROOMY_GENRE_COLUMN_WIDTH} !important; }
      ${DOWNLOAD_MANAGER_OPEN_SELECTOR} ${TRACK_LIST_SCOPE} ${RELEASE_DATE_CELL_SELECTOR} {
        display: none !important;
      }
      .${DOWNLOAD_MANAGER_INFO_CLASS} {
        font-size: ${ROOMY_DOWNLOAD_MANAGER_FONT_SIZE};
        line-height: ${ROOMY_DOWNLOAD_MANAGER_LINE_HEIGHT};
      }
    `;
    document.head.appendChild(style);
  }

  // ---- Start -----------------------------------------------------------------------------

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .${LINK_CLASS}[${IN_APP_LINK_ATTRIBUTE}] { color: inherit; }
      .${LINK_CLASS}[${IN_APP_LINK_ATTRIBUTE}]:hover { text-decoration: underline; }
      .${RELEASE_CELL_CLASS} { width: ${RELEASE_COLUMN_WIDTH}; }
      .${SPLIT_TITLE_CLASS} .release-name, .${SPLIT_TITLE_CLASS} .track-name { display: none !important; }
      .${TITLE_TEXT_CLASS} { font-weight: 600; }
      .${DOWNLOAD_MANAGER_ROW_CLASS} > a.album-title { display: none !important; }
      .${DOWNLOAD_MANAGER_INFO_CLASS} {
        display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0;
        font-size: 11px; line-height: 1.4;
      }
      .${DOWNLOAD_MANAGER_LINE_CLASS} {
        display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        color: #627a85;
      }
      .${DOWNLOAD_MANAGER_LINE_CLASS}:first-child { color: #ddd; font-weight: 500; }
    `;
    document.head.appendChild(style);
  }

  function onPageChanged() {
    enhanceHistory();
    enhanceTrackLists();
    enhanceDownloadManager();
    guardSearchInputs();
  }

  // Works whether the manager starts the script before or after the page has loaded.
  function startWhenDocumentIsReady() {
    addStyles();
    addRoomyStyles();
    onPageChanged();
    new MutationObserver(onPageChanged).observe(document.body, { childList: true, subtree: true });
  }

  console.info(LOG_PREFIX, 'running');
  hookResponses();
  window.addEventListener('click', handleClick, true);
  document.addEventListener('input', rememberTypedSearchText, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWhenDocumentIsReady);
  } else {
    startWhenDocumentIsReady();
  }
})();
