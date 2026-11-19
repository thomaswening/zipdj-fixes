// ==UserScript==
// @name         ZipDJ fixes
// @namespace    https://github.com/thomaswening
// @version      1.5.0
// @description  Track lists: title and mix apart from the release, downloaded tracks dimmed or hidden, roomier rows and columns, keyboard shortcuts (press ?). Download manager: links to release, artist and label. Download history: a Label column and titles as real links. Search: keeps the space you just typed.
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
// - For each track list, ZipDJ also loads which of its tracks the member has downloaded.
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
  const USER_TRACK_DATA_URL_PATTERN = /\/api\/zdmapi\/get-user-track-data(?:[?#]|$)/;
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
  // Above a track list, the genre tabs and the bar with Genre Filter, Key and BPM.
  const LIST_FILTER_BARS_SELECTOR = '.zd-v5-tp-down-filter > .d-flex';
  const APP_FILTER_DROPDOWN_SELECTOR = '.zd-dropdown';
  // The look of the app's own buttons in that bar.
  const APP_FILTER_BUTTON_CLASSES = 'zd-top-dropdown top-downloads-filter-btn zd_v5 btn btn-secondary';

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
  const DOWNLOADED_ROW_CLASS = 'zdx-downloaded';
  const DOWNLOADED_ROW_OPACITY = 0.4;
  const HIDE_DOWNLOADED_CLASS = 'zdx-hide-downloaded';
  const HIDE_DOWNLOADED_TOGGLE_CLASS = 'zdx-hide-downloaded-toggle';
  const HIDE_DOWNLOADED_STORAGE_KEY = 'zdx-hide-downloaded';
  const HIDE_DOWNLOADED_TEXT = 'Hide downloaded';
  const SHOW_DOWNLOADED_TEXT = 'Show downloaded';
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
  // Kept apart from tracksById: a track found there counts as known to the title and
  // Release column, which this answer, holding no titles, must not change.
  const downloadedTrackIds = new Set();
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

  // The answer lists each track of the list with flags 0 or 1, as in
  // {track_id: "1327324", is_track_downloaded: 1, is_track_previewed: 1, ...}.
  function rememberDownloadedTracks(responseText) {
    const entries = parseJson(responseText);
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      const trackId = String(entry.track_id);
      if (entry.is_track_downloaded) downloadedTrackIds.add(trackId);
      else downloadedTrackIds.delete(trackId);
    }
    console.info(LOG_PREFIX, `${downloadedTrackIds.size} downloaded tracks known`);
    onPageChanged();
  }

  const responseListeners = [
    { urlPattern: TRACK_SEARCH_URL_PATTERN, listener: rememberSearchedTracks },
    { urlPattern: DOWNLOAD_MANAGER_URL_PATTERN, listener: rememberDownloadManagerTracks },
    { urlPattern: USER_TRACK_DATA_URL_PATTERN, listener: rememberDownloadedTracks },
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

  // ---- Track lists: downloaded tracks dimmed --------------------------------------------

  // Sets the class on every pass, since the app reuses a row for another track. ZipDJ's own
  // sign of a download, a missing download arrow, is easy to overlook.
  function dimDownloadedRows() {
    for (const playLink of document.querySelectorAll(PLAY_LINK_SELECTOR)) {
      // In the history every track is downloaded, so dimming its rows would tell nothing.
      // A history row holds a table of its own, so its play link sits in an inner row.
      // The download manager's rows are list items, not table rows.
      const row = playLink.closest('tr');
      if (!row || playLink.closest(HISTORY_ROW_SELECTOR)) continue;
      row.classList.toggle(DOWNLOADED_ROW_CLASS, downloadedTrackIds.has(playLink.dataset.id));
    }
  }

  // ---- Track lists: downloaded tracks hidden on request ----------------------------------

  // The choice is kept in the browser, so it holds for every list until changed. Storage can
  // be blocked, as in some private windows; then the choice holds until the page reloads.
  function readHideDownloaded() {
    try {
      return localStorage.getItem(HIDE_DOWNLOADED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function storeHideDownloaded(hide) {
    try {
      localStorage.setItem(HIDE_DOWNLOADED_STORAGE_KEY, String(hide));
    } catch {
      // The choice still holds until the page reloads.
    }
  }

  let hideDownloaded = readHideDownloaded();

  function updateHideDownloadedToggle(toggle) {
    const text = hideDownloaded ? SHOW_DOWNLOADED_TEXT : HIDE_DOWNLOADED_TEXT;
    // Writing the same text again would wake the page observer for nothing.
    if (toggle.textContent !== text) toggle.textContent = text;
    toggle.setAttribute('aria-pressed', String(hideDownloaded));
  }

  // The class on the root element hides the rows by CSS, so rows the app draws later are
  // hidden too.
  function applyHideDownloaded() {
    document.documentElement.classList.toggle(HIDE_DOWNLOADED_CLASS, hideDownloaded);
    document.querySelectorAll(`.${HIDE_DOWNLOADED_TOGGLE_CLASS}`).forEach(updateHideDownloadedToggle);
  }

  function toggleHideDownloaded(event) {
    event.preventDefault();
    event.stopPropagation();
    hideDownloaded = !hideDownloaded;
    storeHideDownloaded(hideDownloaded);
    applyHideDownloaded();
  }

  function createHideDownloadedToggle() {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `${APP_FILTER_BUTTON_CLASSES} ${HIDE_DOWNLOADED_TOGGLE_CLASS}`;
    toggle.addEventListener('click', toggleHideDownloaded);
    updateHideDownloadedToggle(toggle);
    const holder = document.createElement('div');
    holder.className = `mr-2 ${OWN_ELEMENT_CLASS}`;
    holder.appendChild(toggle);
    return holder;
  }

  function addHideDownloadedToggles() {
    for (const filterBar of document.querySelectorAll(LIST_FILTER_BARS_SELECTOR)) {
      if (!filterBar.querySelector(APP_FILTER_DROPDOWN_SELECTOR)) continue;
      if (filterBar.querySelector(`.${HIDE_DOWNLOADED_TOGGLE_CLASS}`)) continue;
      filterBar.prepend(createHideDownloadedToggle());
    }
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

  // ---- Keyboard shortcuts ----------------------------------------------------------------

  // ZipDJ has keys of its own (its player's keyboard icon lists them). Its row keys work only
  // on some lists, not on a release's page, and step onto rows hidden by "Hide downloaded".
  // So the script takes over the row keys and leaves the player's keys to ZipDJ. It marks
  // the selected row with ZipDJ's own class, so ZipDJ's Tab still acts on that row.
  const APP_SELECTED_ROW_CLASS = 'hotkey-bg';
  const TRACK_ROW_SELECTOR = 'tr.zdtrackslist';
  const ADD_TO_DOWNLOAD_LIST_SELECTOR = 'a.zd-download-btn';
  const NEXT_PAGE_SELECTOR = '.sk-pagination-navigation [data-key="next"]:not(.is-disabled)';
  const PREVIOUS_PAGE_SELECTOR = '.sk-pagination-navigation [data-key="previous"]:not(.is-disabled)';
  const SHORTCUTS_OVERLAY_CLASS = 'zdx-shortcuts';
  const APP_ACCENT_COLOUR = '#4f7be9';
  const SELECTED_ROW_BACKGROUND = 'rgba(79, 123, 233, 0.18)'; // the accent colour, faded
  // Wider than any cell, so an inset shadow of this spread fills the whole cell.
  const SCREEN_COVERING_SHADOW_SPREAD = '9999px';
  // Keeps a row scrolled to by a key clear of the app's top bar and its player at the bottom.
  const ROW_SCROLL_MARGIN = '80px';
  const NEXT_ROW = 1;
  const PREVIOUS_ROW = -1;

  /** ZipDJ's keys that the script leaves alone, for the list that "?" shows. */
  const APP_SHORTCUTS = [
    { label: 'Space', description: 'Play or pause' },
    { label: 'Tab', description: 'Add the selected track to the download list' },
    { label: 'Backspace', description: 'Mute' },
    { label: 'Ctrl + ← →', description: 'Seek' },
  ];

  /**
   * The script's keys. "keys" holds values of KeyboardEvent.key in lower case. A row key acts
   * only where a track list is shown, so elsewhere the arrows still scroll the page. A key
   * that yields to a focused control leaves Enter on a focused button to that button.
   */
  const OWN_SHORTCUTS = [
    { label: '↓ or J', keys: ['arrowdown', 'j'], description: 'Select the next track',
      isRowKey: true, run: () => moveSelection(NEXT_ROW) },
    { label: '↑ or K', keys: ['arrowup', 'k'], description: 'Select the previous track',
      isRowKey: true, run: () => moveSelection(PREVIOUS_ROW) },
    { label: '→', keys: ['arrowright'], description: 'Select and play the next track',
      isRowKey: true, run: () => moveSelectionAndPlay(NEXT_ROW) },
    { label: '←', keys: ['arrowleft'], description: 'Select and play the previous track',
      isRowKey: true, run: () => moveSelectionAndPlay(PREVIOUS_ROW) },
    { label: 'Enter', keys: ['enter'], description: 'Play the selected track',
      isRowKey: true, yieldsToFocusedControl: true, run: playSelected },
    { label: 'O', keys: ['o'], description: "Open the selected track's release", run: openSelectedRelease },
    { label: 'A', keys: ['a'], description: 'Add the selected track to the download list',
      run: addSelectedToDownloadList },
    { label: 'N', keys: ['n'], description: 'Next page', run: () => clickIfPresent(NEXT_PAGE_SELECTOR) },
    { label: 'P', keys: ['p'], description: 'Previous page', run: () => clickIfPresent(PREVIOUS_PAGE_SELECTOR) },
    { label: '/', keys: ['/'], description: 'Search', run: focusSearch },
    { label: '?', keys: ['?'], description: 'Show or hide this list', run: toggleShortcutsOverlay },
  ];

  const SHORTCUTS_BY_KEY = new Map(
    OWN_SHORTCUTS.flatMap((shortcut) => shortcut.keys.map((key) => [key, shortcut])),
  );

  let shortcutsOverlay = null;

  function isShown(element) {
    return element.getClientRects().length > 0;
  }

  // Leaves out rows hidden by "Hide downloaded", so no key selects an invisible track.
  function trackRows() {
    return [...document.querySelectorAll(TRACK_ROW_SELECTOR)].filter(
      (row) => row.querySelector(PLAY_LINK_SELECTOR) && isShown(row),
    );
  }

  function selectedRow() {
    return document.querySelector(`${TRACK_ROW_SELECTOR}.${APP_SELECTED_ROW_CLASS}`);
  }

  function selectRow(row) {
    document
      .querySelectorAll(`${TRACK_ROW_SELECTOR}.${APP_SELECTED_ROW_CLASS}`)
      .forEach((other) => other.classList.remove(APP_SELECTED_ROW_CLASS));
    row.classList.add(APP_SELECTED_ROW_CLASS);
  }

  // Without a selected row, either key selects the first one.
  function moveSelection(step) {
    const rows = trackRows();
    if (rows.length === 0) return;
    const currentIndex = rows.indexOf(selectedRow());
    const nextIndex =
      currentIndex < 0 ? 0 : Math.min(Math.max(currentIndex + step, 0), rows.length - 1);
    selectRow(rows[nextIndex]);
    rows[nextIndex].scrollIntoView({ block: 'nearest' });
  }

  // Clicks the row's own play link, as a mouse click on it would.
  function playSelected() {
    selectedRow()?.querySelector(PLAY_LINK_SELECTOR)?.click();
  }

  function moveSelectionAndPlay(step) {
    moveSelection(step);
    playSelected();
  }

  function openSelectedRelease() {
    const releaseId = selectedRow()?.querySelector(PLAY_LINK_SELECTOR)?.dataset.release_id;
    if (releaseId) navigateInApp(releaseUrl(releaseId));
  }

  // The row's arrow button only puts the track on the download manager's list. A download
  // is spent later, from the download manager.
  function addSelectedToDownloadList() {
    selectedRow()?.querySelector(ADD_TO_DOWNLOAD_LIST_SELECTOR)?.click();
  }

  function clickIfPresent(selector) {
    document.querySelector(selector)?.click();
  }

  function focusSearch() {
    document.querySelector(SEARCH_INPUT_SELECTOR)?.focus();
  }

  function createShortcutsSection(heading, shortcuts) {
    const section = document.createElement('section');
    const title = document.createElement('h3');
    title.textContent = heading;
    const list = document.createElement('dl');
    for (const { label, description } of shortcuts) {
      const key = document.createElement('dt');
      key.textContent = label;
      const meaning = document.createElement('dd');
      meaning.textContent = description;
      list.append(key, meaning);
    }
    section.append(title, list);
    return section;
  }

  function createShortcutsOverlay() {
    const overlay = document.createElement('div');
    overlay.className = SHORTCUTS_OVERLAY_CLASS;
    overlay.hidden = true;
    overlay.append(
      createShortcutsSection('ZipDJ fixes', OWN_SHORTCUTS),
      createShortcutsSection('ZipDJ', APP_SHORTCUTS),
    );
    overlay.addEventListener('click', () => (overlay.hidden = true));
    document.body.appendChild(overlay);
    return overlay;
  }

  function toggleShortcutsOverlay() {
    shortcutsOverlay ??= createShortcutsOverlay();
    shortcutsOverlay.hidden = !shortcutsOverlay.hidden;
  }

  function isOverlayShown() {
    return shortcutsOverlay !== null && !shortcutsOverlay.hidden;
  }

  function isTyping(target) {
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  }

  // Shift stays allowed: "?" and, on some keyboards, "/" need it.
  function hasCommandModifier(event) {
    return event.ctrlKey || event.altKey || event.metaKey;
  }

  function handleShortcutKey(event) {
    if (hasCommandModifier(event) || isTyping(event.target)) return;
    if (event.key === 'Escape' && isOverlayShown()) {
      shortcutsOverlay.hidden = true;
      event.stopImmediatePropagation();
      return;
    }
    const shortcut = SHORTCUTS_BY_KEY.get(event.key.toLowerCase());
    if (!shortcut || !appliesHere(shortcut, event.target)) return;
    // Keeps "/" out of the search box it has just focused, the arrows from scrolling the
    // page, and ZipDJ from acting on the same key a second time.
    event.preventDefault();
    event.stopImmediatePropagation();
    shortcut.run();
  }

  // Buttons only: a play link keeps the focus after a click, and Enter on it would replay
  // that track instead of the selected one.
  function isFocusedControl(target) {
    return target.closest?.('button') !== null;
  }

  function appliesHere(shortcut, target) {
    if (shortcut.isRowKey && trackRows().length === 0) return false;
    return !(shortcut.yieldsToFocusedControl && isFocusedControl(target));
  }

  function selectClickedRow(event) {
    const row = event.target.closest?.(TRACK_ROW_SELECTOR);
    if (row && row.querySelector(PLAY_LINK_SELECTOR)) selectRow(row);
  }

  // The app sets the selected row's background with long "!important" selectors, one per
  // page layout. An inset shadow covers that background instead of outranking each of them.
  function addShortcutStyles() {
    const selectedCells = `${TRACK_ROW_SELECTOR}.${APP_SELECTED_ROW_CLASS} > td`;
    const tint = `inset 0 0 0 ${SCREEN_COVERING_SHADOW_SPREAD} ${SELECTED_ROW_BACKGROUND}`;
    const style = document.createElement('style');
    style.textContent = `
      ${TRACK_ROW_SELECTOR} { scroll-margin: ${ROW_SCROLL_MARGIN} 0; }
      ${selectedCells} { box-shadow: ${tint}; }
      .${SHORTCUTS_OVERLAY_CLASS} {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10000;
        display: flex; gap: 32px; padding: 20px 28px; border-radius: 8px;
        background: #1b2228; color: #ddd; font-size: 13px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      }
      .${SHORTCUTS_OVERLAY_CLASS}[hidden] { display: none; }
      .${SHORTCUTS_OVERLAY_CLASS} h3 { margin: 0 0 10px; font-size: 14px; color: ${APP_ACCENT_COLOUR}; }
      .${SHORTCUTS_OVERLAY_CLASS} dl {
        display: grid; grid-template-columns: auto auto; gap: 6px 16px; margin: 0;
      }
      .${SHORTCUTS_OVERLAY_CLASS} dt { font-weight: 600; white-space: nowrap; }
      .${SHORTCUTS_OVERLAY_CLASS} dd { margin: 0; color: #9aa7b0; }
    `;
    document.head.appendChild(style);
  }

  function startKeyboardShortcuts() {
    addShortcutStyles();
    window.addEventListener('keydown', handleShortcutKey, true);
    window.addEventListener('click', selectClickedRow, true);
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
      tr.${DOWNLOADED_ROW_CLASS} { opacity: ${DOWNLOADED_ROW_OPACITY}; }
      tr.${DOWNLOADED_ROW_CLASS}:hover { opacity: 1; }
      .${HIDE_DOWNLOADED_CLASS} tr.${DOWNLOADED_ROW_CLASS} { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  function onPageChanged() {
    enhanceHistory();
    enhanceTrackLists();
    dimDownloadedRows();
    addHideDownloadedToggles();
    enhanceDownloadManager();
    guardSearchInputs();
  }

  // Works whether the manager starts the script before or after the page has loaded.
  function startWhenDocumentIsReady() {
    addStyles();
    addRoomyStyles();
    applyHideDownloaded();
    startKeyboardShortcuts();
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
