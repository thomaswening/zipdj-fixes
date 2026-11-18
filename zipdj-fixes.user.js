// ==UserScript==
// @name         ZipDJ fixes
// @namespace    https://github.com/thomaswening
// @version      1.0.0
// @description  Download history: a Label column and titles as real links (middle-click, Ctrl+click). Search: keeps the space you just typed.
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
// - The history page already asks ZipDJ's track search for every listed track, and that
//   answer includes the label. The script listens to that answer. It cannot ask by itself:
//   Cloudflare blocks such requests.
// - It runs in the page itself ("@grant none", "@inject-into page"), where the app's
//   XMLHttpRequest and fetch live, and starts as early as it can to see the first request.
// - On the search results page the app rewrites the URL with the trimmed text after every
//   keystroke and then sets the box from that URL, which drops a space typed in between.

(function () {
  'use strict';

  const LOG_PREFIX = '[ZipDJ fixes]';
  const TRACK_SEARCH_URL_PATTERN = /\/manage-elasticsearch\/zipdj-user-tracks-[^/]+\/_search/;
  const HISTORY_ROW_SELECTOR = 'tr.zd-row-downloadhistory[data-tr-id]';
  const TITLE_CELL_SELECTOR = 'td.zd-title-d-h';
  const GENRE_CELL_SELECTOR = 'td.zd-label';
  const GENRE_HEADER_TEXT = 'Genre';
  const SEARCH_INPUT_SELECTOR = 'input[placeholder^="Search for Tracks"]';
  const ADDED_MARKER_CLASS = 'zdx-added';
  const LABEL_CELL_CLASS = 'zdx-label-cell';
  const LINK_CLASS = 'zdx-link';
  const GUARDED_ATTRIBUTE = 'data-zdx-guarded';
  const MIDDLE_MOUSE_BUTTON = 1;

  /** @type {Map<string, {labelName: string, releaseId: number}>} */
  const tracksById = new Map();
  let typedSearchText = null;

  // ---- Download history ----------------------------------------------------------------

  function releaseUrl(releaseId) {
    return `/app/single?track_release_id[0]=${releaseId}`;
  }

  function labelUrl(labelName) {
    return `/app/member/newrelease/track-view?label_name[0]=${encodeURIComponent(labelName)}`;
  }

  function rememberTracks(searchResponseText) {
    let hits;
    try {
      hits = JSON.parse(searchResponseText).hits.hits;
    } catch {
      return;
    }
    for (const hit of hits) {
      const source = hit._source || {};
      if (source.label_name === undefined && source.track_release_id === undefined) continue;
      tracksById.set(String(hit._id), {
        labelName: source.label_name || '',
        releaseId: source.track_release_id,
      });
    }
    console.info(LOG_PREFIX, `labels known for ${tracksById.size} tracks`);
    enhanceAllRows();
  }

  function hookTrackSearch() {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (TRACK_SEARCH_URL_PATTERN.test(String(url))) {
        this.addEventListener('load', () => rememberTracks(this.responseText));
      }
      return originalOpen.apply(this, arguments);
    };

    const originalFetch = window.fetch;
    window.fetch = function (input) {
      const response = originalFetch.apply(this, arguments);
      const url = typeof input === 'string' ? input : input && input.url;
      if (TRACK_SEARCH_URL_PATTERN.test(String(url))) {
        response.then((answer) => answer.clone().text()).then(rememberTracks, () => {});
      }
      return response;
    };
  }

  function makeLink(href, element) {
    element.setAttribute('href', href);
    element.classList.add(LINK_CLASS);
  }

  function addLabelCell(genreCell, labelName) {
    const cell = document.createElement('td');
    cell.className = `${genreCell.className} ${LABEL_CELL_CLASS}`;
    cell.title = labelName;
    if (labelName) {
      const link = document.createElement('a');
      link.textContent = labelName;
      makeLink(labelUrl(labelName), link);
      cell.appendChild(link);
    }
    genreCell.after(cell);
  }

  function enhanceRow(row) {
    if (row.classList.contains(ADDED_MARKER_CLASS)) return;
    const track = tracksById.get(row.dataset.trId);
    if (!track) return;

    const genreCell = row.querySelector(GENRE_CELL_SELECTOR);
    if (genreCell) addLabelCell(genreCell, track.labelName);

    if (track.releaseId !== undefined) {
      for (const titleLink of row.querySelectorAll(`${TITLE_CELL_SELECTOR} a`)) {
        makeLink(releaseUrl(track.releaseId), titleLink);
      }
    }
    row.classList.add(ADDED_MARKER_CLASS);
  }

  // The header row lives in a table of its own, apart from the data rows.
  function addLabelHeader() {
    if (!document.querySelector(`tr.${ADDED_MARKER_CLASS}`)) return;
    const genreHeader = [...document.querySelectorAll(GENRE_CELL_SELECTOR)].find(
      (cell) => !cell.closest(HISTORY_ROW_SELECTOR) && cell.textContent.trim() === GENRE_HEADER_TEXT,
    );
    if (!genreHeader || genreHeader.nextElementSibling?.classList.contains(LABEL_CELL_CLASS)) return;
    const header = genreHeader.cloneNode(false);
    header.classList.add(LABEL_CELL_CLASS);
    header.textContent = 'Label';
    genreHeader.after(header);
  }

  function enhanceAllRows() {
    document.querySelectorAll(HISTORY_ROW_SELECTOR).forEach(enhanceRow);
    addLabelHeader();
  }

  // Ctrl, Shift or Cmd + click, or middle-click, on one of our links: keep the app's own
  // click handler from also navigating this tab, so only the browser opens a new tab.
  function isNewTabClick(event) {
    return event.ctrlKey || event.metaKey || event.shiftKey || event.button === MIDDLE_MOUSE_BUTTON;
  }

  // A plain click on a label link goes through the app's router instead of a full page
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
    if (link.closest(`.${LABEL_CELL_CLASS}`)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigateInApp(link.getAttribute('href'));
    }
    // A plain click on a title is left to the app, which already opens the release.
  }

  // ---- Search box ----------------------------------------------------------------------

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

  // ---- Start ---------------------------------------------------------------------------

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .${LABEL_CELL_CLASS} a { color: inherit; }
      .${LABEL_CELL_CLASS} a:hover { text-decoration: underline; }
    `;
    document.head.appendChild(style);
  }

  function onPageChanged() {
    enhanceAllRows();
    guardSearchInputs();
  }

  // Works whether the manager starts the script before or after the page has loaded.
  function startWhenDocumentIsReady() {
    addStyles();
    onPageChanged();
    new MutationObserver(onPageChanged).observe(document.body, { childList: true, subtree: true });
  }

  console.info(LOG_PREFIX, 'running');
  hookTrackSearch();
  window.addEventListener('click', handleClick, true);
  document.addEventListener('input', rememberTypedSearchText, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWhenDocumentIsReady);
  } else {
    startWhenDocumentIsReady();
  }
})();
