// ==UserScript==
// @name         YouTube Crutches
// @name:ru      Костыли для Ютуба
// @description  Skip ads/sponsor blocks (SponsorBlock), fullscreen button on watch pages, dimmed custom controls, remembered custom volume slider, fullscreen layout fix, home chips cleanup and exit fullscreen on portrait rotation for YouTube mobile web
// @description:ru Пропуск рекламы/спонсорских блоков (SponsorBlock), кнопка fullscreen только на страницах видео, свои полупрозрачные кнопки плеера, запоминаемый кастомный ползунок громкости, чистка верхних чипов главной и выход из fullscreen при повороте в портрет для мобильной веб-версии YouTube
// @namespace    https://github.com/npekpacHo/cu
// @version      0.2.9
// @author       npekpacHo
// @license      MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
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

    /*
      0.1.9:
      автоматический вход в fullscreen при повороте отключён.
      На Xiaomi/Chrome он может включать кривой режим с чёрной полосой слева
      и без нормальных кнопок YouTube. Поэтому в landscape показываем нашу кнопку,
      а fullscreen включается только живым нажатием.
    */
    autoEnterFullscreenOnLandscape: false,
    showFullscreenHintOnLandscape: true,

    /*
      0.2.6:
      кнопку fullscreen показываем только на страницах просмотра /watch.
      На главной она не нужна: человек ещё не провалился в видео, а мы уже лезем
      с кнопкой. Такое даже YouTube себе не всегда позволяет.
    */
    fullscreenHintWatchPagesOnly: true,
    fullscreenHintScale: 1.5,

    exitFullscreenOnPortrait: true,

    /*
      Важно для мобильного YouTube.

      youtube-first:
      используется только при ручном нажатии нашей кнопки, если browser fullscreen
      не сработал. Автоматически при повороте fullscreen больше не включаем.

      Браузерный requestFullscreen используется как основной путь для нашей кнопки,
      как в рабочей базе 0.1.5.
    */
    fullscreenMode: 'youtube-first',
    allowBrowserFullscreenFallback: true,

    /*
      Кнопка КЮ использует browser fullscreen напрямую.
      Это нужно, чтобы она не зависела от штатной кнопки YouTube.
      Автоматический вход при повороте всё ещё сначала пробует кнопку YouTube.
    */
    hintButtonMode: 'browser-first',

    /*
      Осторожный выход из fullscreen при возврате из горизонтального положения в вертикальное.
      Важно: не реагируем на любой fullscreenchange, иначе скрипт начинает охранять кнопку
      fullscreen от самой кнопки fullscreen. Абсурд, но мы же в вебе.
    */
    portraitExitRetriesMs: [0, 250, 700, 1300],

    /*
      Свои кнопки поверх плеера.
      Нужны для режимов, где YouTube-оверлеи пропадают: -10 / play-pause / +10.
    */
    customControlsEnabled: true,
    customControlsShowInLandscape: true,
    customControlsShowInFullscreen: true,
    customControlsAlwaysVisible: true,
    customControlsAutoHideMs: 3500,
    customControlsDimAfterMs: 2200,
    customControlsBrightOpacity: 0.78,
    customControlsDimOpacity: 0.28,
    customControlsSeekSeconds: 10,

    /*
      Управление громкостью рядом с кнопками плеера.
      Без усиления выше 100%, потому что задача не разбудить соседей и кота,
      а наоборот смотреть ночью по-человечески.
    */
    volumeControlEnabled: true,
    volumeStorageKey: 'cu:volume:v1',
    volumeDefaultPercent: 30,
    volumeMinPercent: 0,
    volumeMaxPercent: 100,
    volumeStepPercent: 1,
    volumeSliderWidthPx: 126,

    /*
      0.2.9:
      кастомная отрисовка дорожки громкости вместо CSS-псевдоэлементов range.
      На мобильном Chrome псевдоэлементы иногда исчезают, оставляя один бегунок,
      потому что стандарты веба писали люди, которым явно было мало боли.
    */
    volumeTrackHeightActivePx: 6,
    volumeTrackHeightInactivePx: 2,
    volumeTrackColorActive: 'rgba(255, 255, 255, 0.86)',
    volumeTrackColorInactive: 'rgba(255, 255, 255, 0.30)',
    volumeThumbSizePx: 16,

    volumeApplyStoredOnBind: true,

    /*
      Для своих кнопок fullscreen стараемся делать на контейнер плеера, а не на <video>.
      Если fullscreen-ить само видео, DOM-кнопки поверх него могут не отображаться вообще.
    */
    preferPlayerContainerFullscreen: true,
    allowVideoElementFullscreenFallback: false,

    /*
      Эксперимент 0.2.5 против чёрной полосы слева.
      Раз уж fullscreen контейнера даёт нам кнопки, но иногда криво масштабирует видео,
      пробуем насильно привести fullscreen-контейнер и video к viewport 100vw × 100vh.
    */
    fullscreenLayoutFixEnabled: true,
    fullscreenLayoutFixRetriesMs: [0, 80, 180, 360, 700, 1200],

    /*
      Чистка верхних чипов на главной.
      Оставляем только: Все, Просмотрено, Новое для вас.
    */
    homeChipsCleanupEnabled: true,
    homeChipAllowedLabels: ['все', 'просмотрено', 'новое для вас'],

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
    customControlsEl: null,
    customControlsHideTimer: 0,
    volumeAppliedVideo: null,
    volumeSliderEl: null,
    volumeTrackEl: null,
    volumeActiveTrackEl: null,
    volumeThumbEl: null,
    volumeLabelEl: null,
    fullscreenLayoutFixRoot: null,
    fullscreenLayoutFixTimerIds: [],
    homeChipsTimer: 0,
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

  function isHomePage() {
    try {
      const path = location.pathname.replace(/\/+$/, '') || '/';
      return path === '/' || path === '/feed/recommended';
    } catch {
      return false;
    }
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
      state.boundVideo.removeEventListener('pause', updateCustomControls);
      state.boundVideo.removeEventListener('timeupdate', updateCustomControls);
      state.boundVideo.removeEventListener('volumechange', updateVolumeControl);
    }

    state.boundVideo = video;
    applyStoredVolume(video);

    video.addEventListener('timeupdate', runSkipCheck, { passive: true });
    video.addEventListener('seeking', runSkipCheck, { passive: true });
    video.addEventListener('loadedmetadata', onVideoMetadata, { passive: true });
    video.addEventListener('play', onVideoPlay, { passive: true });
    video.addEventListener('pause', updateCustomControls, { passive: true });
    video.addEventListener('timeupdate', updateCustomControls, { passive: true });
    video.addEventListener('volumechange', updateVolumeControl, { passive: true });

    updateVolumeControl();

    scheduleRefresh('bind-video');
    syncFullscreenSoon('bind-video');
  }

  function scheduleBind() {
    clearTimeout(state.bindTimer);
    state.bindTimer = setTimeout(bindVideo, 120);
  }

  function onVideoMetadata() {
    applyStoredVolume(getVideo());
    updateVolumeControl();
    scheduleRefresh('metadata');
    syncFullscreenSoon('metadata');
  }

  function onVideoPlay() {
    updateVolumeControl();
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
        scheduleFullscreenLayoutFix('requestFullscreen');
        return true;
      }
    } catch {}

    try {
      if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen();
        scheduleFullscreenLayoutFix('webkitRequestFullscreen');
        return true;
      }
    } catch {}

    return false;
  }

  async function tryBrowserFullscreenFallback(preferVideo = false) {
    if (!CONFIG.allowBrowserFullscreenFallback) return false;

    const video = getVideo();
    const player = getPlayer();

    if (!player && !video) return false;

    /*
      0.2.4:
      Сначала fullscreen-им контейнер плеера. Если fullscreen-ить сам <video>,
      поверх него часто невозможно нормально вывести наши DOM-кнопки.
      Человечество зачем-то разрешило этот режим, а теперь мы ходим вокруг него с лопатой.
    */
    const containerTargets = [
      document.querySelector('#movie_player'),
      document.querySelector('.html5-video-player'),
      document.querySelector('ytm-player'),
      document.querySelector('.player-container-id'),
      document.querySelector('.player-container'),
      player,
    ].filter(Boolean);

    const targets = CONFIG.preferPlayerContainerFullscreen
      ? Array.from(new Set(containerTargets))
      : Array.from(new Set(preferVideo ? [video, ...containerTargets] : [...containerTargets, video]));

    for (const target of targets) {
      if (!target) continue;
      if (target === video && !CONFIG.allowVideoElementFullscreenFallback) continue;
      if (await requestBrowserFullscreen(target)) return true;
    }

    /*
      Fallback на <video> оставлен выключенным по умолчанию.
      Включать его можно только если снова захочется смотреть на голое видео без кнопок,
      то есть если день совсем не задался.
    */
    if (CONFIG.allowVideoElementFullscreenFallback && video) {
      try {
        if (video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
          return true;
        }
      } catch {}
    }

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

    const gesture = isGestureReason(reason);
    const isHint = /hint/i.test(reason || '');

    const now = Date.now();

    /*
      Не душим реальные пользовательские нажатия таймером.
    */
    if (!gesture && now - state.lastFullscreenAttemptAtMs < 450) return false;
    state.lastFullscreenAttemptAtMs = now;

    log('try fullscreen', reason);

    /*
      Кнопка КЮ должна работать сама по себе, а не устраивать двойной toggle штатной
      кнопки YouTube. Поэтому для неё первым делом используем browser fullscreen.
    */
    if (isHint && CONFIG.hintButtonMode === 'browser-first') {
      if (await tryBrowserFullscreenFallback(false)) {
        state.fullscreenNeedsGesture = false;
        hideFullscreenHint();
        scheduleFullscreenLayoutFix('fullscreen-button');
        showCustomControls('fullscreen-button');
        return true;
      }

      if (clickYoutubeFullscreenButton()) {
        setTimeout(() => {
          if (isFullscreenActive()) {
            state.fullscreenNeedsGesture = false;
            hideFullscreenHint();
            scheduleFullscreenLayoutFix('youtube-fullscreen-button');
            showCustomControls('youtube-fullscreen-button');
          } else if (isLandscape()) {
            state.fullscreenNeedsGesture = true;
            showFullscreenHint();
          }
        }, 350);

        return true;
      }

      state.fullscreenNeedsGesture = true;
      showFullscreenHint();
      return false;
    }

    /*
      Автоматический вход по orientationchange не имеет нормальной пользовательской
      активации, поэтому Chrome может отказать. Пробуем штатную кнопку YouTube,
      а если результата нет, показываем кнопку КЮ.
    */
    if (CONFIG.fullscreenMode === 'youtube-first' && clickYoutubeFullscreenButton()) {
      setTimeout(() => {
        if (isFullscreenActive()) {
          state.fullscreenNeedsGesture = false;
          hideFullscreenHint();
        } else if (isLandscape()) {
          state.fullscreenNeedsGesture = true;
          showFullscreenHint();
        }
      }, 500);

      return true;
    }

    if (!gesture) {
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
      Не ищем кнопку "выйти" по всем aria-label на странице.
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
    removeFullscreenLayoutFix();

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

      /*
        0.2.4:
        fullscreen автоматически не включаем. В landscape показываем нашу кнопку.
        Если fullscreen уже активен, показываем свои кнопки плеера.
      */
      if (isFullscreenActive()) {
        hideFullscreenHint();
        scheduleFullscreenLayoutFix(reason);
        syncCustomControls(reason);
      } else {
        hideCustomControls();

        if (CONFIG.showFullscreenHintOnLandscape) {
          showFullscreenHint();
        } else if (CONFIG.autoEnterFullscreenOnLandscape) {
          enterFullscreen(reason);
        }
      }

      return;
    }

    hideFullscreenHint();
    hideCustomControls();
    removeFullscreenLayoutFix();

    /*
      Выходим из fullscreen только если до этого реально были в горизонтальном режиме
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
      if (CONFIG.fullscreenHintWatchPagesOnly && !isWatchLikePage()) return;
      if (!isLandscape() || state.fsHintEl || isFullscreenActive()) return;
      if (!getVideo()) return;

      const root = getToastRoot();
      if (!root) return;

      const scale = Number(CONFIG.fullscreenHintScale) || 1;

      const button = document.createElement('button');
      button.id = `${APP_ID}-fullscreen-hint`;
      button.type = 'button';
      button.textContent = '⛶ На весь экран';

      Object.assign(button.style, {
        position: 'fixed',
        right: `${Math.round(12 * scale)}px`,
        top: '50%',
        bottom: 'auto',
        transform: 'translateY(-50%)',
        zIndex: '2147483647',
        minHeight: `${Math.round(36 * scale)}px`,
        padding: `${Math.round(9 * scale)}px ${Math.round(12 * scale)}px`,
        border: '0',
        borderRadius: '999px',
        background: 'rgba(0, 0, 0, 0.78)',
        color: '#fff',
        font: `${Math.round(13 * scale)}px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`,
        fontWeight: '700',
        whiteSpace: 'nowrap',
        boxShadow: '0 3px 18px rgba(0,0,0,.35)',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      });

      button.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

          state.fullscreenNeedsGesture = true;
          ensureCustomControls();
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



  function ensureFullscreenLayoutFixStyle() {
    if (document.getElementById(`${APP_ID}-fullscreen-layout-style`)) return;

    try {
      const style = document.createElement('style');
      style.id = `${APP_ID}-fullscreen-layout-style`;
      style.textContent = `
html.${APP_ID}-fs-active,
html.${APP_ID}-fs-active body {
  margin: 0 !important;
  padding: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  overflow: hidden !important;
  background: #000 !important;
}

[data-${APP_ID}-fs-root="1"] {
  margin: 0 !important;
  padding: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  min-width: 0 !important;
  min-height: 0 !important;
  left: 0 !important;
  top: 0 !important;
  right: auto !important;
  bottom: auto !important;
  transform: none !important;
  translate: none !important;
  box-sizing: border-box !important;
  overflow: hidden !important;
  background: #000 !important;
}

[data-${APP_ID}-fs-root="1"] #movie_player,
[data-${APP_ID}-fs-root="1"] .html5-video-player,
[data-${APP_ID}-fs-root="1"] ytm-player,
[data-${APP_ID}-fs-root="1"] .player-container,
[data-${APP_ID}-fs-root="1"] .player-container-id {
  margin: 0 !important;
  padding: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  min-width: 0 !important;
  min-height: 0 !important;
  left: 0 !important;
  top: 0 !important;
  right: auto !important;
  bottom: auto !important;
  transform: none !important;
  translate: none !important;
  box-sizing: border-box !important;
  overflow: hidden !important;
  background: #000 !important;
}

[data-${APP_ID}-fs-root="1"] video,
[data-${APP_ID}-fs-root="1"] video.html5-main-video {
  position: fixed !important;
  inset: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  min-width: 0 !important;
  min-height: 0 !important;
  object-fit: contain !important;
  transform: none !important;
  translate: none !important;
  background: #000 !important;
  z-index: 2147483600 !important;
}

#${APP_ID}-custom-controls {
  z-index: 2147483647 !important;
}
      `;

      (document.head || document.documentElement).appendChild(style);
    } catch {}
  }

  function getVideoRectInfo() {
    try {
      const video = getVideo();
      if (!video || !video.getBoundingClientRect) return null;

      const rect = video.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        viewportWidth: Math.round(window.innerWidth || 0),
        viewportHeight: Math.round(window.innerHeight || 0),
      };
    } catch {
      return null;
    }
  }

  function clearFullscreenLayoutFixTimers() {
    try {
      for (const timerId of state.fullscreenLayoutFixTimerIds) {
        clearTimeout(timerId);
      }
      state.fullscreenLayoutFixTimerIds = [];
    } catch {}
  }

  function removeFullscreenLayoutFix() {
    try {
      clearFullscreenLayoutFixTimers();
      document.documentElement.classList.remove(`${APP_ID}-fs-active`);

      if (state.fullscreenLayoutFixRoot) {
        state.fullscreenLayoutFixRoot.removeAttribute(`data-${APP_ID}-fs-root`);
        state.fullscreenLayoutFixRoot = null;
      }
    } catch {}
  }

  function applyFullscreenLayoutFix(reason = 'fix') {
    if (!CONFIG.fullscreenLayoutFixEnabled) return;
    if (!isLandscape()) return;

    try {
      ensureFullscreenLayoutFixStyle();

      const fsElement = getFullscreenElement();
      const player = getPlayer();
      const root =
        (fsElement && fsElement.tagName && fsElement.tagName.toLowerCase() !== 'video' && fsElement) ||
        document.querySelector('#movie_player') ||
        document.querySelector('.html5-video-player') ||
        document.querySelector('ytm-player') ||
        player;

      if (!root) return;

      if (state.fullscreenLayoutFixRoot && state.fullscreenLayoutFixRoot !== root) {
        state.fullscreenLayoutFixRoot.removeAttribute(`data-${APP_ID}-fs-root`);
      }

      state.fullscreenLayoutFixRoot = root;
      root.setAttribute(`data-${APP_ID}-fs-root`, '1');
      document.documentElement.classList.add(`${APP_ID}-fs-active`);

      log('fullscreen layout fix', reason, getVideoRectInfo());
    } catch {}
  }

  function scheduleFullscreenLayoutFix(reason = 'schedule') {
    if (!CONFIG.fullscreenLayoutFixEnabled) return;

    clearFullscreenLayoutFixTimers();

    for (const delay of CONFIG.fullscreenLayoutFixRetriesMs) {
      const timerId = setTimeout(() => {
        if (isLandscape() && isFullscreenActive()) {
          applyFullscreenLayoutFix(`${reason}:${delay}`);
          syncCustomControls(`layout-fix:${delay}`);
        }
      }, delay);

      state.fullscreenLayoutFixTimerIds.push(timerId);
    }
  }

  function getFullscreenElement() {
    return (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      null
    );
  }

  function getCustomControlsRoot() {
    const fsElement = getFullscreenElement();

    /*
      Если fullscreen-элементом вдруг оказался <video>, внутрь него DOM-кнопки не положить.
      Поэтому основной путь 0.2.4 — fullscreen контейнера, а не видео.
    */
    if (fsElement && fsElement.tagName && fsElement.tagName.toLowerCase() !== 'video') {
      return fsElement;
    }

    return (
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player') ||
      document.querySelector('ytm-player') ||
      getPlayer() ||
      document.body ||
      document.documentElement
    );
  }

  function shouldShowCustomControls() {
    if (!CONFIG.customControlsEnabled) return false;
    if (!isWatchLikePage()) return false;
    if (!getVideo()) return false;

    return (
      (CONFIG.customControlsShowInFullscreen && isFullscreenActive()) ||
      (CONFIG.customControlsShowInLandscape && isLandscape())
    );
  }


  function clampNumber(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.min(max, Math.max(min, num));
  }

  function normalizeVolumePercent(value) {
    return clampNumber(value, CONFIG.volumeMinPercent, CONFIG.volumeMaxPercent);
  }

  function readStoredVolumePercent() {
    try {
      const raw = localStorage.getItem(CONFIG.volumeStorageKey);
      if (raw === null || raw === '') return null;

      const value = Number(raw);
      if (!Number.isFinite(value)) return null;

      return normalizeVolumePercent(value);
    } catch {
      return null;
    }
  }

  function writeStoredVolumePercent(percent) {
    try {
      localStorage.setItem(CONFIG.volumeStorageKey, String(Math.round(normalizeVolumePercent(percent))));
    } catch {}
  }

  function getVideoVolumePercent(video = getVideo()) {
    if (!video) return CONFIG.volumeDefaultPercent;

    try {
      if (video.muted) return 0;
      return Math.round(clampNumber(video.volume * 100, 0, 100));
    } catch {
      return CONFIG.volumeDefaultPercent;
    }
  }

  function applyStoredVolume(video = getVideo()) {
    if (!CONFIG.volumeControlEnabled || !CONFIG.volumeApplyStoredOnBind || !video) return false;
    if (state.volumeAppliedVideo === video) return true;

    const stored = readStoredVolumePercent();

    /*
      Если значения ещё нет, не навязываем дефолт и не делаем вид, что умнее пользователя.
      Просто запоминаем текущую громкость YouTube как стартовую.
    */
    if (stored === null) {
      writeStoredVolumePercent(getVideoVolumePercent(video));
      state.volumeAppliedVideo = video;
      return false;
    }

    setVideoVolumePercent(stored, 'stored', false);
    state.volumeAppliedVideo = video;
    return true;
  }

  function setVideoVolumePercent(percent, reason = 'manual', save = true) {
    const video = getVideo();
    if (!video) return false;

    const normalized = normalizeVolumePercent(percent);

    try {
      const volume = normalized / 100;

      video.volume = volume;
      video.muted = normalized <= 0;

      if (normalized > 0 && video.muted) {
        video.muted = false;
      }

      if (save) {
        writeStoredVolumePercent(normalized);
      }

      updateVolumeControl();

      if (reason !== 'stored') {
        toast(`${APP_SHORT}: громкость ${Math.round(normalized)}%`, 650);
      }

      log('volume set', { reason, percent: normalized });
      return true;
    } catch (error) {
      log('volume set failed:', error);
      return false;
    }
  }

  function updateVolumeSliderVisual(value = null) {
    const slider = state.volumeSliderEl;
    const activeTrack = state.volumeActiveTrackEl;
    const thumb = state.volumeThumbEl;

    if (!slider || !activeTrack || !thumb) return;

    try {
      const min = Number(slider.min || CONFIG.volumeMinPercent);
      const max = Number(slider.max || CONFIG.volumeMaxPercent);
      const raw = value === null ? Number(slider.value || 0) : Number(value);
      const percent = max > min ? ((raw - min) / (max - min)) * 100 : 0;
      const clamped = clampNumber(percent, 0, 100);

      activeTrack.style.width = `${clamped}%`;
      thumb.style.left = `${clamped}%`;
    } catch {}
  }

  function updateVolumeControl() {
    if (!CONFIG.volumeControlEnabled) return;

    const slider = state.volumeSliderEl;
    const label = state.volumeLabelEl;
    const video = getVideo();

    if (!slider || !label || !video) return;

    const percent = getVideoVolumePercent(video);

    try {
      slider.value = String(percent);
      updateVolumeSliderVisual(percent);
      label.textContent = `${percent}%`;
      label.title = `Громкость ${percent}%`;
    } catch {}
  }

  function createVolumeControl() {
    const group = document.createElement('div');
    group.className = `${APP_ID}-volume-control`;

    Object.assign(group.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '7px',
      marginLeft: '12px',
      padding: '8px 10px',
      border: '1px solid rgba(255, 255, 255, 0.10)',
      borderRadius: '18px',
      background: 'rgba(0, 0, 0, 0.34)',
      color: 'rgba(255, 255, 255, 0.88)',
      boxShadow: '0 3px 14px rgba(0,0,0,.20)',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
    });

    const icon = document.createElement('span');
    icon.textContent = '🔉';
    icon.setAttribute('aria-hidden', 'true');

    Object.assign(icon.style, {
      font: '17px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      opacity: '0.9',
    });

    const sliderWrap = document.createElement('div');
    sliderWrap.className = `${APP_ID}-volume-slider-wrap`;

    Object.assign(sliderWrap.style, {
      position: 'relative',
      width: `${CONFIG.volumeSliderWidthPx}px`,
      maxWidth: '24vw',
      height: `${Math.max(CONFIG.volumeThumbSizePx, CONFIG.volumeTrackHeightActivePx) + 6}px`,
      display: 'flex',
      alignItems: 'center',
      flex: '0 0 auto',
      pointerEvents: 'auto',
      touchAction: 'pan-x',
    });

    const inactiveTrack = document.createElement('div');
    inactiveTrack.className = `${APP_ID}-volume-track-inactive`;

    Object.assign(inactiveTrack.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: '50%',
      height: `${CONFIG.volumeTrackHeightInactivePx}px`,
      transform: 'translateY(-50%)',
      borderRadius: '999px',
      background: CONFIG.volumeTrackColorInactive,
      pointerEvents: 'none',
    });

    const activeTrack = document.createElement('div');
    activeTrack.className = `${APP_ID}-volume-track-active`;

    Object.assign(activeTrack.style, {
      position: 'absolute',
      left: '0',
      top: '50%',
      width: '30%',
      height: `${CONFIG.volumeTrackHeightActivePx}px`,
      transform: 'translateY(-50%)',
      borderRadius: '999px',
      background: CONFIG.volumeTrackColorActive,
      pointerEvents: 'none',
    });

    const thumb = document.createElement('div');
    thumb.className = `${APP_ID}-volume-thumb`;

    Object.assign(thumb.style, {
      position: 'absolute',
      left: '30%',
      top: '50%',
      width: `${CONFIG.volumeThumbSizePx}px`,
      height: `${CONFIG.volumeThumbSizePx}px`,
      transform: 'translate(-50%, -50%)',
      borderRadius: '999px',
      border: '2px solid rgba(255, 255, 255, 0.92)',
      background: 'rgba(255, 255, 255, 0.92)',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.40)',
      pointerEvents: 'none',
    });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(CONFIG.volumeMinPercent);
    slider.max = String(CONFIG.volumeMaxPercent);
    slider.step = String(CONFIG.volumeStepPercent);
    slider.value = String(readStoredVolumePercent() ?? CONFIG.volumeDefaultPercent);
    slider.setAttribute('aria-label', 'Громкость');

    /*
      Нативный range остаётся, но становится прозрачным сенсорным слоем.
      Дорожку и бегунок рисуем своими div-ами, потому что иначе Chrome снова
      оставляет один сиротливый кружочек. Забота о пользователе через имитацию UI,
      вот она, вершина цивилизации.
    */
    Object.assign(slider.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      margin: '0',
      padding: '0',
      opacity: '0.001',
      cursor: 'pointer',
      pointerEvents: 'auto',
      touchAction: 'pan-x',
    });

    const label = document.createElement('span');
    label.textContent = `${slider.value}%`;
    label.className = `${APP_ID}-volume-label`;

    Object.assign(label.style, {
      minWidth: '34px',
      textAlign: 'right',
      font: '12px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      fontWeight: '650',
      color: 'rgba(255, 255, 255, 0.84)',
    });

    const stop = (event) => {
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      brightenCustomControls('volume');
    };

    ['pointerdown', 'touchstart', 'click'].forEach((name) => {
      group.addEventListener(name, stop, true);
      sliderWrap.addEventListener(name, stop, true);
      slider.addEventListener(name, stop, true);
    });

    slider.addEventListener(
      'input',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        updateVolumeSliderVisual(slider.value);
        setVideoVolumePercent(slider.value, 'slider');
        brightenCustomControls('volume-input');
      },
      true,
    );

    slider.addEventListener(
      'change',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        updateVolumeSliderVisual(slider.value);
        setVideoVolumePercent(slider.value, 'slider-change');
        brightenCustomControls('volume-change');
      },
      true,
    );

    sliderWrap.appendChild(inactiveTrack);
    sliderWrap.appendChild(activeTrack);
    sliderWrap.appendChild(thumb);
    sliderWrap.appendChild(slider);

    group.appendChild(icon);
    group.appendChild(sliderWrap);
    group.appendChild(label);

    state.volumeSliderEl = slider;
    state.volumeTrackEl = inactiveTrack;
    state.volumeActiveTrackEl = activeTrack;
    state.volumeThumbEl = thumb;
    state.volumeLabelEl = label;

    updateVolumeSliderVisual(slider.value);

    return group;
  }


  function createCustomControlButton(text, title, handler, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.className = `${APP_ID}-control-button ${extraClass}`.trim();

    Object.assign(button.style, {
      minWidth: extraClass.includes('play') ? '60px' : '54px',
      height: '44px',
      padding: '0 11px',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '15px',
      background: 'rgba(0, 0, 0, 0.42)',
      color: 'rgba(255, 255, 255, 0.9)',
      font: extraClass.includes('play')
        ? '21px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
        : '16px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      fontWeight: '650',
      boxShadow: '0 3px 14px rgba(0,0,0,.24)',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
    });

    button.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

        brightenCustomControls('button');
        handler();
      },
      true,
    );

    return button;
  }

  function updateCustomControls() {
    const el = state.customControlsEl;
    const video = getVideo();

    if (!el || !video) return;

    const playButton = el.querySelector(`.${APP_ID}-control-play`);
    if (playButton) {
      playButton.textContent = video.paused ? '▶' : '⏸';
      playButton.title = video.paused ? 'Воспроизвести' : 'Пауза';
      playButton.setAttribute('aria-label', playButton.title);
    }
  }

  function ensureCustomControls() {
    if (!CONFIG.customControlsEnabled) return null;

    const root = getCustomControlsRoot();
    if (!root) return null;

    if (!state.customControlsEl) {
      const wrap = document.createElement('div');
      wrap.id = `${APP_ID}-custom-controls`;

      Object.assign(wrap.style, {
        position: 'fixed',
        left: '50%',
        bottom: '18px',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '7px',
        borderRadius: '24px',
        background: 'rgba(0, 0, 0, 0.08)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        pointerEvents: 'none',
      });

      const buttonGroup = document.createElement('div');
      buttonGroup.className = `${APP_ID}-button-group`;

      Object.assign(buttonGroup.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '9px',
        pointerEvents: 'none',
      });

      const back = createCustomControlButton(
        '↶10',
        'Назад на 10 секунд',
        () => seekBy(-CONFIG.customControlsSeekSeconds),
      );

      const play = createCustomControlButton(
        '▶',
        'Воспроизвести / пауза',
        () => togglePlayPause(),
        `${APP_ID}-control-play`,
      );

      const forward = createCustomControlButton(
        '10↷',
        'Вперёд на 10 секунд',
        () => seekBy(CONFIG.customControlsSeekSeconds),
      );

      buttonGroup.appendChild(back);
      buttonGroup.appendChild(play);
      buttonGroup.appendChild(forward);

      wrap.appendChild(buttonGroup);

      if (CONFIG.volumeControlEnabled) {
        wrap.appendChild(createVolumeControl());
      }

      state.customControlsEl = wrap;
    }

    if (state.customControlsEl.parentNode !== root) {
      root.appendChild(state.customControlsEl);
    }

    updateCustomControls();
    updateVolumeControl();
    return state.customControlsEl;
  }

  function setCustomControlsOpacity(value) {
    try {
      if (!state.customControlsEl) return;
      state.customControlsEl.style.opacity = String(value);
    } catch {}
  }

  function dimCustomControls(reason = 'dim') {
    if (!state.customControlsEl) return;
    if (!shouldShowCustomControls()) return;

    setCustomControlsOpacity(CONFIG.customControlsDimOpacity);
    log('dim custom controls', reason);
  }

  function brightenCustomControls(reason = 'brighten') {
    if (!state.customControlsEl) return;

    clearTimeout(state.customControlsHideTimer);
    setCustomControlsOpacity(CONFIG.customControlsBrightOpacity);

    state.customControlsHideTimer = setTimeout(() => {
      if (CONFIG.customControlsAlwaysVisible) {
        dimCustomControls(`${reason}:timer`);
      } else {
        hideCustomControls();
      }
    }, CONFIG.customControlsDimAfterMs);
  }

  function showCustomControls(reason = 'show') {
    if (!shouldShowCustomControls()) {
      hideCustomControls();
      return;
    }

    const el = ensureCustomControls();
    if (!el) return;

    el.style.display = 'flex';
    el.style.transition = 'opacity 420ms ease';
    updateCustomControls();
    brightenCustomControls(reason);

    log('show custom controls', reason);
  }

  function hideCustomControls() {
    try {
      clearTimeout(state.customControlsHideTimer);

      if (state.customControlsEl) {
        state.customControlsEl.style.display = 'none';
      }
    } catch {}
  }

  async function togglePlayPause() {
    const video = getVideo();
    if (!video) return false;

    try {
      if (video.paused) {
        const result = video.play();
        if (result && typeof result.catch === 'function') {
          result.catch((error) => log('video.play failed:', error));
        }
      } else {
        video.pause();
      }

      setTimeout(updateCustomControls, 80);
      return true;
    } catch (error) {
      log('toggle play failed:', error);
      return false;
    }
  }

  function syncCustomControls(reason = 'sync') {
    if (shouldShowCustomControls()) {
      showCustomControls(reason);
    } else {
      hideCustomControls();
    }
  }


  function isInteractiveTarget(target) {
    try {
      if (!target || target.nodeType !== 1) return false;

      return Boolean(
        target.closest(
          [
            `#${APP_ID}-fullscreen-hint`,
            `#${APP_ID}-custom-controls`,
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
      updateCustomControls();
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
      На втором тапе гасим событие, чтобы штатный YouTube не добавил ещё ±10 секунд сверху.
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
        В портретном режиме выходим только если до этого реально были в landscape
        или fullscreen явно активен.
      */
      if (state.wasLandscape || isBrowserFullscreenActive() || isYoutubePlayerFullscreenClassActive()) {
        schedulePortraitExit(reason);
      }

      hideFullscreenHint();
      hideCustomControls();
      state.wasLandscape = false;
    };

    const onFullscreenLikeChange = () => {
      if (isFullscreenActive()) {
        hideFullscreenHint();
        scheduleFullscreenLayoutFix('fullscreenchange');
        syncCustomControls('fullscreenchange');
      } else {
        removeFullscreenLayoutFix();
        hideCustomControls();

        if (isLandscape() && CONFIG.showFullscreenHintOnLandscape && (!CONFIG.fullscreenHintWatchPagesOnly || isWatchLikePage())) {
          showFullscreenHint();
        }
      }
    };

    window.addEventListener('orientationchange', () => onOrientationLikeChange('orientationchange'), { passive: true });
    window.addEventListener('resize', () => onOrientationLikeChange('resize'), { passive: true });

    document.addEventListener('fullscreenchange', onFullscreenLikeChange, true);
    document.addEventListener('webkitfullscreenchange', onFullscreenLikeChange, true);

    const onControlsGesture = (event) => {
      if (!shouldShowCustomControls()) return;
      if (isInteractiveTarget(event.target)) return;
      showCustomControls('gesture');
    };

    document.addEventListener('pointerup', onControlsGesture, true);
    document.addEventListener('touchend', onControlsGesture, true);

    try {
      if (screen.orientation && typeof screen.orientation.addEventListener === 'function') {
        screen.orientation.addEventListener('change', () => onOrientationLikeChange('screen-orientation-change'));
      }
    } catch {}
  }


  function normalizeChipLabel(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ');
  }

  function getChipLabel(chip) {
    try {
      const chipContainer = chip.querySelector?.('.chip-container');
      const aria =
        chipContainer?.getAttribute('aria-label') ||
        chip.getAttribute?.('aria-label') ||
        '';

      if (aria) return aria;

      return chip.textContent || '';
    } catch {
      return '';
    }
  }

  function restoreHomeChips() {
    try {
      const hiddenItems = document.querySelectorAll('[data-cu-chip-hidden="1"]');

      hiddenItems.forEach((item) => {
        item.style.removeProperty('display');
        delete item.dataset.cuChipHidden;
      });
    } catch {}
  }

  function cleanHomeChips(reason = 'clean') {
    if (!CONFIG.homeChipsCleanupEnabled) return;

    try {
      const bars = document.querySelectorAll('.chip-bar-contents');

      if (!bars.length) {
        restoreHomeChips();
        return;
      }

      if (!isHomePage()) {
        restoreHomeChips();
        return;
      }

      const allowed = new Set(
        (CONFIG.homeChipAllowedLabels || []).map((label) => normalizeChipLabel(label)),
      );

      bars.forEach((bar) => {
        Array.from(bar.children || []).forEach((item) => {
          const tag = (item.tagName || '').toLowerCase();

          if (tag === 'ytm-chip-divider-renderer') {
            item.style.display = 'none';
            item.dataset.cuChipHidden = '1';
            return;
          }

          if (tag !== 'ytm-chip-cloud-chip-renderer') return;

          const label = normalizeChipLabel(getChipLabel(item));
          const keep = allowed.has(label);

          if (keep) {
            item.style.removeProperty('display');
            delete item.dataset.cuChipHidden;
          } else {
            item.style.display = 'none';
            item.dataset.cuChipHidden = '1';
          }
        });
      });

      log('home chips cleaned', reason);
    } catch (error) {
      log('home chips cleanup failed:', error);
    }
  }

  function scheduleHomeChipsCleanup(reason = 'scheduled') {
    if (!CONFIG.homeChipsCleanupEnabled) return;

    clearTimeout(state.homeChipsTimer);
    state.homeChipsTimer = setTimeout(() => cleanHomeChips(reason), 120);
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
    hideCustomControls();

    scheduleBind();
    scheduleRefresh(reason);
    syncFullscreenSoon(reason);
    scheduleHomeChipsCleanup(reason);
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
        scheduleHomeChipsCleanup('mutation');

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

  /*
    Мини-диагностика из консоли:
    window.cuDebug()
  */
  window.cuDebug = function cuDebug() {
    const video = getVideo();
    const player = getPlayer();

    return {
      app: APP_SHORT,
      version: '0.2.9',
      url: location.href,
      videoId: getVideoIdFromUrl(),
      landscape: isLandscape(),
      browserFullscreen: isBrowserFullscreenActive(),
      youtubeFullscreen: isYoutubePlayerFullscreenClassActive(),
      fullscreenActive: isFullscreenActive(),
      hasVideo: Boolean(video),
      hasPlayer: Boolean(player),
      hasYoutubeFullscreenButton: Boolean(findYoutubeFullscreenButton()),
      fullscreenNeedsGesture: state.fullscreenNeedsGesture,
      wasLandscape: state.wasLandscape,
      autoEnterFullscreenOnLandscape: CONFIG.autoEnterFullscreenOnLandscape,
      showFullscreenHintOnLandscape: CONFIG.showFullscreenHintOnLandscape,
      customControlsEnabled: CONFIG.customControlsEnabled,
      customControlsDimOpacity: CONFIG.customControlsDimOpacity,
      volumeControlEnabled: CONFIG.volumeControlEnabled,
      volumePercent: getVideoVolumePercent(video),
      storedVolumePercent: readStoredVolumePercent(),
      hasVolumeSlider: Boolean(state.volumeSliderEl),
      hasVolumeTrack: Boolean(state.volumeActiveTrackEl),
      volumeTrackActiveWidth: state.volumeActiveTrackEl ? state.volumeActiveTrackEl.style.width : '',
      fullscreenLayoutFixEnabled: CONFIG.fullscreenLayoutFixEnabled,
      fullscreenLayoutFixRootTag: (state.fullscreenLayoutFixRoot && state.fullscreenLayoutFixRoot.tagName) || '',
      fullscreenHintWatchPagesOnly: CONFIG.fullscreenHintWatchPagesOnly,
      fullscreenHintScale: CONFIG.fullscreenHintScale,
      homePage: isHomePage(),
      homeChipsCleanupEnabled: CONFIG.homeChipsCleanupEnabled,
      videoRect: getVideoRectInfo(),
      hasFullscreenHint: Boolean(state.fsHintEl),
      hasCustomControls: Boolean(state.customControlsEl),
      customControlsVisible: Boolean(state.customControlsEl && state.customControlsEl.style.display !== 'none'),
      fullscreenElementTag: (getFullscreenElement() && getFullscreenElement().tagName) || '',
      segments: state.segments.length,
      loadedVideoId: state.loadedVideoId,
    };
  };

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
    scheduleHomeChipsCleanup('init');

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        scheduleBind();
        scheduleRefresh('visibility');
        syncFullscreenSoon('visibility');
        syncCustomControls('visibility');
        scheduleHomeChipsCleanup('visibility');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
