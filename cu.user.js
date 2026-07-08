// ==UserScript==
// @name         Костыли для Ютуба
// @name:ru      Костыли для Ютуба
// @name:en      Crutches for YouTube
// @namespace    https://github.com/npekpacHo/cu
// @version      0.1.0
// @description  КЮ: SponsorBlock-пропуск и fullscreen при повороте для мобильной веб-версии YouTube
// @description:ru КЮ: SponsorBlock-пропуск и fullscreen при повороте для мобильной веб-версии YouTube
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
  const APP_NAME = 'Костыли для Ютуба';

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

  function isFullscreenActive() {
    return Boolean(
      document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement,
    );
  }

  async function requestFullscreen(target) {
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

  function clickYoutubeFullscreenButton() {
    try {
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
        if (button) {
          button.click();
          return true;
        }
      }
    } catch {}

    return false;
  }

  async function enterFullscreen(reason = 'unknown') {
    if (!CONFIG.autoFullscreenOnLandscape) return false;
    if (!isWatchLikePage()) return false;
    if (!isLandscape()) return false;
    if (isFullscreenActive()) return true;

    const video = getVideo();
    const player = getPlayer();

    if (!video) return false;

    log('try fullscreen', reason);

    if (await requestFullscreen(player)) {
      hideFullscreenHint();
      return true;
    }

    if (await requestFullscreen(video)) {
      hideFullscreenHint();
      return true;
    }

    try {
      if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
        hideFullscreenHint();
        return true;
      }
    } catch {}

    if (clickYoutubeFullscreenButton()) {
      hideFullscreenHint();
      return true;
    }

    showFullscreenHint();
    return false;
  }

  async function exitFullscreen() {
    if (!CONFIG.exitFullscreenOnPortrait) return;

    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
        return;
      }
    } catch {}

    try {
      if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch {}
  }

  function syncFullscreen(reason = 'sync') {
    if (!CONFIG.autoFullscreenOnLandscape) return;

    if (isLandscape()) {
      enterFullscreen(reason);
    } else {
      hideFullscreenHint();
      exitFullscreen();
    }
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

  function onUrlMaybeChanged(reason = 'url') {
    const href = location.href;
    if (href === state.currentUrl) return;

    state.currentUrl = href;
    state.videoId = '';
    state.loadedVideoId = '';
    state.segments = [];
    state.lastSkipKey = '';
    state.lastSkipAtMs = 0;

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

  function installFullscreenWatchers() {
    window.addEventListener('orientationchange', () => syncFullscreenSoon('orientationchange'), { passive: true });
    window.addEventListener('resize', () => syncFullscreenSoon('resize'), { passive: true });

    /*
      Chrome Android часто не даёт включить fullscreen без жеста пользователя.
      Поэтому, если автопереход при повороте был послан лесом, ближайший тап в landscape
      повторит попытку уже с пользовательской активацией. Прогресс, как он есть.
    */
    document.addEventListener(
      'pointerup',
      () => {
        if (isLandscape()) enterFullscreen('pointerup');
      },
      true,
    );

    document.addEventListener(
      'touchend',
      () => {
        if (isLandscape()) enterFullscreen('touchend');
      },
      true,
    );
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

    installRouteWatchers();
    installFullscreenWatchers();
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
