// ==UserScript==
// @name         Костыли для Ютуба
// @name:ru      Костыли для Ютуба
// @name:en      Crutches for YouTube
// @namespace    https://github.com/npekpacHo/cu
// @version      0.1.3
// @description  КЮ: SponsorBlock-пропуск, fullscreen/exit fullscreen при повороте и двойной тап ±10 секунд для мобильной веб-версии YouTube
// @description:ru КЮ: SponsorBlock-пропуск, fullscreen/exit fullscreen при повороте и двойной тап ±10 секунд для мобильной веб-версии YouTube
// @author       npekpacHo + ChatGPT
// @license      MIT
// @homepageURL  https://github.com/npekpacHo/cu
// @supportURL   https://github.com/npekpacHo/cu/issues
// @updateURL    https://raw.githubusercontent.com/npekpacHo/cu/main/cu.user.js
// @downloadURL  https://raw.githubusercontent.com/npekpacHo/cu/main/cu.user.js
// @match        https://m.youtube.com/*
// @match        https://www.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        window.onurlchange
// @connect      sponsor.ajay.app
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const APP_ID = 'cu';
  const APP_SHORT = 'КЮ';

  const CONFIG = {
    /*
      Категории SponsorBlock.

      По умолчанию включены только рекламно-саморекламные куски:
      - sponsor      спонсорская интеграция
      - selfpromo    самореклама автора
      - interaction  лайк, подписка, колокольчик, комментарии и прочее ритуальное хлопанье в ладоши

      Можно добавить вручную:
      - intro
      - outro
      - preview
      - hook

      Не советую включать filler по умолчанию: категория агрессивная и может резать нормальный контент.
    */
    categories: ['sponsor', 'selfpromo', 'interaction'],

    /*
      true = запрос через SHA-256 prefix API SponsorBlock.
      Это чуть приватнее, чем прямой запрос по videoID.
      Если crypto.subtle недоступен, скрипт сам откатится к обычному запросу.
    */
    useHashPrefixApi: true,
    hashPrefixLength: 4,

    cacheTtlMs: 6 * 60 * 60 * 1000,

    skipBeforeStartSec: 0.18,
    skipAfterEndSec: 0.07,

    autoFullscreenOnLandscape: true,
    exitFullscreenOnPortrait: true,

    /*
      Важно для мобильного YouTube.

      youtube-first:
      сначала жмём штатную кнопку fullscreen самого YouTube.
      Это обычно лучше сохраняет мобильные жесты плеера.

      Браузерный requestFullscreen используется только запасным вариантом.
      Именно он на некоторых телефонах превращает плеер в чёрную полосу с видео, задумчиво
      приклеенным к правому краю. Веб-разработка, как археология, только грязи больше.
    */
    fullscreenMode: 'youtube-first',
    allowBrowserFullscreenFallback: true,

    /*
      Осторожный выход из fullscreen при возврате из горизонтального положения в вертикальное.
      Важно: не реагируем на любой fullscreenchange, иначе скрипт начинает охранять кнопку
      fullscreen от самой кнопки fullscreen. Абсурд, но мы же в вебе.
    */
    portraitExitRetriesMs: [0, 250, 700, 1300],

    doubleTapSeekEnabled: true,
    doubleTapSeekSeconds: 10,
    doubleTapMaxDelayMs: 360,
    doubleTapMaxDistancePx: 44,

    showToasts: true,
    debug: false,
  };

  const SB_API = 'https://sponsor.ajay.app';
  const ACTION_TYPES = ['skip'];

  const state = {
    currentUrl: '',
    videoId: '',
    loadedVideoId: '',
    segments: [],
    loadToken: 0,

    boundVideo: null,
    bindTimer: 0,
    refreshTimer: 0,

    lastSkipKey: '',
    lastSkipAtMs: 0,

    fsHintEl: null,
    observer: null,

    fullscreenNeedsGesture: false,
    lastFullscreenAttemptAtMs: 0,
    portraitExitTimerIds: [],
    wasLandscape: false,

    lastTap: {
      time: 0,
      x: 0,
      y: 0,
      side: '',
    },
    lastPointerTapAtMs: 0,
  };

  const log = (...args) => {
    if (CONFIG.debug) console.log(`[${APP_SHORT}]`, ...args);
  };

  function getVideo() {
    return document.querySelector('video.html5-main-video, video');
  }

  function getPlayer() {
    return (
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player') ||
      document.querySelector('ytm-player') ||
      document.querySelector('.player-container-id') ||
      document.querySelector('.player-container') ||
      getVideo()
    );
  }

  function isValidVideoId(value) {
    return /^[a-zA-Z0-9_-]{6,}$/.test(value || '');
  }

  function getVideoIdFromUrl(urlText = location.href) {
    try {
      const url = new URL(urlText, location.origin);

      const fromQuery = url.searchParams.get('v');
      if (isValidVideoId(fromQuery)) return fromQuery;

      const pathMatch = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      if (pathMatch && isValidVideoId(pathMatch[1])) return pathMatch[1];

      return '';
    } catch {
      return '';
    }
  }

  function isWatchLikePage() {
    return Boolean(getVideoIdFromUrl());
  }

  function categoryLabel(category) {
    const labels = {
      sponsor: 'спонсорская вставка',
      selfpromo: 'самореклама',
      interaction: 'лайк-подписка',
      intro: 'интро',
      outro: 'аутро',
      preview: 'превью',
      hook: 'крючок',
      filler: 'филлер',
    };

    return labels[category] || category || 'сегмент';
  }

  function getToastRoot() {
    return document.body || document.documentElement;
  }

  function toast(text, timeout = 1500) {
    if (!CONFIG.showToasts) return;

    try {
      const root = getToastRoot();
      if (!root) return;

      const old = document.getElementById(`${APP_ID}-toast`);
      if (old) old.remove();

      const el = document.createElement('div');
      el.id = `${APP_ID}-toast`;
      el.textContent = text;

      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        bottom: '22px',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        maxWidth: '86vw',
        padding: '8px 12px',
        borderRadius: '999px',
        background: 'rgba(0, 0, 0, 0.78)',
        color: '#fff',
        font: '13px/1.25 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        pointerEvents: 'none',
        boxShadow: '0 3px 18px rgba(0,0,0,.35)',
      });

      root.appendChild(el);
      setTimeout(() => el.remove(), timeout);
    } catch {}
  }

  function gmRequestJson(url) {
    return new Promise((resolve, reject) => {
      const parse = (status, text) => {
        if (status === 404) {
          resolve(null);
          return;
        }

        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status}`));
          return;
        }

        try {
          resolve(JSON.parse(text || 'null'));
        } catch (error) {
          reject(error);
        }
      };

      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: { Accept: 'application/json' },
          timeout: 12000,
          onload: (res) => parse(res.status, res.responseText || ''),
          onerror: () => reject(new Error('GM_xmlhttpRequest error')),
          ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
        });

        return;
      }

      fetch(url, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
        .then(async (res) => {
          if (res.status === 404) return null;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(resolve)
        .catch(reject);
    });
  }

  async function sha256Hex(text) {
    try {
      if (!window.crypto || !crypto.subtle || typeof TextEncoder !== 'function') return '';

      const data = new TextEncoder().encode(text);
      const hash = await crypto.subtle.digest('SHA-256', data);

      return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return '';
    }
  }

  function sponsorBlockQueryParams() {
    const params = new URLSearchParams();
    params.set('categories', JSON.stringify(CONFIG.categories));
    params.set('actionTypes', JSON.stringify(ACTION_TYPES));
    params.set('service', 'YouTube');
    params.set('trimUUIDs', 'true');
    return params.toString();
  }

  function cacheKey(videoId) {
    return `${APP_ID}:sb:v1:${videoId}:${CONFIG.categories.join(',')}`;
  }

  function readCache(videoId) {
    try {
      const raw = localStorage.getItem(cacheKey(videoId));
      if (!raw) return null;

      const item = JSON.parse(raw);
      if (!item || !Array.isArray(item.segments) || !item.time) return null;
      if (Date.now() - item.time > CONFIG.cacheTtlMs) return null;

      return item.segments;
    } catch {
      return null;
    }
  }

  function writeCache(videoId, segments) {
    try {
      localStorage.setItem(
        cacheKey(videoId),
        JSON.stringify({
          time: Date.now(),
          segments,
        }),
      );
    } catch {}
  }

  function normalizeSegments(rawSegments) {
    if (!Array.isArray(rawSegments)) return [];

    return rawSegments
      .map((item) => {
        const segment = Array.isArray(item.segment) ? item.segment : [];
        const start = Number(segment[0]);
        const end = Number(segment[1]);
        const category = String(item.category || '');
        const actionType = String(item.actionType || 'skip');

        return {
          start,
          end,
          category,
          actionType,
          uuid: String(item.UUID || ''),
        };
      })
      .filter((item) => {
        if (!Number.isFinite(item.start) || !Number.isFinite(item.end)) return false;
        if (item.end <= item.start) return false;
        if (item.actionType !== 'skip') return false;
        if (!CONFIG.categories.includes(item.category)) return false;
        return true;
      })
      .sort((a, b) => a.start - b.start);
  }

  async function fetchSegmentsByHashPrefix(videoId) {
    const hash = await sha256Hex(videoId);
    if (!hash) return null;

    const prefix = hash.slice(0, CONFIG.hashPrefixLength);
    const url = `${SB_API}/api/skipSegments/${encodeURIComponent(prefix)}?${sponsorBlockQueryParams()}`;

    const data = await gmRequestJson(url);
    if (!Array.isArray(data)) return [];

    const exact = data.find((item) => item && item.videoID === videoId);
    return exact && Array.isArray(exact.segments) ? exact.segments : [];
  }

  async function fetchSegmentsDirect(videoId) {
    const params = new URLSearchParams(sponsorBlockQueryParams());
    params.set('videoID', videoId);

    const url = `${SB_API}/api/skipSegments?${params.toString()}`;
    const data = await gmRequestJson(url);

    return Array.isArray(data) ? data : [];
  }

  async function getSponsorSegments(videoId) {
    const cached = readCache(videoId);
    if (cached !== null) return cached;

    let raw = null;

    try {
      if (CONFIG.useHashPrefixApi) {
        raw = await fetchSegmentsByHashPrefix(videoId);
      }

      if (raw === null) {
        raw = await fetchSegmentsDirect(videoId);
      }
    } catch (error) {
      log('SponsorBlock request failed:', error);
      raw = [];
    }

    const segments = normalizeSegments(raw);
    writeCache(videoId, segments);

    return segments;
  }

  async function refreshSegments(reason = 'refresh') {
    const videoId = getVideoIdFromUrl();

    if (!videoId) {
      state.videoId = '';
      state.loadedVideoId = '';
      state.segments = [];
      state.lastSkipKey = '';
      state.lastSkipAtMs = 0;
      return;
    }

    if (videoId === state.loadedVideoId) return;

    const token = ++state.loadToken;

    state.videoId = videoId;
    state.loadedVideoId = '';
    state.segments = [];
    state.lastSkipKey = '';
    state.lastSkipAtMs = 0;

    log('loading SponsorBlock segments', { videoId, reason });

    const segments = await getSponsorSegments(videoId);

    if (token !== state.loadToken) return;
    if (videoId !== getVideoIdFromUrl()) return;

    state.loadedVideoId = videoId;
    state.segments = segments;

    if (segments.length) {
      toast(`${APP_SHORT}: найдено сегментов: ${segments.length}`, 1200);
    }

    runSkipCheck();
  }

  function scheduleRefresh(reason = 'scheduled') {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refreshSegments(reason), 250);
  }

  function runSkipCheck() {
    const video = getVideo();

    if (!video || !state.segments.length) return;
    if (!Number.isFinite(video.currentTime)) return;

    const current = video.currentTime;
    const now = Date.now();

    for (const segment of state.segments) {
      const start = segment.start;
      const end = segment.end;

      if (current >= start - CONFIG.skipBeforeStartSec && current < end - CONFIG.skipAfterEndSec) {
        const key = `${segment.category}:${start.toFixed(2)}-${end.toFixed(2)}`;

        if (state.lastSkipKey === key && now - state.lastSkipAtMs < 1500) return;

        const duration = Number.isFinite(video.duration) ? video.duration : end + CONFIG.skipAfterEndSec;
        const target = Math.min(end + CONFIG.skipAfterEndSec, duration);

        try {
          state.lastSkipKey = key;
          state.lastSkipAtMs = now;
          video.currentTime = target;

          toast(`${APP_SHORT}: пропущено, ${categoryLabel(segment.category)}`);
          log('skipped segment', { key, from: current, to: target });
        } catch (error) {
          log('skip failed:', error);
        }

        return;
      }
    }
  }

  function bindVideo() {
    const video = getVideo();

    if (!video || video === state.boundVideo) return;

    if (state.boundVideo) {
      state.boundVideo.removeEventListener('timeupdate', runSkipCheck);
      state.boundVideo.removeEventListener('seeking', runSkipCheck);
      state.boundVideo.removeEventListener('loadedmetadata', onVideoMetadata);
      state.boundVideo.removeEventListener('play', onVideoPlay);
    }

    state.boundVideo = video;

    video.addEventListener('timeupdate', runSkipCheck, { passive: true });
    video.addEventListener('seeking', runSkipCheck, { passive: true });
    video.addEventListener('loadedmetadata', onVideoMetadata, { passive: true });
    video.addEventListener('play', onVideoPlay, { passive: true });

    scheduleRefresh('bind-video');
    syncFullscreenSoon('bind-video');
  }

  function scheduleBind() {
    clearTimeout(state.bindTimer);
    state.bindTimer = setTimeout(bindVideo, 120);
  }

  function onVideoMetadata() {
    scheduleRefresh('metadata');
    syncFullscreenSoon('metadata');
  }

  function onVideoPlay() {
    scheduleRefresh('play');
    syncFullscreenSoon('play');
  }

  function isLandscape() {
    try {
      if (window.matchMedia && window.matchMedia('(orientation: landscape)').matches) return true;
    } catch {}

    return window.innerWidth > window.innerHeight;
  }

  function isYoutubeFullscreenActive() {
    try {
      const player = getPlayer();
      return Boolean(
        player &&
          (
            player.classList?.contains('ytp-fullscreen') ||
            player.classList?.contains('fullscreen') ||
            document.querySelector('.ytp-fullscreen')
          )
      );
    } catch {
      return false;
    }
  }

  function isBrowserFullscreenActive() {
    return Boolean(
      document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement,
    );
  }

  function isFullscreenActive() {
    return isBrowserFullscreenActive() || isYoutubeFullscreenActive();
  }

  function findYoutubeFullscreenButton() {
    const selectors = [
      '.ytp-fullscreen-button',
      'button.ytp-fullscreen-button',
      'button[aria-label*="Full screen"]',
      'button[aria-label*="fullscreen"]',
      'button[aria-label*="Во весь экран"]',
      'button[aria-label*="полноэкран"]',
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button) return button;
    }

    return null;
  }

  function clickYoutubeFullscreenButton() {
    try {
      const button = findYoutubeFullscreenButton();
      if (!button) return false;

      button.click();
      return true;
    } catch {
      return false;
    }
  }

  async function requestBrowserFullscreen(target) {
    if (!target) return false;

    try {
      if (target.requestFullscreen) {
        await target.requestFullscreen({ navigationUI: 'hide' });
        return true;
      }
    } catch {}

    try {
      if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen();
        return true;
      }
    } catch {}

    return false;
  }

  async function tryBrowserFullscreenFallback() {
    if (!CONFIG.allowBrowserFullscreenFallback) return false;

    const video = getVideo();
    const player = getPlayer();

    if (!video) return false;

    if (await requestBrowserFullscreen(player)) return true;
    if (await requestBrowserFullscreen(video)) return true;

    try {
      if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
        return true;
      }
    } catch {}

    return false;
  }

  function isGestureReason(reason) {
    return /pointer|touch|tap|hint|click/i.test(reason || '');
  }

  async function enterFullscreen(reason = 'unknown') {
    if (!CONFIG.autoFullscreenOnLandscape) return false;
    if (!isWatchLikePage()) return false;
    if (!isLandscape()) return false;
    if (isFullscreenActive()) {
      state.fullscreenNeedsGesture = false;
      hideFullscreenHint();
      return true;
    }

    const video = getVideo();
    if (!video) return false;

    const now = Date.now();
    if (now - state.lastFullscreenAttemptAtMs < 450) return false;
    state.lastFullscreenAttemptAtMs = now;

    log('try fullscreen', reason);

    if (CONFIG.fullscreenMode === 'youtube-first' && clickYoutubeFullscreenButton()) {
      setTimeout(() => {
        if (isFullscreenActive()) {
          state.fullscreenNeedsGesture = false;
          hideFullscreenHint();
        }
      }, 350);

      return true;
    }

    /*
      Без жеста пользователя Chrome Android часто запрещает нормальный fullscreen.
      Поэтому при пассивном событии вроде resize/orientationchange не лезем сразу в
      браузерный requestFullscreen, а показываем кнопку. Пусть человек один раз ткнёт
      по экрану, раз уж вся платформа построена на ритуальных прикосновениях.
    */
    if (!isGestureReason(reason)) {
      state.fullscreenNeedsGesture = true;
      showFullscreenHint();
      return false;
    }

    if (await tryBrowserFullscreenFallback()) {
      state.fullscreenNeedsGesture = false;
      hideFullscreenHint();
      return true;
    }

    state.fullscreenNeedsGesture = true;
    showFullscreenHint();
    return false;
  }

  function clearPortraitExitTimers() {
    try {
      for (const timerId of state.portraitExitTimerIds) {
        clearTimeout(timerId);
      }
      state.portraitExitTimerIds = [];
    } catch {}
  }

  function isYoutubePlayerFullscreenClassActive() {
    try {
      const player = getPlayer();

      return Boolean(
        player &&
          (
            player.classList?.contains('ytp-fullscreen') ||
            player.classList?.contains('fullscreen') ||
            player.hasAttribute?.('fullscreen') ||
            document.querySelector('.html5-video-player.ytp-fullscreen, ytm-player[fullscreen], ytm-player.fullscreen')
          )
      );
    } catch {
      return false;
    }
  }

  async function exitBrowserFullscreen() {
    let done = false;

    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
        done = true;
      }
    } catch {}

    try {
      if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
        done = true;
      }
    } catch {}

    return done;
  }

  function exitYoutubePseudoFullscreen() {
    /*
      Жмём штатную кнопку YouTube только если плеер явно в fullscreen-классе.
      Не ищем кнопку "выйти" по всем aria-label на странице: в 0.1.2 эта
      самодеятельность могла немедленно отменять нормальный вход в fullscreen.
    */
    try {
      if (!isYoutubePlayerFullscreenClassActive()) return false;

      const button = findYoutubeFullscreenButton();
      if (!button) return false;

      button.click();
      return true;
    } catch {
      return false;
    }
  }

  async function exitFullscreen(reason = 'portrait') {
    if (!CONFIG.exitFullscreenOnPortrait) return false;

    state.fullscreenNeedsGesture = false;
    hideFullscreenHint();

    let done = false;

    if (await exitBrowserFullscreen()) done = true;

    if (!isLandscape() && exitYoutubePseudoFullscreen()) {
      done = true;
    }

    log('exit fullscreen', { reason, done });

    return done;
  }

  function schedulePortraitExit(reason = 'portrait') {
    if (!CONFIG.exitFullscreenOnPortrait) return;

    clearPortraitExitTimers();

    for (const delay of CONFIG.portraitExitRetriesMs) {
      const timerId = setTimeout(() => {
        if (!isLandscape()) {
          exitFullscreen(`${reason}:${delay}`);
        }
      }, delay);

      state.portraitExitTimerIds.push(timerId);
    }
  }

  function syncFullscreen(reason = 'sync') {
    if (!CONFIG.autoFullscreenOnLandscape && !CONFIG.exitFullscreenOnPortrait) return;

    const landscape = isLandscape();

    if (landscape) {
      clearPortraitExitTimers();
      state.wasLandscape = true;
      enterFullscreen(reason);
      return;
    }

    /*
      Главное отличие от 0.1.2:
      выходим из fullscreen только если до этого реально были в горизонтальном режиме
      или fullscreen уже явно активен. Не душим ручное нажатие штатной кнопки в портрете.
    */
    if (state.wasLandscape || isBrowserFullscreenActive() || isYoutubePlayerFullscreenClassActive()) {
      schedulePortraitExit(reason);
    }

    state.wasLandscape = false;
  }

  function syncFullscreenSoon(reason = 'soon') {
    setTimeout(() => syncFullscreen(`${reason}:250`), 250);
    setTimeout(() => syncFullscreen(`${reason}:900`), 900);
  }

  function showFullscreenHint() {
    try {
      if (!isLandscape() || state.fsHintEl) return;

      const root = getToastRoot();
      if (!root) return;

      const button = document.createElement('button');
      button.id = `${APP_ID}-fullscreen-hint`;
      button.type = 'button';
      button.textContent = '⛶ На весь экран';

      Object.assign(button.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: '2147483647',
        padding: '9px 12px',
        border: '0',
        borderRadius: '999px',
        background: 'rgba(0, 0, 0, 0.78)',
        color: '#fff',
        font: '13px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        boxShadow: '0 3px 18px rgba(0,0,0,.35)',
      });

      button.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.fullscreenNeedsGesture = true;
          enterFullscreen('hint-button');
        },
        true,
      );

      root.appendChild(button);
      state.fsHintEl = button;
    } catch {}
  }

  function hideFullscreenHint() {
    try {
      if (state.fsHintEl) {
        state.fsHintEl.remove();
        state.fsHintEl = null;
      }
    } catch {}
  }

  function isInteractiveTarget(target) {
    try {
      if (!target || target.nodeType !== 1) return false;

      return Boolean(
        target.closest(
          [
            `#${APP_ID}-fullscreen-hint`,
            `#${APP_ID}-toast`,
            'a',
            'button',
            'input',
            'textarea',
            'select',
            '[role="button"]',
            '[contenteditable="true"]',
            '.ytp-chrome-bottom',
            '.ytp-chrome-top',
            '.ytp-settings-menu',
            '.ytp-popup',
            '.ytp-panel',
            'ytm-menu',
            'ytm-pivot-bar-renderer',
            'ytm-bottom-sheet-renderer',
          ].join(','),
        )
      );
    } catch {
      return false;
    }
  }

  function getTapArea() {
    const video = getVideo();
    const player = getPlayer();

    /*
      В fullscreen ориентируемся по viewport, а не по getBoundingClientRect().
      Это важно как раз для случаев, когда видео уехало вправо и слева торчит
      чёрная полоса. Клик по левой стороне всё равно должен считаться левой стороной.
    */
    if (isLandscape() || isFullscreenActive()) {
      return {
        left: 0,
        top: 0,
        width: Math.max(window.innerWidth || 0, 1),
        height: Math.max(window.innerHeight || 0, 1),
      };
    }

    const rect = (player || video)?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {
        left: 0,
        top: 0,
        width: Math.max(window.innerWidth || 0, 1),
        height: Math.max(window.innerHeight || 0, 1),
      };
    }

    return rect;
  }

  function isPointInsideArea(x, y, area) {
    return x >= area.left && x <= area.left + area.width && y >= area.top && y <= area.top + area.height;
  }

  function seekBy(seconds) {
    const video = getVideo();
    if (!video) return false;

    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const target = Math.max(0, Math.min(current + seconds, duration));

    try {
      video.currentTime = target;
      toast(`${APP_SHORT}: ${seconds > 0 ? '+' : ''}${seconds} секунд`, 700);
      return true;
    } catch (error) {
      log('double tap seek failed:', error);
      return false;
    }
  }

  function handleDoubleTapSeek(event, point, source) {
    if (!CONFIG.doubleTapSeekEnabled) return false;
    if (!isWatchLikePage()) return false;

    const video = getVideo();
    if (!video) return false;

    if (event.defaultPrevented) return false;
    if (isInteractiveTarget(event.target)) return false;

    const area = getTapArea();
    const x = Number(point.x);
    const y = Number(point.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (!isPointInsideArea(x, y, area)) return false;

    const now = Date.now();
    const relX = x - area.left;
    const side = relX < area.width / 2 ? 'left' : 'right';

    const dt = now - state.lastTap.time;
    const dx = x - state.lastTap.x;
    const dy = y - state.lastTap.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const isDouble =
      state.lastTap.side === side &&
      dt > 35 &&
      dt <= CONFIG.doubleTapMaxDelayMs &&
      dist <= CONFIG.doubleTapMaxDistancePx;

    state.lastTap = {
      time: now,
      x,
      y,
      side,
    };

    if (!isDouble) return false;

    const seconds = side === 'left' ? -CONFIG.doubleTapSeekSeconds : CONFIG.doubleTapSeekSeconds;

    /*
      На втором тапе гасим событие, чтобы штатный YouTube не добавил ещё ±10 секунд сверху,
      если он внезапно очнулся. Да, приходится спасать YouTube от YouTube.
    */
    try {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    } catch {}

    seekBy(seconds);

    log('double tap seek', { source, side, seconds });
    return true;
  }

  function installDoubleTapSeek() {
    if (!CONFIG.doubleTapSeekEnabled) return;

    if ('PointerEvent' in window) {
      document.addEventListener(
        'pointerup',
        (event) => {
          if (event.pointerType === 'mouse') return;

          state.lastPointerTapAtMs = Date.now();

          handleDoubleTapSeek(
            event,
            {
              x: event.clientX,
              y: event.clientY,
            },
            'pointerup',
          );
        },
        true,
      );
    }

    document.addEventListener(
      'touchend',
      (event) => {
        /*
          На браузерах с PointerEvent touchend придёт следом за pointerup.
          Второй обработчик нам не нужен, иначе получится двойная бухгалтерия
          имени "почему оно прыгнуло на 20 секунд".
        */
        if (Date.now() - state.lastPointerTapAtMs < 450) return;
        if (!event.changedTouches || event.changedTouches.length !== 1) return;

        const touch = event.changedTouches[0];

        handleDoubleTapSeek(
          event,
          {
            x: touch.clientX,
            y: touch.clientY,
          },
          'touchend',
        );
      },
      true,
    );
  }

  function installFullscreenWatchers() {
    const onOrientationLikeChange = (reason) => {
      const landscape = isLandscape();

      if (landscape) {
        clearPortraitExitTimers();
        syncFullscreenSoon(reason);
        return;
      }

      /*
        В портретном режиме не реагируем как бешеные на любое изменение viewport.
        Выходим только если до этого были в landscape или fullscreen действительно активен.
      */
      if (state.wasLandscape || isBrowserFullscreenActive() || isYoutubePlayerFullscreenClassActive()) {
        schedulePortraitExit(reason);
      }

      state.wasLandscape = false;
    };

    window.addEventListener('orientationchange', () => onOrientationLikeChange('orientationchange'), { passive: true });
    window.addEventListener('resize', () => onOrientationLikeChange('resize'), { passive: true });

    try {
      if (screen.orientation && typeof screen.orientation.addEventListener === 'function') {
        screen.orientation.addEventListener('change', () => onOrientationLikeChange('screen-orientation-change'));
      }
    } catch {}

    /*
      Повторяем fullscreen только если предыдущая попытка явно упёрлась в необходимость
      пользовательского жеста. Не трогаем обычные тапы, чтобы не ломать штатные жесты YouTube.
    */
    const onUserGesture = () => {
      if (!state.fullscreenNeedsGesture) return;
      if (!isLandscape()) return;
      if (isFullscreenActive()) {
        state.fullscreenNeedsGesture = false;
        hideFullscreenHint();
        return;
      }

      enterFullscreen('user-gesture');
    };

    document.addEventListener('pointerup', onUserGesture, true);
    document.addEventListener('touchend', onUserGesture, true);
  }

  function onUrlMaybeChanged(reason = 'url') {
    const href = location.href;
    if (href === state.currentUrl) return;

    state.currentUrl = href;
    state.videoId = '';
    state.loadedVideoId = '';
    state.segments = [];
    state.lastSkipKey = '';
    state.lastSkipAtMs = 0;
    state.lastTap.time = 0;

    scheduleBind();
    scheduleRefresh(reason);
    syncFullscreenSoon(reason);
  }

  function installRouteWatchers() {
    window.addEventListener('yt-navigate-finish', () => onUrlMaybeChanged('yt-navigate-finish'), true);
    window.addEventListener('yt-page-data-updated', () => onUrlMaybeChanged('yt-page-data-updated'), true);
    window.addEventListener('popstate', () => onUrlMaybeChanged('popstate'), true);
    window.addEventListener('hashchange', () => onUrlMaybeChanged('hashchange'), true);

    try {
      window.addEventListener('urlchange', () => onUrlMaybeChanged('urlchange'), true);
    } catch {}

    const wrapHistoryMethod = (name) => {
      const original = history[name];
      if (typeof original !== 'function') return;

      history[name] = function wrappedHistoryMethod(...args) {
        const result = original.apply(this, args);
        setTimeout(() => onUrlMaybeChanged(name), 0);
        return result;
      };
    };

    try {
      wrapHistoryMethod('pushState');
      wrapHistoryMethod('replaceState');
    } catch {}
  }

  function installMutationObserver() {
    try {
      if (!document.documentElement) return;

      state.observer = new MutationObserver(() => {
        scheduleBind();

        if (location.href !== state.currentUrl) {
          onUrlMaybeChanged('mutation-url');
        }
      });

      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {}
  }

  function init() {
    state.currentUrl = location.href;
    state.wasLandscape = isLandscape();

    installRouteWatchers();
    installFullscreenWatchers();
    installDoubleTapSeek();
    installMutationObserver();

    scheduleBind();
    scheduleRefresh('init');
    syncFullscreenSoon('init');

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        scheduleBind();
        scheduleRefresh('visibility');
        syncFullscreenSoon('visibility');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
