// ==UserScript==
// @name         YouTube Crutches
// @name:ru      Костыли для Ютуба
// @description  Cleaner mobile YouTube: SponsorBlock, synced volume, fullscreen and launcher tab control.
// @description:ru Чище мобильный YouTube: SponsorBlock, единая громкость, fullscreen и контроль ярлыка.
// @namespace    https://github.com/npekpacHo/cu
// @version      0.3.24
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
    useHashPrefixApi: false,
    hashPrefixLength: 4,

    /*
      0.3.21: hash-prefix остаётся первым (приватнее), но любая ошибка/неполный
      ответ теперь гарантированно откатывается к прямому API по videoID.
    */
    sponsorBlockDirectFallback: true,

    /*
      0.3.22:
      надёжность важнее приватности hash-prefix. Сначала прямой API по videoID.
      Пропуск больше не считается успешным только потому, что присваивание
      currentTime не бросило исключение.
    */
    sponsorPreferDirectApi: true,
    sponsorWakeMaxDelayMs: 8000,
    sponsorPrecisionLeadMs: 220,
    sponsorPrecisionPollMs: 35,
    sponsorSeekVerifyDelayMs: 140,
    sponsorSeekToleranceSec: 1.2,
    sponsorSeekRetryDelayMs: 120,

    cacheTtlMs: 6 * 60 * 60 * 1000,

    /*
      Пустой список сегментов нельзя считать таким же надёжным, как найденные
      сегменты. Он мог получиться из старой разметки, временного ответа API или
      потому что сегмент добавили через минуту после нашего первого запроса.
    */
    emptyCacheTtlMs: 5 * 60 * 1000,

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
    fullscreenHintHideOnShorts: true,
    fullscreenHintScale: 1.5,

    /*
      0.3.17:
      это скрывает YouTube-овские fullscreen overlays/grid/quick actions.
      Системную плашку Chromium вида "youtube.com is now full screen"
      страница скрыть не может — она рисуется самим браузером вне DOM.
    */
    hideYoutubeFullscreenNoise: true,

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
    volumeStorageKey: 'cu:volume:v2',
    volumeLegacyStorageKey: 'cu:volume:v1',
    volumeDefaultPercent: 30,
    volumeMinPercent: 0,
    volumeMaxPercent: 100,
    volumeStepPercent: 1,
    volumeSliderWidthPx: 126,

    /*
      0.3.13:
      Комфортная кривая микшера.
      100% ползунка = 100% HTML-громкости.
      80% ползунка = 50% HTML-громкости.
      Ниже остаётся плавная тонкая регулировка.
    */
    volumeComfortCurveEnabled: true,
    volumeSliderPercentForHalfActual: 80,
    volumeHalfActualPercent: 50,
    volumeLabelShowsActualPercent: true,

    /*
      Управление звуком в Shorts.
      В обычных видео ползунок живёт в наших нижних кнопках, но в Shorts этих
      кнопок нет, поэтому добавляем отдельный пункт в штатный action bar.
    */
    shortsVolumeControlEnabled: true,
    shortsVolumeButtonText: '🔉',
    shortsVolumeActionBarLabel: 'Звук',
    shortsVolumePanelAutoHideMs: 3600,
    shortsVolumePanelBottomPx: 86,

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
      0.3.7:
      громкость должна быть одна на обычных видео и Shorts.
      YouTube любит плодить несколько <video>, а потом один из них внезапно орёт
      громче остальных, как будто у него отдельный договор с соседями.
    */
    volumeSyncAllVideos: true,
    volumeSyncAllVideosOnMutation: true,
    volumeSyncForceOnPlay: true,
    volumeSyncDebounceMs: 160,

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

    /*
      0.3.0:
      локальный бан каналов в рекомендациях, Shorts, поиске и похожих карточках.
      Это не дизлайк и не сигнал YouTube, а наш быстрый санитарный фильтр:
      нажал ⊘ на карточке, канал ушёл в localStorage, все его карточки скрылись.
    */
    channelFilterEnabled: true,
    channelBanButtonEnabled: true,
    channelBanStorageKey: 'cu:banned-channels:v1',
    channelBanButtonText: '💩',
    channelBanButtonSizePx: 36,
    channelBanButtonFontPx: 24,
    channelBanButtonOffsetPx: 8,
    channelBanButtonOpacity: 0.72,
    channelBanButtonDimOpacity: 0.38,
    channelBanScanDelayMs: 180,

    /*
      0.3.1:
      отдельная кнопка для настоящей страницы Shorts `/shorts/...`.
      Там нет обычной карточки, поэтому кнопка должна жить как отдельный fixed overlay.
    */
    shortsBanOverlayEnabled: true,
    shortsBanButtonSizePx: 56,
    shortsBanButtonFontPx: 34,
    shortsBanButtonRightPx: 12,
    shortsBanButtonTopPx: 74,
    shortsBanButtonPreferActionBar: true,
    shortsBanButtonActionBarLabel: 'ЧС',
    shortsBanButtonFallbackFixed: true,
    hideBanButtonOnMainWatchVideo: true,

    /*
      0.3.2:
      по нажатию ⊘ на Shorts пробуем не только локально скрыть канал,
      но и отправить YouTube нормальный пользовательский сигнал:
      дизлайк + "Не интересно" / "Не рекомендовать канал", если пункты доступны.
      Это не массовая накрутка, а реакция на конкретный мусор, выбранный человеком.
    */
    negativeFeedbackEnabled: true,
    negativeFeedbackOnShortsBan: true,
    negativeFeedbackOnCardBan: false,
    negativeFeedbackDislikeShorts: true,
    /*
      В 0.3.3 выяснилось, что на активном Shorts кнопка "ещё" открывает
      bottom sheet настроек плеера: описание, субтитры, дорожка, жалоба и т.п.
      Пунктов "Не интересно" / "Не рекомендовать канал" там нет.
      Поэтому на активных Shorts меню не открываем: только локальный бан + дизлайк.
    */
    negativeFeedbackUseMenu: false,
    negativeFeedbackPreferDontRecommendChannel: true,
    negativeFeedbackCloseWrongMenu: true,
    negativeFeedbackMenuOpenDelayMs: 280,
    negativeFeedbackMenuClickDelayMs: 140,
    negativeFeedbackBusyMs: 1800,
    negativeFeedbackToastMs: 1100,
    negativeFeedbackHideCardDelayMs: 450,

    /*
      0.3.5:
      ЧС должен работать как ЧС, а не как пожелание доброго утра.
      Если канал забанен и снова всплыл в активном Shorts, пролистываем его дальше.
    */
    shortsSkipBannedChannelsEnabled: true,
    shortsSkipBannedDelayMs: 360,
    shortsSkipBannedAfterBanDelayMs: 950,
    shortsSkipBannedCooldownMs: 1600,
    shortsSkipGestureDistancePx: 430,
    shortsSkipUseNextButton: true,
    shortsSkipUseKeyboard: true,
    shortsAdvanceAfterPoopEnabled: true,
    shortsAdvanceAfterPoopDelayMs: 520,
    shortsRequireStrongChannelForBan: false,
    channelBanVerifyAfterClick: true,

    /*
      0.3.9:
      защита от гонки при быстром свайпе Shorts.
      YouTube может уже показать новый DOM, но держать старый playerResponse.
      В этот момент банить/автопропускать нельзя: можно попасть не в тот канал.
    */
    shortsIdentityRaceGuardEnabled: true,
    shortsIdentityRaceDelayMs: 150,
    shortsIdentityMismatchGraceMs: 260,
    shortsIdentityMaxDeferredAttempts: 2,

    doubleTapSeekEnabled: true,
    doubleTapSeekSeconds: 10,
    doubleTapMaxDelayMs: 360,
    doubleTapMaxDistancePx: 44,

    showToasts: true,
    debug: false,

    /*
      0.3.10:
      аварийный safe-mode для главной YouTube.
      На реальном мобильном Chrome главная при активном скрипте могла уходить
      в бесконечную перезагрузку. Поэтому на home-страницах не запускаем тяжёлые
      модули Shorts/ЧС/volume-mutation, пока пользователь не перешёл на watch/shorts.
    */
    homeSafeModeEnabled: true,
    homeSafeModeDisableMutationHeavyTasks: true,
    homeSafeModeDisableChannelFilter: true,
    homeSafeModeDisableVolumeSync: true,
    homeSafeModeDisableShortsModules: true,
    homeSafeModeHosts: ['m.youtube.com', 'www.youtube.com'],
    homeSafeModePaths: ['/', '/feed/recommended'],

    /*
      0.3.11:
      возвращаем 💩 на главную, но в безопасном режиме.
      Только лёгкая обработка карточек, без тяжёлых модулей плеера и без лавины
      сканов на каждую mutation-волну.
    */
    homePoopEnabled: false,
    homePoopScanDelayMs: 900,
    homePoopMutationDelayMs: 2200,
    homePoopMaxCardsPerScan: 36,
    homePoopHideBannedCards: true,
    homePoopNegativeFeedback: false,

    /*
      0.3.12:
      при клике 💩 на карточке главной пробуем отправить штатный feedback YouTube
      через меню карточки: "Не рекомендовать канал" / "Не интересно".
      Работает только по клику пользователя, не на mutation.
    */
    cardFeedbackEnabled: true,
    cardFeedbackOnlyHomeSafeMode: true,
    cardFeedbackOpenMenuDelayMs: 420,
    cardFeedbackClickDelayMs: 160,
    cardFeedbackCloseDelayMs: 350,
    cardFeedbackCooldownMs: 1800,
    cardFeedbackCloseWrongMenu: true,
    cardFeedbackPreferDontRecommendChannel: true,

    /*
      0.3.14:
      главная — без 💩. Вместо этого вырезаем Shorts/джем-секции,
      стопорим автопревью и прячем рекламные/платные оверлеи.
    */
    homeCleanupEnabled: true,
    homeCleanupDelayMs: 650,
    homeCleanupMutationDelayMs: 1400,
    homeCleanupMaxNodesPerScan: 80,
    homeCleanupHideShortsShelves: true,
    homeCleanupHideMyJam: true,
    homeCleanupDisablePreviewAutoplay: true,
    homeCleanupHidePaidContentOverlays: true,
    homeCleanupHideInlinePreviewOverlays: true,

    /*
      0.3.16:
      собственный fallback для штатной рекламы YouTube.
      SponsorBlock занимается встроенными интеграциями автора, а не роликами,
      которые сам YouTube вставляет перед/внутри видео.
    */
    nativeAdSkipEnabled: true,
    nativeAdSkipPollMs: 250,
    nativeAdSkipClickButtons: true,
    nativeAdSkipCloseOverlays: true,
    nativeAdSkipSpeedupEnabled: true,
    nativeAdSkipPlaybackRate: 16,
    nativeAdSkipSeekToEndEnabled: false,
    nativeAdSkipRequireStrongSignalForSeek: true,
    nativeAdSkipRestoreDelayMs: 450,
    nativeAdSkipToast: true,

    /*
      0.3.15:
      Shorts оставляем как отдельный раздел и нижнюю кнопку навигации,
      но вычищаем их из главной, поиска, рекомендаций и прочих лент.
    */
    ambientShortsCleanupEnabled: false,
    ambientShortsCleanupDelayMs: 650,
    ambientShortsCleanupMutationDelayMs: 1400,
    ambientShortsCleanupMaxLinksPerScan: 160,
    ambientShortsCleanupMaxTextNodesPerScan: 90,
    ambientShortsCleanupHideShelves: true,
    ambientShortsCleanupHideCards: true,
    ambientShortsCleanupHideChips: true,
    ambientShortsCleanupHideMyJam: true,
    ambientShortsCleanupDisablePreviewAutoplay: true,
    ambientShortsCleanupKeepBottomNav: true,
    ambientShortsCleanupKeepDirectShortsPage: true,

    // 0.3.18: CSS-only Shorts cleanup; no global DOM scanner.
    shortsCssCleanupEnabled: false,
    shortsTransitionGuardMs: 3000,

    /*
      0.3.19:
      диагностический safe-mode Shorts.
      На /shorts КЮ не трогает DOM, видео, громкость, ЧС, fullscreen и SponsorBlock.
      Сначала добиваемся абсолютно стабильного открытия Shorts, затем возвращаем
      функции по одной.
    */
    shortsSafeModeEnabled: true,

    // 0.3.20: в safe-mode Shorts возвращаем только синхронизацию громкости.
    shortsSafeVolumeSyncEnabled: true,
    shortsSafeVolumeSyncDelayMs: 120,

    /*
      0.3.23:
      ярлык Android ведёт через https://npekpacho.ru/y/?launch=1
      на m.youtube.com/?cu=launcher. Только такой запуск участвует в
      защите от дублей. Обычные вручную открытые вкладки не закрываем.
    */
    launcherSingletonEnabled: true,
    launcherQueryKey: 'cu',
    launcherQueryValue: 'launcher',
    launcherChannelName: 'cu:youtube-tabs:v1',
    launcherProbeWaitMs: 420,
    launcherCloseRetryMs: 140,
    launcherFallbackUrl: 'https://npekpacho.ru/y/?duplicate=1',
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
    sponsorWakeTimer: 0,
    sponsorPrecisionTimer: 0,
    sponsorPrecisionInterval: 0,
    sponsorActiveVideo: null,
    sponsorSeekToken: 0,
    sponsorSeekInFlight: false,
    sponsorTrace: [],
    lastSponsorVerifiedSeek: null,

    launcherChannel: null,
    launcherTabId: '',
    launcherReady: false,
    launcherWasRequest: false,
    launcherDuplicateDetected: false,
    launcherResponder: null,
    launcherLastEvent: null,

    nativeAdPollTimer: 0,
    nativeAdWasActive: false,
    nativeAdSavedPlaybackRate: 1,
    nativeAdLastActionAtMs: 0,
    nativeAdLastResult: null,

    lastSkipKey: '',
    lastSkipAtMs: 0,
    lastSponsorBlockFetch: null,
    lastSponsorBlockError: null,
    lastSponsorSkipResult: null,

    fsHintEl: null,
    customControlsEl: null,
    customControlsHideTimer: 0,
    volumeAppliedVideo: null,
    volumeAppliedVideos: new WeakSet(),
    volumeSyncTimer: 0,
    volumeInternalChangeUntilMs: 0,
    lastVolumeSyncResult: null,
    volumeSliderEl: null,
    volumeTrackEl: null,
    volumeActiveTrackEl: null,
    volumeThumbEl: null,
    volumeLabelEl: null,
    shortsVolumeSlotEl: null,
    shortsVolumeButtonEl: null,
    shortsVolumePanelEl: null,
    shortsVolumeSliderEl: null,
    shortsVolumeActiveTrackEl: null,
    shortsVolumeThumbEl: null,
    shortsVolumeLabelEl: null,
    shortsVolumeHideTimer: 0,
    fullscreenLayoutFixRoot: null,
    fullscreenLayoutFixTimerIds: [],
    homeChipsTimer: 0,
    channelFilterTimer: 0,
    homePoopTimer: 0,
    lastHomePoopResult: null,
    homeCleanupTimer: 0,
    lastHomeCleanupResult: null,
    ambientShortsCleanupTimer: 0,
    lastAmbientShortsCleanupResult: null,
    shortsTransitionTimer: 0,
    shortsSafeVolumeTimer: 0,
    lastShortsSafeVolumeResult: null,
    lastCardFeedbackResult: null,
    cardFeedbackBusyUntilMs: 0,
    shortsBanButtonEl: null,
    blockedShortsTimer: 0,
    lastBlockedShortsSkipAtMs: 0,
    lastBlockedShortsVideoId: '',
    lastBannedShortsVideoId: '',
    lastBannedShortsChannelKey: '',
    lastBlockedShortsResult: null,
    lastPoopActionResult: null,
    shortsIdentityMismatchSinceMs: 0,
    shortsIdentityDeferredAttempts: 0,
    lastShortsIdentityStatus: null,
    negativeFeedbackBusyUntilMs: 0,
    lastNegativeFeedbackResult: null,
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

  function getAllVideos() {
    try {
      return Array.from(document.querySelectorAll('video')).filter(Boolean);
    } catch {
      return [];
    }
  }

  function getVideoVisibilityScore(video) {
    try {
      if (!video || !video.getBoundingClientRect) return -9999;

      const rect = video.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 360;
      const vh = window.innerHeight || document.documentElement.clientHeight || 640;

      const visibleWidth = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      const visibleArea = visibleWidth * visibleHeight;
      const totalArea = Math.max(1, rect.width * rect.height);
      const visibleRatio = visibleArea / totalArea;

      let score = 0;

      if (visibleArea > 4000) score += 30;
      score += Math.min(40, visibleArea / 12000);
      score += visibleRatio * 25;

      if (!video.paused) score += 55;
      if (!video.ended) score += 5;
      if (video.readyState >= 2) score += 8;
      if (video.currentSrc || video.src) score += 5;
      if (video.classList?.contains('html5-main-video')) score += 8;

      if (isShortsPage()) {
        if (rect.height > vh * 0.45) score += 25;
        if (Math.abs((rect.top + rect.bottom) / 2 - vh / 2) < vh * 0.35) score += 20;
      }

      if (rect.width <= 1 || rect.height <= 1) score -= 80;

      return score;
    } catch {
      return 0;
    }
  }

  function getVideo() {
    const videos = getAllVideos();

    if (!videos.length) return null;
    if (videos.length === 1) return videos[0];

    return videos
      .map((video) => ({ video, score: getVideoVisibilityScore(video) }))
      .sort((a, b) => b.score - a.score)[0]?.video || videos[0];
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

  function getShortsVideoIdFromUrl(urlText = location.href) {
    try {
      const url = new URL(urlText, location.origin);
      const shortsMatch = url.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch && isValidVideoId(shortsMatch[1])) return shortsMatch[1];

      const sourceMatch = url.pathname.match(/^\/source\/([^/?#]+)\/shorts/);
      if (sourceMatch && isValidVideoId(sourceMatch[1])) return sourceMatch[1];

      return '';
    } catch {
      return '';
    }
  }

  function getVideoIdFromPlayerResponse() {
    try {
      const responses = [
        window.ytInitialPlayerResponse,
        window.playerResponse,
      ].filter(Boolean);

      for (const response of responses) {
        const id = response?.videoDetails?.videoId || response?.currentVideoEndpoint?.watchEndpoint?.videoId || '';
        if (isValidVideoId(id)) return id;
      }

      return '';
    } catch {
      return '';
    }
  }

  function getVideoIdFromShortsLinks(root = document) {
    try {
      const selectors = [
        'a[href^="/shorts/"]',
        'a[href*="youtube.com/shorts/"]',
        'link[rel="canonical"]',
        'meta[property="og:url"]',
        'meta[name="twitter:url"]',
      ];

      for (const selector of selectors) {
        const nodes = Array.from(root.querySelectorAll?.(selector) || []);

        for (const node of nodes) {
          const href =
            node.getAttribute?.('href') ||
            node.getAttribute?.('content') ||
            node.href ||
            '';

          const id = getShortsVideoIdFromUrl(href);
          if (id) return id;
        }
      }

      return '';
    } catch {
      return '';
    }
  }

  function getCurrentShortsVideoIdParts(root = null) {
    try {
      const activeRoot = root || getCurrentShortsRoot?.() || document;
      const url = getShortsVideoIdFromUrl();
      const dom = getVideoIdFromShortsLinks(activeRoot) || getVideoIdFromShortsLinks(document);
      const player = getVideoIdFromPlayerResponse();
      const strong = url || dom || '';
      const chosen = strong || player || '';
      const hasMismatch = Boolean(strong && player && strong !== player);

      return {
        url,
        dom,
        player,
        strong,
        chosen,
        hasMismatch,
        mismatch: hasMismatch ? `${strong} != ${player}` : '',
        source: url ? 'url' : dom ? 'dom' : player ? 'player' : '',
        at: Date.now(),
      };
    } catch {
      return {
        url: '',
        dom: '',
        player: '',
        strong: '',
        chosen: '',
        hasMismatch: false,
        mismatch: '',
        source: '',
        at: Date.now(),
      };
    }
  }

  function getCurrentShortsVideoId() {
    /*
      На `/shorts/<id>` всё просто. На общей ленте `/shorts/` URL пустой,
      поэтому вытаскиваем id из активного DOM, canonical/og или playerResponse.
    */
    return getCurrentShortsVideoIdParts().chosen || '';
  }

  function isShortsPage() {
    try {
      return /^\/shorts(?:\/|$)/.test(location.pathname);
    } catch {
      return false;
    }
  }

  function isSourceShortsPage() {
    try {
      return /^\/source\/[^/]+\/shorts/.test(location.pathname);
    } catch {
      return false;
    }
  }

  function isFullscreenHintForbiddenPage() {
    return Boolean(CONFIG.fullscreenHintHideOnShorts && isShortsPage());
  }

  function shouldShowFullscreenHint() {
    if (!CONFIG.showFullscreenHintOnLandscape) return false;
    if (isFullscreenHintForbiddenPage()) return false;
    if (CONFIG.fullscreenHintWatchPagesOnly && !isWatchLikePage()) return false;

    return true;
  }

  function isHomePage() {
    try {
      const path = location.pathname.replace(/\/+$/, '') || '/';
      return path === '/' || path === '/feed/recommended';
    } catch {
      return false;
    }
  }

  function isSupportedYouTubeHost() {
    try {
      return CONFIG.homeSafeModeHosts.includes(location.hostname);
    } catch {
      return true;
    }
  }

  function isHomeSafeModePage() {
    if (!CONFIG.homeSafeModeEnabled) return false;

    try {
      if (!isSupportedYouTubeHost()) return false;

      const path = location.pathname.replace(/\/+$/, '') || '/';

      if (!CONFIG.homeSafeModePaths.includes(path)) return false;
      if (isWatchLikePage() || isShortsPage() || isSourceShortsPage()) return false;

      return true;
    } catch {
      return false;
    }
  }


  function isShortsSafeModePage() {
    return Boolean(
      CONFIG.shortsSafeModeEnabled &&
      (isShortsPage() || isSourceShortsPage())
    );
  }

  function stopShortsRuntimeTasks(reason = 'shorts-safe-mode') {
    try {
      clearTimeout(state.bindTimer);
      clearTimeout(state.refreshTimer);
      clearSponsorWakeTimer();
      clearTimeout(state.volumeSyncTimer);
      clearTimeout(state.channelFilterTimer);
      clearTimeout(state.homePoopTimer);
      clearTimeout(state.homeCleanupTimer);
      clearTimeout(state.ambientShortsCleanupTimer);
      clearTimeout(state.blockedShortsTimer);
      clearTimeout(state.shortsVolumeHideTimer);
      clearTimeout(state.customControlsHideTimer);
      clearTimeout(state.shortsSafeVolumeTimer);

      state.bindTimer = 0;
      state.refreshTimer = 0;
      state.volumeSyncTimer = 0;
      state.channelFilterTimer = 0;
      state.homePoopTimer = 0;
      state.homeCleanupTimer = 0;
      state.ambientShortsCleanupTimer = 0;
      state.blockedShortsTimer = 0;

      stopNativeAdPoll(reason);

      hideShortsBanButton();
      hideShortsVolumeControl();
      hideCustomControls();

      /*
        Если до перехода был привязан обычный video, отвязываем слушатели.
        Сам Shorts video здесь вообще не трогаем.
      */
      if (state.boundVideo) {
        try {
          state.boundVideo.removeEventListener('timeupdate', onSponsorTimeUpdate);
          state.boundVideo.removeEventListener('seeking', onSponsorSeeking);
          state.boundVideo.removeEventListener('seeked', onSponsorSeeked);
          state.boundVideo.removeEventListener('ratechange', onSponsorRateChange);
          state.boundVideo.removeEventListener('loadedmetadata', onVideoMetadata);
          state.boundVideo.removeEventListener('play', onVideoPlay);
          state.boundVideo.removeEventListener('pause', updateCustomControls);
          state.boundVideo.removeEventListener('timeupdate', updateCustomControls);
          state.boundVideo.removeEventListener('volumechange', updateVolumeControl);
        } catch {}

        state.boundVideo = null;
      }

      if (shouldRunShortsSafeVolumeSync()) {
        scheduleShortsSafeVolume(`${reason}-volume`, 0);
      }

      log('Shorts safe-mode active:', reason);
    } catch (error) {
      log('Shorts safe-mode cleanup failed:', error);
    }
  }



  function shouldRunShortsSafeVolumeSync() {
    return Boolean(
      CONFIG.shortsSafeModeEnabled &&
      CONFIG.shortsSafeVolumeSyncEnabled &&
      (isShortsPage() || isSourceShortsPage())
    );
  }

  function applyStoredVolumeToShortsVideo(video, reason = 'shorts-safe-volume') {
    if (!shouldRunShortsSafeVolumeSync()) return false;
    if (!video || String(video.tagName || '').toLowerCase() !== 'video') return false;

    const stored = readStoredVolumePercent();
    if (stored === null) return false;

    try {
      const beforeSlider = getVideoVolumePercent(video);
      const beforeActual = getVideoActualVolumePercent(video);

      const changed = setSingleVideoVolume(video, stored);

      state.lastShortsSafeVolumeResult = {
        reason,
        storedSlider: stored,
        mappedActual: sliderPercentToActualVolumePercent(stored),
        beforeSlider,
        beforeActual,
        afterSlider: getVideoVolumePercent(video),
        afterActual: getVideoActualVolumePercent(video),
        changed,
        at: new Date().toISOString(),
      };

      return changed;
    } catch (error) {
      state.lastShortsSafeVolumeResult = {
        reason,
        error: String(error && error.message ? error.message : error),
        at: new Date().toISOString(),
      };
      return false;
    }
  }

  function findActiveShortsVideoLightweight() {
    if (!shouldRunShortsSafeVolumeSync()) return null;

    try {
      const videos = Array.from(document.querySelectorAll('video')).filter(Boolean);
      if (!videos.length) return null;
      if (videos.length === 1) return videos[0];

      const playing = videos.find((video) => {
        try {
          return !video.paused && !video.ended && video.readyState >= 2;
        } catch {
          return false;
        }
      });

      if (playing) return playing;

      let best = null;
      let bestArea = -1;

      for (const video of videos.slice(0, 12)) {
        try {
          const rect = video.getBoundingClientRect();
          const area = Math.max(0, rect.width) * Math.max(0, rect.height);

          if (area > bestArea && rect.bottom > 0 && rect.right > 0) {
            best = video;
            bestArea = area;
          }
        } catch {}
      }

      return best || videos[0];
    } catch {
      return null;
    }
  }

  function syncShortsSafeVolume(reason = 'shorts-safe-volume') {
    if (!shouldRunShortsSafeVolumeSync()) return false;

    const video = findActiveShortsVideoLightweight();

    if (!video) {
      state.lastShortsSafeVolumeResult = {
        reason,
        foundVideo: false,
        at: new Date().toISOString(),
      };
      return false;
    }

    return applyStoredVolumeToShortsVideo(video, reason);
  }

  function scheduleShortsSafeVolume(reason = 'shorts-safe-volume', delay = CONFIG.shortsSafeVolumeSyncDelayMs) {
    if (!shouldRunShortsSafeVolumeSync()) return;

    clearTimeout(state.shortsSafeVolumeTimer);
    state.shortsSafeVolumeTimer = setTimeout(() => {
      syncShortsSafeVolume(reason);
    }, delay);
  }

  function bindShortsSafeVolumeSync() {
    const onMediaEvent = (event) => {
      if (!shouldRunShortsSafeVolumeSync()) return;

      const video = event.target;
      if (!video || String(video.tagName || '').toLowerCase() !== 'video') return;

      if (event.type === 'play' || event.type === 'loadedmetadata') {
        applyStoredVolumeToShortsVideo(video, `shorts-${event.type}`);
        return;
      }

      if (event.type === 'volumechange') {
        // Наше изменение само вызывает volumechange — его не ловим по кругу.
        if (Date.now() <= state.volumeInternalChangeUntilMs) return;

        const stored = readStoredVolumePercent();
        if (stored === null) return;

        const current = getVideoVolumePercent(video);

        if (Math.abs(current - stored) >= 1 || (stored > 0 && video.muted)) {
          setTimeout(() => {
            applyStoredVolumeToShortsVideo(video, 'shorts-volume-reset');
          }, 0);
        }
      }
    };

    document.addEventListener('play', onMediaEvent, true);
    document.addEventListener('loadedmetadata', onMediaEvent, true);
    document.addEventListener('volumechange', onMediaEvent, true);
  }

  window.cuShortsVolumeInfo = function cuShortsVolumeInfo() {
    const stored = readStoredVolumePercent();

    return {
      enabled: CONFIG.shortsSafeVolumeSyncEnabled,
      active: shouldRunShortsSafeVolumeSync(),
      storedSlider: stored,
      mappedActual: stored === null ? null : sliderPercentToActualVolumePercent(stored),
      lastResult: state.lastShortsSafeVolumeResult,
    };
  };

  window.cuSyncShortsVolume = function cuSyncShortsVolume() {
    return syncShortsSafeVolume('manual-console');
  };


  function shouldRunHeavyPlayerTasks() {
    if (isHomeSafeModePage()) return false;
    if (isShortsSafeModePage()) return false;

    return isWatchLikePage() || Boolean(getVideo());
  }

  function shouldRunShortsTasks() {
    if (isHomeSafeModePage()) return false;
    if (isShortsSafeModePage()) return false;

    return isShortsPage() || isSourceShortsPage();
  }

  function shouldRunChannelFilterTasks() {
    /*
      0.3.14: 💩 оставляем только в активных Shorts.
      Карточные кнопки на главной/видео/поиске больше не нужны.
    */
    return false;
  }

  function shouldRunHomePoopTasks() {
    return false;
  }

  function shouldRunVolumeSyncTasks() {
    if (isShortsSafeModePage()) return false;
    if (isHomeSafeModePage() && CONFIG.homeSafeModeDisableVolumeSync) return false;

    return shouldRunHeavyPlayerTasks();
  }


  function shouldRunNativeAdSkipTasks() {
    if (!CONFIG.nativeAdSkipEnabled) return false;
    if (document.hidden) return false;
    if (isHomeSafeModePage()) return false;
    if (isShortsPage() || isSourceShortsPage()) return false;

    return isWatchLikePage() || Boolean(getVideoIdFromPlayerResponse()) || Boolean(getPlayer());
  }

  function getNativeAdPlayer() {
    try {
      return (
        document.querySelector('#movie_player') ||
        document.querySelector('.html5-video-player') ||
        document.querySelector('ytm-player #movie_player') ||
        document.querySelector('ytm-player') ||
        null
      );
    } catch {
      return null;
    }
  }

  function findNativeAdSkipButton(root = document) {
    const selectors = [
      '.ytp-ad-skip-button',
      '.ytp-ad-skip-button-modern',
      '.ytp-skip-ad-button',
      '.ytp-ad-skip-button-slot button',
      'button.ytp-ad-skip-button-modern',
      'button[data-purpose="video-ad-skip-button"]',
      '.videoAdUiSkipButton',
    ];

    try {
      for (const selector of selectors) {
        const button = root.querySelector?.(selector) || document.querySelector(selector);
        if (button && isElementVisible(button)) return button;
      }

      const candidates = Array.from(
        (root.querySelectorAll?.('button, [role="button"], a[role="button"]') || []),
      ).slice(0, 120);

      for (const el of candidates) {
        if (!isElementVisible(el)) continue;

        const label = normalizeUiText(
          [
            el.getAttribute?.('aria-label') || '',
            el.getAttribute?.('title') || '',
            el.textContent || '',
          ].join(' '),
        );

        if (
          label.includes('skip ad') ||
          label.includes('skip ads') ||
          label.includes('пропустить рекламу') ||
          label.includes('пропустить объявления') ||
          label === 'пропустить'
        ) {
          return el;
        }
      }
    } catch {}

    return null;
  }

  function findNativeAdOverlayCloseButton(root = document) {
    const selectors = [
      '.ytp-ad-overlay-close-button',
      '.ytp-ad-feedback-dialog-close-button',
      '.ytp-ad-overlay-close-container button',
    ];

    try {
      for (const selector of selectors) {
        const button = root.querySelector?.(selector) || document.querySelector(selector);
        if (button && isElementVisible(button)) return button;
      }
    } catch {}

    return null;
  }

  function getNativeAdSignals() {
    try {
      const player = getNativeAdPlayer();
      const classList = player?.classList;

      const playerAdShowing = Boolean(classList?.contains('ad-showing'));
      const playerAdInterrupting = Boolean(classList?.contains('ad-interrupting'));
      const skipButton = findNativeAdSkipButton(player || document);
      const overlayCloseButton = findNativeAdOverlayCloseButton(player || document);

      const adUi = Boolean(
        document.querySelector(
          [
            '.video-ads.ytp-ad-module',
            '.ytp-ad-player-overlay',
            '.ytp-ad-preview-container',
            '.ytp-ad-text',
            '.ytp-ad-duration-remaining',
            '.ytp-ad-time-remaining',
            '.ytp-ad-persistent-progress-bar-container',
          ].join(','),
        ),
      );

      const strong =
        playerAdShowing ||
        playerAdInterrupting ||
        Boolean(skipButton) ||
        Boolean(document.querySelector('.ytp-ad-duration-remaining, .ytp-ad-time-remaining'));

      return {
        player,
        playerAdShowing,
        playerAdInterrupting,
        skipButton,
        overlayCloseButton,
        adUi,
        strong,
        active: Boolean(strong || (adUi && (playerAdShowing || playerAdInterrupting))),
      };
    } catch {
      return {
        player: null,
        playerAdShowing: false,
        playerAdInterrupting: false,
        skipButton: null,
        overlayCloseButton: null,
        adUi: false,
        strong: false,
        active: false,
      };
    }
  }

  function restoreAfterNativeAd(reason = 'ad-end') {
    if (!state.nativeAdWasActive) return false;

    const video = getVideo();

    try {
      if (video) {
        const restoreRate =
          Number.isFinite(state.nativeAdSavedPlaybackRate) && state.nativeAdSavedPlaybackRate > 0
            ? state.nativeAdSavedPlaybackRate
            : 1;

        video.playbackRate = restoreRate;
        applyStoredVolume(video, true);
        syncStoredVolumeToAllVideos(`native-ad-restore-${reason}`, true);
      }
    } catch {}

    state.nativeAdWasActive = false;
    state.nativeAdLastResult = {
      status: 'restored',
      reason,
      at: new Date().toISOString(),
    };

    return true;
  }

  function runNativeAdSkipCheck(reason = 'poll') {
    if (!shouldRunNativeAdSkipTasks()) {
      restoreAfterNativeAd('disabled-context');
      return null;
    }

    const signals = getNativeAdSignals();

    if (!signals.active) {
      if (state.nativeAdWasActive) {
        setTimeout(() => restoreAfterNativeAd('signals-gone'), CONFIG.nativeAdSkipRestoreDelayMs);
      }
      return null;
    }

    const video = getVideo();
    const now = Date.now();

    if (!state.nativeAdWasActive) {
      state.nativeAdWasActive = true;
      state.nativeAdSavedPlaybackRate =
        video && Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1;
    }

    let clickedSkip = false;
    let closedOverlay = false;
    let spedUp = false;
    let soughtToEnd = false;

    if (
      CONFIG.nativeAdSkipClickButtons &&
      signals.skipButton &&
      now - state.nativeAdLastActionAtMs > 120
    ) {
      try {
        signals.skipButton.click();
        clickedSkip = true;
        state.nativeAdLastActionAtMs = now;
      } catch {}
    }

    if (CONFIG.nativeAdSkipCloseOverlays && signals.overlayCloseButton) {
      try {
        signals.overlayCloseButton.click();
        closedOverlay = true;
      } catch {}
    }

    if (video && signals.strong) {
      try {
        video.muted = true;

        if (CONFIG.nativeAdSkipSpeedupEnabled && video.playbackRate < CONFIG.nativeAdSkipPlaybackRate) {
          video.playbackRate = CONFIG.nativeAdSkipPlaybackRate;
          spedUp = true;
        }

        const duration = Number(video.duration);
        const current = Number(video.currentTime);
        const canSeek =
          CONFIG.nativeAdSkipSeekToEndEnabled &&
          (!CONFIG.nativeAdSkipRequireStrongSignalForSeek || signals.strong) &&
          Number.isFinite(duration) &&
          Number.isFinite(current) &&
          duration > 0.25 &&
          current < duration - 0.05;

        if (canSeek && (signals.playerAdShowing || signals.playerAdInterrupting) && signals.adUi) {
          video.currentTime = Math.max(current, duration - 0.03);
          soughtToEnd = true;
        }
      } catch {}
    }

    const result = {
      status: 'ad-detected',
      reason,
      clickedSkip,
      closedOverlay,
      spedUp,
      soughtToEnd,
      playerAdShowing: signals.playerAdShowing,
      playerAdInterrupting: signals.playerAdInterrupting,
      adUi: signals.adUi,
      videoDuration: Number.isFinite(video?.duration) ? video.duration : null,
      videoCurrentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
      at: new Date().toISOString(),
    };

    state.nativeAdLastResult = result;

    if (
      CONFIG.nativeAdSkipToast &&
      (clickedSkip || soughtToEnd) &&
      now - state.nativeAdLastActionAtMs < 400
    ) {
      toast(`${APP_SHORT}: реклама пропущена`, 700);
    }

    log('native ad check', result);
    return result;
  }

  function startNativeAdPoll(reason = 'start') {
    stopNativeAdPoll('restart');

    if (!shouldRunNativeAdSkipTasks()) return false;

    runNativeAdSkipCheck(reason);

    state.nativeAdPollTimer = window.setInterval(() => {
      runNativeAdSkipCheck('poll');
    }, CONFIG.nativeAdSkipPollMs);

    return true;
  }

  function stopNativeAdPoll(reason = 'stop') {
    if (state.nativeAdPollTimer) {
      clearInterval(state.nativeAdPollTimer);
      state.nativeAdPollTimer = 0;
    }

    restoreAfterNativeAd(reason);
  }

  function syncNativeAdPoll(reason = 'sync') {
    if (shouldRunNativeAdSkipTasks()) {
      startNativeAdPoll(reason);
    } else {
      stopNativeAdPoll(reason);
    }
  }

  window.cuNativeAdInfo = function cuNativeAdInfo() {
    const signals = getNativeAdSignals();

    return {
      enabled: CONFIG.nativeAdSkipEnabled,
      shouldRun: shouldRunNativeAdSkipTasks(),
      pollActive: Boolean(state.nativeAdPollTimer),
      signals: {
        playerAdShowing: signals.playerAdShowing,
        playerAdInterrupting: signals.playerAdInterrupting,
        hasSkipButton: Boolean(signals.skipButton),
        hasOverlayCloseButton: Boolean(signals.overlayCloseButton),
        adUi: signals.adUi,
        strong: signals.strong,
        active: signals.active,
      },
      lastResult: state.nativeAdLastResult,
    };
  };


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
      const parsePayload = (status, payload) => {
        if (status === 404) {
          resolve(null);
          return;
        }

        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status}`));
          return;
        }

        try {
          if (payload === null || payload === undefined || payload === '') {
            resolve(null);
            return;
          }

          if (typeof payload === 'object') {
            resolve(payload);
            return;
          }

          resolve(JSON.parse(String(payload)));
        } catch (error) {
          reject(new Error(`JSON parse failed: ${error?.message || error}`));
        }
      };

      if (typeof GM_xmlhttpRequest === 'function') {
        try {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            headers: { Accept: 'application/json' },
            responseType: 'text',
            timeout: 12000,
            onload: (res) => {
              const payload =
                typeof res?.responseText === 'string' && res.responseText.length
                  ? res.responseText
                  : res?.response;

              parsePayload(Number(res?.status || 0), payload);
            },
            onerror: (res) => reject(new Error(`GM_xmlhttpRequest error${res?.status ? ` HTTP ${res.status}` : ''}`)),
            ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
            onabort: () => reject(new Error('GM_xmlhttpRequest aborted')),
          });
          return;
        } catch (error) {
          log('GM_xmlhttpRequest setup failed, trying fetch:', error);
        }
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

      const ttl = item.segments.length ? CONFIG.cacheTtlMs : CONFIG.emptyCacheTtlMs;
      if (Date.now() - item.time > ttl) return null;

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

    // 404/пустой ответ => не считаем это доказательством отсутствия сегментов.
    // Дадим прямому endpoint вторую попытку.
    if (data === null) return null;
    if (!Array.isArray(data)) throw new Error('SponsorBlock hash response is not an array');

    const exact = data.find((item) => item && item.videoID === videoId);
    if (!exact) return null;
    if (!Array.isArray(exact.segments)) throw new Error('SponsorBlock hash item has no segments array');

    return exact.segments;
  }

  async function fetchSegmentsDirect(videoId) {
    const params = new URLSearchParams(sponsorBlockQueryParams());
    params.delete('trimUUIDs');
    params.set('videoID', videoId);

    const url = `${SB_API}/api/skipSegments?${params.toString()}`;
    const data = await gmRequestJson(url);

    if (data === null) return [];
    if (!Array.isArray(data)) throw new Error('SponsorBlock direct response is not an array');

    return data;
  }


  function sponsorTrace(stage, data = {}) {
    try {
      const item = {
        at: new Date().toISOString(),
        stage,
        ...data,
      };

      state.sponsorTrace.push(item);
      if (state.sponsorTrace.length > 80) {
        state.sponsorTrace.splice(0, state.sponsorTrace.length - 80);
      }

      log('SponsorBlock trace', item);
      return item;
    } catch {
      return null;
    }
  }

  function isSponsorNativeAdActive() {
    try {
      const signals = getNativeAdSignals();
      return Boolean(signals?.active || signals?.playerAdShowing || signals?.playerAdInterrupting);
    } catch {
      return false;
    }
  }

  function isUsableSponsorVideo(video) {
    try {
      if (!video || String(video.tagName || '').toLowerCase() !== 'video') return false;
      if (!video.isConnected) return false;
      if (!Number.isFinite(video.currentTime)) return false;
      return true;
    } catch {
      return false;
    }
  }

  function adoptSponsorVideo(video, reason = 'media-event') {
    if (!isUsableSponsorVideo(video)) return false;
    if (isShortsSafeModePage() || isHomeSafeModePage()) return false;

    if (state.sponsorActiveVideo !== video) {
      state.sponsorActiveVideo = video;
      sponsorTrace('video-adopted', {
        reason,
        currentTime: Number(video.currentTime || 0),
        paused: Boolean(video.paused),
        readyState: Number(video.readyState || 0),
        className: String(video.className || ''),
      });
    }

    return true;
  }

  function clearSponsorPrecisionTimers() {
    clearTimeout(state.sponsorPrecisionTimer);
    clearInterval(state.sponsorPrecisionInterval);
    state.sponsorPrecisionTimer = 0;
    state.sponsorPrecisionInterval = 0;
  }

  window.cuSponsorTrace = function cuSponsorTrace() {
    return [...state.sponsorTrace];
  };


  async function getSponsorSegments(videoId, options = {}) {
    const bypassCache = Boolean(options.bypassCache);
    const forceDirect = Boolean(options.forceDirect);

    if (!bypassCache) {
      const cached = readCache(videoId);
      if (cached !== null) {
        state.lastSponsorBlockFetch = {
          videoId,
          source: 'cache',
          categories: [...CONFIG.categories],
          segments: cached,
          count: cached.length,
          at: new Date().toISOString(),
        };
        return cached;
      }
    }

    const errors = [];
    let raw = null;
    let source = '';

    const tryDirect = async () => {
      try {
        const value = await fetchSegmentsDirect(videoId);
        return { ok: true, value };
      } catch (error) {
        errors.push({ source: 'direct', message: String(error?.message || error) });
        return { ok: false, value: null };
      }
    };

    const tryHash = async () => {
      try {
        const value = await fetchSegmentsByHashPrefix(videoId);
        return { ok: value !== null, value };
      } catch (error) {
        errors.push({ source: 'hash-prefix', message: String(error?.message || error) });
        return { ok: false, value: null };
      }
    };

    if (forceDirect || CONFIG.sponsorPreferDirectApi || !CONFIG.useHashPrefixApi) {
      const direct = await tryDirect();
      if (direct.ok) {
        raw = direct.value;
        source = forceDirect ? 'direct-force' : 'direct';
      } else if (!forceDirect && CONFIG.useHashPrefixApi) {
        const hashed = await tryHash();
        if (hashed.ok) {
          raw = hashed.value;
          source = 'hash-fallback';
        }
      }
    } else {
      const hashed = await tryHash();
      if (hashed.ok) {
        raw = hashed.value;
        source = 'hash-prefix';
      } else if (CONFIG.sponsorBlockDirectFallback) {
        const direct = await tryDirect();
        if (direct.ok) {
          raw = direct.value;
          source = 'direct-fallback';
        }
      }
    }

    if (raw === null) {
      state.lastSponsorBlockError = {
        videoId,
        errors,
        message: errors.map((item) => `${item.source}: ${item.message}`).join('; ') || 'no usable response',
        at: new Date().toISOString(),
      };
      state.lastSponsorBlockFetch = {
        videoId,
        source: 'error',
        categories: [...CONFIG.categories],
        segments: [],
        count: 0,
        error: state.lastSponsorBlockError,
        at: new Date().toISOString(),
      };
      return [];
    }

    const segments = normalizeSegments(raw);
    writeCache(videoId, segments);

    sponsorTrace('segments-fetched', {
      videoId,
      source,
      rawCount: Array.isArray(raw) ? raw.length : null,
      normalizedCount: segments.length,
      categories: [...CONFIG.categories],
    });

    state.lastSponsorBlockError = errors.length ? { videoId, errors, recovered: true, at: new Date().toISOString() } : null;
    state.lastSponsorBlockFetch = {
      videoId,
      source,
      categories: [...CONFIG.categories],
      segments,
      count: segments.length,
      fallbackErrors: errors,
      at: new Date().toISOString(),
    };

    return segments;
  }

  function getSponsorVideoId() {
    const fromUrl = getVideoIdFromUrl();
    if (fromUrl) return fromUrl;

    const fromPlayer = getVideoIdFromPlayerResponse();
    if (fromPlayer) return fromPlayer;

    try {
      const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
      const fromCanonical = canonical ? getVideoIdFromUrl(canonical) : '';
      if (fromCanonical) return fromCanonical;
    } catch {}

    return '';
  }

  function resolveSponsorVideo(source = null) {
    try {
      const direct = source && String(source.tagName || '').toLowerCase() === 'video' ? source : null;
      if (isUsableSponsorVideo(direct)) return direct;

      const currentTarget = source?.currentTarget;
      if (isUsableSponsorVideo(currentTarget)) return currentTarget;

      const target = source?.target;
      if (isUsableSponsorVideo(target)) return target;

      if (isUsableSponsorVideo(state.sponsorActiveVideo)) return state.sponsorActiveVideo;
      if (isUsableSponsorVideo(state.boundVideo)) return state.boundVideo;

      const player = getPlayer();
      const main = player?.querySelector?.('video.html5-main-video, video');
      if (isUsableSponsorVideo(main)) return main;

      const fallback = document.querySelector('video.html5-main-video') || getVideo();
      return isUsableSponsorVideo(fallback) ? fallback : null;
    } catch {
      return isUsableSponsorVideo(state.sponsorActiveVideo)
        ? state.sponsorActiveVideo
        : (isUsableSponsorVideo(state.boundVideo) ? state.boundVideo : null);
    }
  }

  function clearSponsorWakeTimer() {
    clearTimeout(state.sponsorWakeTimer);
    state.sponsorWakeTimer = 0;
    clearSponsorPrecisionTimers();
  }

  function getSponsorSegmentState(video) {
    if (!video || !state.segments.length || !Number.isFinite(video.currentTime)) {
      return { current: null, segment: null, next: null };
    }

    const current = Number(video.currentTime);

    const segment = state.segments.find(
      (item) =>
        current >= item.start - CONFIG.skipBeforeStartSec &&
        current < item.end - CONFIG.skipAfterEndSec,
    ) || null;

    const next = state.segments.find(
      (item) => item.start - CONFIG.skipBeforeStartSec > current,
    ) || null;

    return { current, segment, next };
  }

  function startSponsorPrecisionWindow(video, segment, reason = 'precision') {
    clearInterval(state.sponsorPrecisionInterval);

    if (!isUsableSponsorVideo(video) || !segment) return;

    sponsorTrace('precision-window', {
      reason,
      currentTime: Number(video.currentTime || 0),
      segmentStart: segment.start,
      segmentEnd: segment.end,
    });

    const startedAt = performance.now();

    state.sponsorPrecisionInterval = setInterval(() => {
      if (!isUsableSponsorVideo(video) || video.paused || isSponsorNativeAdActive()) {
        clearInterval(state.sponsorPrecisionInterval);
        state.sponsorPrecisionInterval = 0;
        scheduleSponsorWake('precision-paused', video);
        return;
      }

      const current = Number(video.currentTime);

      if (
        current >= segment.start - CONFIG.skipBeforeStartSec &&
        current < segment.end - CONFIG.skipAfterEndSec
      ) {
        clearInterval(state.sponsorPrecisionInterval);
        state.sponsorPrecisionInterval = 0;
        runSkipCheck(video);
        return;
      }

      if (current >= segment.end || performance.now() - startedAt > 2500) {
        clearInterval(state.sponsorPrecisionInterval);
        state.sponsorPrecisionInterval = 0;
        scheduleSponsorWake('precision-expired', video);
      }
    }, CONFIG.sponsorPrecisionPollMs);
  }

  function scheduleSponsorWake(reason = 'wake', source = null) {
    clearSponsorWakeTimer();

    if (!shouldRunHeavyPlayerTasks() || !state.segments.length) return;

    const video = resolveSponsorVideo(source);
    if (!video || video.paused || !Number.isFinite(video.currentTime)) return;

    adoptSponsorVideo(video, `wake-${reason}`);

    if (isSponsorNativeAdActive()) {
      sponsorTrace('schedule-paused-for-native-ad', { reason });
      state.sponsorWakeTimer = setTimeout(() => {
        scheduleSponsorWake('native-ad-recheck', video);
      }, 500);
      return;
    }

    const { current, segment, next } = getSponsorSegmentState(video);

    if (segment) {
      state.sponsorWakeTimer = setTimeout(() => runSkipCheck(video), 0);
      return;
    }

    if (!next) return;

    const rate = Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1;
    const secondsUntil = Math.max(0, next.start - CONFIG.skipBeforeStartSec - current);
    const rawDelay = (secondsUntil * 1000) / rate;
    const lead = CONFIG.sponsorPrecisionLeadMs;

    if (rawDelay <= lead + 80) {
      startSponsorPrecisionWindow(video, next, reason);
      return;
    }

    const delay = Math.max(
      40,
      Math.min(CONFIG.sponsorWakeMaxDelayMs, rawDelay - lead),
    );

    state.sponsorWakeTimer = setTimeout(() => {
      const fresh = getSponsorSegmentState(video);

      if (fresh.segment) {
        runSkipCheck(video);
      } else if (fresh.next) {
        const freshRate = Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1;
        const freshDelay = ((fresh.next.start - CONFIG.skipBeforeStartSec - fresh.current) * 1000) / freshRate;

        if (freshDelay <= CONFIG.sponsorPrecisionLeadMs + 100) {
          startSponsorPrecisionWindow(video, fresh.next, 'wake-near-segment');
        } else {
          scheduleSponsorWake('wake-recheck', video);
        }
      }
    }, delay);

    sponsorTrace('wake-scheduled', {
      reason,
      delay,
      current,
      nextStart: next.start,
      nextEnd: next.end,
    });
  }

  function sponsorVideoSummary(video) {
    if (!video) return null;
    try {
      return {
        connected: Boolean(video.isConnected),
        currentTime: Number.isFinite(video.currentTime) ? Number(video.currentTime.toFixed(3)) : null,
        duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : null,
        paused: Boolean(video.paused),
        readyState: Number(video.readyState || 0),
        className: String(video.className || ''),
      };
    } catch {
      return { connected: Boolean(video?.isConnected) };
    }
  }

  async function refreshSegments(reason = 'refresh', force = false) {
    const videoId = getSponsorVideoId();

    if (!videoId) {
      state.videoId = '';
      state.loadedVideoId = '';
      state.segments = [];
      state.lastSkipKey = '';
      state.lastSkipAtMs = 0;
      clearSponsorWakeTimer();
      return;
    }

    if (!force && videoId === state.loadedVideoId) {
      scheduleSponsorWake(`${reason}-already-loaded`, state.boundVideo);
      return;
    }

    const token = ++state.loadToken;

    state.videoId = videoId;
    state.loadedVideoId = '';
    state.segments = [];
    state.lastSkipKey = '';
    state.lastSkipAtMs = 0;
    clearSponsorWakeTimer();

    log('loading SponsorBlock segments', { videoId, reason });
    sponsorTrace('segments-load-start', { videoId, reason });

    const segments = await getSponsorSegments(videoId, {
      bypassCache: force,
      forceDirect: force,
    });

    if (token !== state.loadToken) return;
    if (videoId !== getSponsorVideoId()) return;

    state.loadedVideoId = videoId;
    state.segments = segments;

    if (segments.length) {
      toast(`${APP_SHORT}: найдено сегментов: ${segments.length}`, 1200);
    }

    runSkipCheck(state.boundVideo);
    scheduleSponsorWake('segments-loaded', state.boundVideo);
  }


  function getSponsorBlockInfo() {
    const videoId = getSponsorVideoId();
    const byCategory = {};

    for (const segment of state.segments) {
      byCategory[segment.category] = (byCategory[segment.category] || 0) + 1;
    }

    return {
      videoId,
      categories: [...CONFIG.categories],
      selfpromoEnabled: CONFIG.categories.includes('selfpromo'),
      actionTypes: [...ACTION_TYPES],
      loadedVideoId: state.loadedVideoId,
      segments: state.segments.map((segment) => ({ ...segment })),
      byCategory,
      lastFetch: state.lastSponsorBlockFetch,
      lastError: state.lastSponsorBlockError,
      cacheKey: videoId ? cacheKey(videoId) : '',
      cached: videoId ? readCache(videoId) : null,
    };
  }

  window.cuSponsorInfo = function cuSponsorInfo() {
    return getSponsorBlockInfo();
  };

  window.cuRefreshSponsorBlock = async function cuRefreshSponsorBlock() {
    const videoId = getSponsorVideoId();
    if (!videoId) return { ok: false, reason: 'no-video-id' };

    try {
      localStorage.removeItem(cacheKey(videoId));
    } catch {}

    state.loadedVideoId = '';
    await refreshSegments('manual-force', true);

    return {
      ok: true,
      ...getSponsorBlockInfo(),
    };
  };

  window.cuProbeSponsorBlock = async function cuProbeSponsorBlock() {
    const videoId = getSponsorVideoId();
    if (!videoId) return { ok: false, reason: 'no-video-id' };

    try {
      const raw = await fetchSegmentsDirect(videoId);
      const segments = normalizeSegments(raw);
      const byCategory = {};

      for (const segment of segments) {
        byCategory[segment.category] = (byCategory[segment.category] || 0) + 1;
      }

      return {
        ok: true,
        videoId,
        categories: [...CONFIG.categories],
        selfpromoEnabled: CONFIG.categories.includes('selfpromo'),
        segments,
        byCategory,
      };
    } catch (error) {
      return {
        ok: false,
        videoId,
        error: String(error && error.message ? error.message : error),
      };
    }
  };


  window.cuSponsorSelfTest = function cuSponsorSelfTest() {
    const video = resolveSponsorVideo(state.boundVideo);
    const current = Number.isFinite(video?.currentTime) ? video.currentTime : null;
    const nextSegment = current === null
      ? null
      : state.segments.find((segment) => segment.end > current) || null;

    return {
      urlVideoId: getVideoIdFromUrl(),
      playerVideoId: getVideoIdFromPlayerResponse(),
      resolvedVideoId: getSponsorVideoId(),
      loadedVideoId: state.loadedVideoId,
      segmentsLoaded: state.segments.length,
      boundVideoConnected: Boolean(state.boundVideo?.isConnected),
      sponsorVideoIsBound: Boolean(video && video === state.boundVideo),
      sponsorVideo: sponsorVideoSummary(video),
      nextSegment,
      lastFetch: state.lastSponsorBlockFetch,
      lastError: state.lastSponsorBlockError,
      lastSkip: state.lastSponsorSkipResult,
      lastVerifiedSeek: state.lastSponsorVerifiedSeek,
      sponsorActiveVideo: sponsorVideoSummary(state.sponsorActiveVideo),
      seekInFlight: state.sponsorSeekInFlight,
      wakeTimerActive: Boolean(state.sponsorWakeTimer),
      precisionTimerActive: Boolean(state.sponsorPrecisionTimer || state.sponsorPrecisionInterval),
      nativeAdActive: isSponsorNativeAdActive(),
      traceTail: state.sponsorTrace.slice(-12),
    };
  };


  window.cuSponsorDiagnostic = async function cuSponsorDiagnostic() {
    const videoId = getSponsorVideoId();
    const video = resolveSponsorVideo(state.sponsorActiveVideo || state.boundVideo);
    let api = null;

    try {
      const raw = videoId ? await fetchSegmentsDirect(videoId) : null;
      const segments = normalizeSegments(raw || []);
      api = {
        ok: true,
        videoId,
        rawCount: Array.isArray(raw) ? raw.length : null,
        normalizedCount: segments.length,
        segments,
      };
    } catch (error) {
      api = {
        ok: false,
        videoId,
        error: String(error?.message || error),
      };
    }

    const player =
      video?.closest?.('#movie_player, .html5-video-player') ||
      document.querySelector('#movie_player, .html5-video-player');

    return {
      version: '0.3.24',
      api,
      loadedVideoId: state.loadedVideoId,
      loadedSegments: state.segments,
      video: sponsorVideoSummary(video),
      capabilities: {
        fastSeek: typeof video?.fastSeek === 'function',
        prototypeCurrentTimeSetter: Boolean(
          Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')?.set
        ),
        playerSeekTo: typeof player?.seekTo === 'function',
      },
      nativeAdActive: isSponsorNativeAdActive(),
      nextSegment: (() => {
        if (!video || !Number.isFinite(video.currentTime)) return null;
        return state.segments.find((segment) => segment.end > video.currentTime) || null;
      })(),
      lastVerifiedSeek: state.lastSponsorVerifiedSeek,
      traceTail: state.sponsorTrace.slice(-20),
    };
  };


  function scheduleRefresh(reason = 'scheduled') {
    if (!shouldRunHeavyPlayerTasks()) return;

    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refreshSegments(reason), 250);
  }


  function delayMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sponsorSeekVerified(video, target) {
    try {
      if (!isUsableSponsorVideo(video)) return false;
      const after = Number(video.currentTime);
      return Number.isFinite(after) && (
        after >= target - CONFIG.sponsorSeekToleranceSec ||
        Math.abs(after - target) <= CONFIG.sponsorSeekToleranceSec
      );
    } catch {
      return false;
    }
  }

  async function trySponsorSeekStrategy(video, target, strategy) {
    const before = Number(video.currentTime);

    try {
      if (strategy === 'currentTime') {
        video.currentTime = target;
      } else if (strategy === 'prototype-setter') {
        const descriptor =
          Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime') ||
          Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'currentTime');

        if (typeof descriptor?.set !== 'function') {
          return { ok: false, strategy, reason: 'no-prototype-setter', before };
        }

        descriptor.set.call(video, target);
      } else if (strategy === 'fastSeek') {
        if (typeof video.fastSeek !== 'function') {
          return { ok: false, strategy, reason: 'no-fastSeek', before };
        }

        video.fastSeek(target);
      } else if (strategy === 'player-seekTo') {
        const player =
          video.closest?.('#movie_player, .html5-video-player') ||
          document.querySelector('#movie_player, .html5-video-player');

        if (typeof player?.seekTo !== 'function') {
          return { ok: false, strategy, reason: 'no-player-seekTo', before };
        }

        player.seekTo(target, true);
      } else {
        return { ok: false, strategy, reason: 'unknown-strategy', before };
      }
    } catch (error) {
      return {
        ok: false,
        strategy,
        before,
        error: String(error?.message || error),
      };
    }

    await delayMs(CONFIG.sponsorSeekVerifyDelayMs);

    const after = Number(video.currentTime);
    const ok = sponsorSeekVerified(video, target);

    return { ok, strategy, before, after };
  }

  async function seekSponsorVideoVerified(video, target, segment) {
    if (!isUsableSponsorVideo(video)) {
      return { ok: false, reason: 'invalid-video' };
    }

    if (state.sponsorSeekInFlight) {
      return { ok: false, reason: 'seek-in-flight' };
    }

    const token = ++state.sponsorSeekToken;
    state.sponsorSeekInFlight = true;

    const attempts = [];
    const strategies = ['currentTime', 'prototype-setter', 'fastSeek', 'player-seekTo'];

    sponsorTrace('seek-start', {
      target,
      currentTime: Number(video.currentTime),
      category: segment?.category || '',
    });

    try {
      for (const strategy of strategies) {
        if (token !== state.sponsorSeekToken) {
          return { ok: false, reason: 'superseded', attempts };
        }

        const result = await trySponsorSeekStrategy(video, target, strategy);
        attempts.push(result);

        sponsorTrace('seek-attempt', {
          target,
          category: segment?.category || '',
          ...result,
        });

        if (result.ok) {
          const verified = {
            ok: true,
            strategy,
            target,
            after: Number(video.currentTime),
            attempts,
            at: new Date().toISOString(),
          };

          state.lastSponsorVerifiedSeek = verified;
          return verified;
        }

        await delayMs(CONFIG.sponsorSeekRetryDelayMs);
      }

      const failed = {
        ok: false,
        target,
        after: Number(video.currentTime),
        attempts,
        at: new Date().toISOString(),
      };

      state.lastSponsorVerifiedSeek = failed;
      return failed;
    } finally {
      if (token === state.sponsorSeekToken) {
        state.sponsorSeekInFlight = false;
      }
    }
  }


  function runSkipCheck(source = null) {
    const video = resolveSponsorVideo(source);

    if (!video || !state.segments.length) return false;
    if (!Number.isFinite(video.currentTime)) return false;
    if (isSponsorNativeAdActive()) {
      scheduleSponsorWake('skip-blocked-native-ad', video);
      return false;
    }

    adoptSponsorVideo(video, 'skip-check');

    const current = Number(video.currentTime);
    const now = Date.now();

    for (const segment of state.segments) {
      const start = segment.start;
      const end = segment.end;

      if (current >= start - CONFIG.skipBeforeStartSec && current < end - CONFIG.skipAfterEndSec) {
        const key = `${segment.category}:${start.toFixed(2)}-${end.toFixed(2)}`;

        if (state.sponsorSeekInFlight) return false;
        if (state.lastSkipKey === key && now - state.lastSkipAtMs < 500) return false;

        const duration = Number.isFinite(video.duration) ? video.duration : end + CONFIG.skipAfterEndSec;
        const target = Math.min(end + CONFIG.skipAfterEndSec, duration);

        state.lastSkipKey = key;
        state.lastSkipAtMs = now;

        sponsorTrace('segment-hit', {
          videoId: state.loadedVideoId || getSponsorVideoId(),
          category: segment.category,
          current,
          start,
          end,
          target,
        });

        seekSponsorVideoVerified(video, target, segment).then((result) => {
          const after = Number.isFinite(video.currentTime) ? Number(video.currentTime) : null;

          state.lastSponsorSkipResult = {
            ok: Boolean(result.ok),
            verified: true,
            videoId: state.loadedVideoId || getSponsorVideoId(),
            category: segment.category,
            key,
            from: current,
            to: target,
            after,
            strategy: result.strategy || null,
            attempts: result.attempts || [],
            video: sponsorVideoSummary(video),
            at: new Date().toISOString(),
          };

          if (result.ok) {
            toast(`${APP_SHORT}: пропущено, ${categoryLabel(segment.category)}`);
            sponsorTrace('skip-verified', state.lastSponsorSkipResult);
            scheduleSponsorWake('after-verified-skip', video);
          } else {
            /*
              Не блокируем повтор навсегда: YouTube мог откатить seek во время
              переключения player state. Через небольшой интервал попробуем снова.
            */
            state.lastSkipKey = '';
            state.lastSkipAtMs = 0;
            sponsorTrace('skip-failed-verification', state.lastSponsorSkipResult);

            setTimeout(() => {
              if (isUsableSponsorVideo(video)) {
                runSkipCheck(video);
                scheduleSponsorWake('retry-after-failed-seek', video);
              }
            }, 250);
          }
        });

        return true;
      }
    }

    return false;
  }

  function onSponsorTimeUpdate(event) {
    const video = event?.currentTarget || event?.target;
    adoptSponsorVideo(video, 'timeupdate');
    runSkipCheck(video);
  }

  function onSponsorSeeking(event) {
    const video = event?.currentTarget || event?.target;
    adoptSponsorVideo(video, 'seeking');
    clearSponsorPrecisionTimers();
  }

  function onSponsorSeeked(event) {
    const video = event?.currentTarget || event?.target;
    adoptSponsorVideo(video, 'seeked');
    runSkipCheck(video);
    scheduleSponsorWake('seeked', video);
  }

  function onSponsorRateChange(event) {
    const video = event?.currentTarget || event?.target;
    adoptSponsorVideo(video, 'ratechange');
    scheduleSponsorWake('ratechange', video);
  }


  function onGlobalSponsorMediaSignal(event) {
    if (isShortsSafeModePage() || isHomeSafeModePage()) return;

    const video = event?.target;
    if (!isUsableSponsorVideo(video)) return;

    if (!isWatchLikePage() && !getSponsorVideoId()) return;

    adoptSponsorVideo(video, `global-${event.type}`);

    if (event.type === 'play' || event.type === 'playing' || event.type === 'loadedmetadata') {
      scheduleRefresh(`global-${event.type}`);
      scheduleSponsorWake(`global-${event.type}`, video);
    } else if (event.type === 'timeupdate') {
      runSkipCheck(video);
    }
  }

  function bindGlobalSponsorMediaSignals() {
    document.addEventListener('play', onGlobalSponsorMediaSignal, true);
    document.addEventListener('playing', onGlobalSponsorMediaSignal, true);
    document.addEventListener('loadedmetadata', onGlobalSponsorMediaSignal, true);
    document.addEventListener('timeupdate', onGlobalSponsorMediaSignal, true);
  }


  function bindVideo() {
    const player = getPlayer();
    const video = player?.querySelector?.('video.html5-main-video, video') || getVideo();

    if (!video || video === state.boundVideo) return;

    if (state.boundVideo) {
      state.boundVideo.removeEventListener('timeupdate', onSponsorTimeUpdate);
      state.boundVideo.removeEventListener('seeking', onSponsorSeeking);
      state.boundVideo.removeEventListener('seeked', onSponsorSeeked);
      state.boundVideo.removeEventListener('ratechange', onSponsorRateChange);
      state.boundVideo.removeEventListener('loadedmetadata', onVideoMetadata);
      state.boundVideo.removeEventListener('play', onVideoPlay);
      state.boundVideo.removeEventListener('pause', updateCustomControls);
      state.boundVideo.removeEventListener('timeupdate', updateCustomControls);
      state.boundVideo.removeEventListener('volumechange', updateVolumeControl);
    }

    state.boundVideo = video;
    adoptSponsorVideo(video, 'bind-video');
    applyStoredVolume(video, true);
    syncStoredVolumeToAllVideos('bind-video', true);

    video.addEventListener('timeupdate', onSponsorTimeUpdate, { passive: true });
    video.addEventListener('seeking', onSponsorSeeking, { passive: true });
    video.addEventListener('seeked', onSponsorSeeked, { passive: true });
    video.addEventListener('ratechange', onSponsorRateChange, { passive: true });
    video.addEventListener('loadedmetadata', onVideoMetadata, { passive: true });
    video.addEventListener('play', onVideoPlay, { passive: true });
    video.addEventListener('pause', updateCustomControls, { passive: true });
    video.addEventListener('timeupdate', updateCustomControls, { passive: true });
    video.addEventListener('volumechange', updateVolumeControl, { passive: true });

    updateVolumeControl();

    scheduleRefresh('bind-video');
    scheduleSponsorWake('bind-video', video);
    syncFullscreenSoon('bind-video');
  }

  function scheduleBind() {
    if (isHomeSafeModePage()) return;
    if (isShortsSafeModePage()) return;

    clearTimeout(state.bindTimer);
    state.bindTimer = setTimeout(bindVideo, 120);
  }

  function onVideoMetadata() {
    applyStoredVolume(getVideo(), true);
    syncStoredVolumeToAllVideos('metadata', true);
    updateVolumeControl();
    scheduleRefresh('metadata');
    runSkipCheck(state.boundVideo);
    scheduleSponsorWake('metadata', state.boundVideo);
    syncFullscreenSoon('metadata');
    runNativeAdSkipCheck('metadata');
  }

  function onVideoPlay() {
    if (CONFIG.volumeSyncForceOnPlay) {
      syncStoredVolumeToAllVideos('play', true);
    }
    updateVolumeControl();
    scheduleRefresh('play');
    runSkipCheck(state.boundVideo);
    scheduleSponsorWake('play', state.boundVideo);
    syncFullscreenSoon('play');
    runNativeAdSkipCheck('play');
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
    if (isFullscreenHintForbiddenPage()) {
      hideFullscreenHint();
      return false;
    }
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

      if (isFullscreenHintForbiddenPage()) {
        hideFullscreenHint();
        return;
      }

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

        if (shouldShowFullscreenHint()) {
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
      if (!shouldShowFullscreenHint()) return;
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
${CONFIG.hideYoutubeFullscreenNoise ? `
.html5-video-player.ytp-fullscreen .ytp-fullscreen-quick-actions,
.html5-video-player.ytp-fullscreen .ytp-fullscreen-grid,
.html5-video-player.ytp-fullscreen .ytp-fullscreen-grid-expand-button,
.html5-video-player.ytp-fullscreen .ytp-fullscreen-grid-hover-overlay,
.html5-video-player.ytp-fullscreen .ytp-fullscreen-grid-hover-overlay-chevron,
.html5-video-player.ytp-fullscreen .ytp-fullscreen-grid-stills-container {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
` : ''}

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

  function getVolumeCurveExponent() {
    try {
      const sliderAtHalf = clampNumber(CONFIG.volumeSliderPercentForHalfActual, 1, 99) / 100;
      const halfActual = clampNumber(CONFIG.volumeHalfActualPercent, 1, 99) / 100;

      return Math.log(halfActual) / Math.log(sliderAtHalf);
    } catch {
      return 1;
    }
  }

  function sliderPercentToActualVolumePercent(sliderPercent) {
    const slider = normalizeVolumePercent(sliderPercent);

    if (!CONFIG.volumeComfortCurveEnabled) return slider;
    if (slider <= 0) return 0;
    if (slider >= 100) return 100;

    const exponent = getVolumeCurveExponent();
    const actual = Math.pow(slider / 100, exponent) * 100;

    return clampNumber(actual, 0, 100);
  }

  function actualVolumePercentToSliderPercent(actualPercent) {
    const actual = clampNumber(actualPercent, 0, 100);

    if (!CONFIG.volumeComfortCurveEnabled) return actual;
    if (actual <= 0) return 0;
    if (actual >= 100) return 100;

    const exponent = getVolumeCurveExponent();
    const slider = Math.pow(actual / 100, 1 / exponent) * 100;

    return clampNumber(slider, 0, 100);
  }

  function formatPercent(value) {
    const num = Number(value);

    if (!Number.isFinite(num)) return '0';
    if (num >= 10 || num === 0) return String(Math.round(num));

    return num.toFixed(1).replace(/\.0$/, '');
  }

  function getVolumeLabelText(sliderPercent) {
    const slider = normalizeVolumePercent(sliderPercent);
    const actual = sliderPercentToActualVolumePercent(slider);

    return CONFIG.volumeLabelShowsActualPercent
      ? `${formatPercent(actual)}%`
      : `${Math.round(slider)}%`;
  }

  function getVolumeTitle(sliderPercent) {
    const slider = normalizeVolumePercent(sliderPercent);
    const actual = sliderPercentToActualVolumePercent(slider);

    return `Громкость ${formatPercent(actual)}%, ползунок ${Math.round(slider)}%`;
  }

  function readStoredVolumePercent() {
    try {
      const raw = localStorage.getItem(CONFIG.volumeStorageKey);
      if (raw !== null && raw !== '') {
        const value = Number(raw);
        if (Number.isFinite(value)) return normalizeVolumePercent(value);
      }

      /*
        Миграция со старой линейной шкалы.
        В v1 значение было реальной HTML-громкостью. В v2 храним положение
        комфортного ползунка, поэтому фактическая громкость не должна прыгнуть.
      */
      const legacyRaw = CONFIG.volumeLegacyStorageKey
        ? localStorage.getItem(CONFIG.volumeLegacyStorageKey)
        : null;

      if (legacyRaw !== null && legacyRaw !== '') {
        const legacyActual = Number(legacyRaw);

        if (Number.isFinite(legacyActual)) {
          const migrated = actualVolumePercentToSliderPercent(legacyActual);
          writeStoredVolumePercent(migrated);
          return normalizeVolumePercent(migrated);
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  function writeStoredVolumePercent(percent) {
    try {
      localStorage.setItem(CONFIG.volumeStorageKey, String(Math.round(normalizeVolumePercent(percent))));
    } catch {}
  }

  function getVideoActualVolumePercent(video = getVideo()) {
    if (!video) return sliderPercentToActualVolumePercent(CONFIG.volumeDefaultPercent);

    try {
      if (video.muted) return 0;
      return clampNumber(video.volume * 100, 0, 100);
    } catch {
      return sliderPercentToActualVolumePercent(CONFIG.volumeDefaultPercent);
    }
  }

  function getVideoVolumePercent(video = getVideo()) {
    return Math.round(actualVolumePercentToSliderPercent(getVideoActualVolumePercent(video)));
  }


  function setSingleVideoVolume(video, percent) {
    if (!video) return false;

    const slider = normalizeVolumePercent(percent);
    const actual = sliderPercentToActualVolumePercent(slider);
    const volume = actual / 100;

    try {
      state.volumeInternalChangeUntilMs = Date.now() + 350;

      video.volume = volume;
      video.muted = actual <= 0.0001;

      if (actual > 0 && video.muted) {
        video.muted = false;
      }

      state.volumeAppliedVideos.add(video);
      return true;
    } catch (error) {
      log('single video volume failed:', error);
      return false;
    }
  }

  function getVideosForVolumeSync() {
    const videos = CONFIG.volumeSyncAllVideos ? getAllVideos() : [getVideo()];

    return Array.from(new Set(videos.filter(Boolean)));
  }

  function syncStoredVolumeToAllVideos(reason = 'sync', force = false) {
    if (!CONFIG.volumeControlEnabled || !CONFIG.volumeApplyStoredOnBind) return false;

    const stored = readStoredVolumePercent();
    if (stored === null) return false;

    const videos = getVideosForVolumeSync();
    let changed = 0;
    let skipped = 0;
    let errors = 0;

    for (const video of videos) {
      try {
        const current = getVideoVolumePercent(video);
        const alreadyApplied = state.volumeAppliedVideos.has(video);
        const needsSync =
          force ||
          !alreadyApplied ||
          Math.abs(current - stored) >= 1 ||
          (stored > 0 && video.muted);

        if (!needsSync) {
          skipped += 1;
          continue;
        }

        if (setSingleVideoVolume(video, stored)) {
          changed += 1;
        } else {
          errors += 1;
        }
      } catch {
        errors += 1;
      }
    }

    state.lastVolumeSyncResult = {
      reason,
      storedSlider: stored,
      storedActual: sliderPercentToActualVolumePercent(stored),
      videos: videos.length,
      changed,
      skipped,
      errors,
      activeSlider: getVideoVolumePercent(getVideo()),
      activeActual: getVideoActualVolumePercent(getVideo()),
      at: new Date().toISOString(),
    };

    updateVolumeControl();

    log('volume sync all', state.lastVolumeSyncResult);
    return changed > 0 || videos.length > 0;
  }

  function scheduleVolumeSync(reason = 'scheduled', force = false, delay = CONFIG.volumeSyncDebounceMs) {
    if (!CONFIG.volumeControlEnabled || !CONFIG.volumeSyncAllVideosOnMutation) return;
    if (!shouldRunVolumeSyncTasks()) return;

    clearTimeout(state.volumeSyncTimer);
    state.volumeSyncTimer = setTimeout(() => syncStoredVolumeToAllVideos(reason, force), delay);
  }


  function applyStoredVolume(video = getVideo(), force = false) {
    if (!CONFIG.volumeControlEnabled || !CONFIG.volumeApplyStoredOnBind || !video) return false;

    const stored = readStoredVolumePercent();

    /*
      Если значения ещё нет, не навязываем дефолт и не делаем вид, что умнее пользователя.
      Просто запоминаем текущую громкость YouTube как стартовую.
    */
    if (stored === null) {
      writeStoredVolumePercent(getVideoVolumePercent(video));
      state.volumeAppliedVideo = video;
      state.volumeAppliedVideos.add(video);
      return false;
    }

    if (!force && state.volumeAppliedVideos.has(video) && Math.abs(getVideoVolumePercent(video) - stored) < 1) {
      state.volumeAppliedVideo = video;
      return true;
    }

    const ok = setSingleVideoVolume(video, stored);

    state.volumeAppliedVideo = video;

    if (CONFIG.volumeSyncAllVideos) {
      syncStoredVolumeToAllVideos('apply-stored', force);
    }

    return ok;
  }

  function setVideoVolumePercent(percent, reason = 'manual', save = true) {
    const normalized = normalizeVolumePercent(percent);
    const videos = getVideosForVolumeSync();

    if (!videos.length) return false;

    let changed = 0;
    let errors = 0;

    try {
      for (const video of videos) {
        if (setSingleVideoVolume(video, normalized)) {
          changed += 1;
        } else {
          errors += 1;
        }
      }

      if (save) {
        writeStoredVolumePercent(normalized);
      }

      state.lastVolumeSyncResult = {
        reason,
        storedSlider: normalized,
        storedActual: sliderPercentToActualVolumePercent(normalized),
        videos: videos.length,
        changed,
        skipped: 0,
        errors,
        activeSlider: getVideoVolumePercent(getVideo()),
        activeActual: getVideoActualVolumePercent(getVideo()),
        at: new Date().toISOString(),
      };

      updateVolumeControl();

      if (isShortsPage()) {
        setTimeout(() => syncStoredVolumeToAllVideos(`${reason}:shorts-guard-200`, true), 200);
        setTimeout(() => syncStoredVolumeToAllVideos(`${reason}:shorts-guard-700`, true), 700);
      }

      if (reason !== 'stored') {
        toast(`${APP_SHORT}: звук ${getVolumeLabelText(normalized)}`, 650);
      }

      log('volume set', state.lastVolumeSyncResult);
      return changed > 0;
    } catch (error) {
      log('volume set failed:', error);
      return false;
    }
  }

  function updateVolumeWidgetVisual(slider, activeTrack, thumb, value = null) {
    if (!slider || !activeTrack || !thumb) return;

    try {
      const raw = value === null ? slider.value : value;
      const min = Number(slider.min || CONFIG.volumeMinPercent);
      const max = Number(slider.max || CONFIG.volumeMaxPercent);
      const percent = ((Number(raw) - min) / Math.max(1, max - min)) * 100;
      const safePercent = clampNumber(percent, 0, 100);

      activeTrack.style.width = `${safePercent}%`;
      thumb.style.left = `${safePercent}%`;
    } catch {}
  }

  function updateVolumeSliderVisual(value = null) {
    updateVolumeWidgetVisual(
      state.volumeSliderEl,
      state.volumeActiveTrackEl,
      state.volumeThumbEl,
      value,
    );
  }

  function updateShortsVolumeWidgetVisual(value = null) {
    updateVolumeWidgetVisual(
      state.shortsVolumeSliderEl,
      state.shortsVolumeActiveTrackEl,
      state.shortsVolumeThumbEl,
      value,
    );
  }

  function updateVolumeWidget(slider, label, activeTrack, thumb, sliderPercent) {
    if (!slider || !label) return;

    const normalized = normalizeVolumePercent(sliderPercent);

    try {
      slider.value = String(Math.round(normalized));
      updateVolumeWidgetVisual(slider, activeTrack, thumb, normalized);
      label.textContent = getVolumeLabelText(normalized);
      label.title = getVolumeTitle(normalized);
    } catch {}
  }

  function updateVolumeControl() {
    if (!CONFIG.volumeControlEnabled) return;

    const video = getVideo();
    const percent = video ? getVideoVolumePercent(video) : (readStoredVolumePercent() ?? CONFIG.volumeDefaultPercent);

    updateVolumeWidget(
      state.volumeSliderEl,
      state.volumeLabelEl,
      state.volumeActiveTrackEl,
      state.volumeThumbEl,
      percent,
    );

    updateVolumeWidget(
      state.shortsVolumeSliderEl,
      state.shortsVolumeLabelEl,
      state.shortsVolumeActiveTrackEl,
      state.shortsVolumeThumbEl,
      percent,
    );

    if (state.shortsVolumeButtonEl) {
      state.shortsVolumeButtonEl.title = getVolumeTitle(percent);
      state.shortsVolumeButtonEl.setAttribute('aria-label', getVolumeTitle(percent));
    }
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
    label.textContent = getVolumeLabelText(slider.value);
    label.title = getVolumeTitle(slider.value);
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
            `.${APP_ID}-channel-ban-button`,
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

        if (isLandscape() && shouldShowFullscreenHint()) {
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


  function ensureHomeCleanupStyle() {
    if (!CONFIG.homeCleanupEnabled) return;

    try {
      const styleId = `${APP_ID}-home-cleanup-style`;
      let style = document.getElementById(styleId);

      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        (document.head || document.documentElement).appendChild(style);
      }

      style.textContent = `
        ytm-paid-content-overlay-renderer,
        ytd-paid-content-overlay-renderer,
        .ytmPaidContentOverlayHost,
        .ytp-paid-content-overlay,
        .ytp-paid-content-overlay-link,
        ytm-inline-preview-ui-renderer,
        ytd-thumbnail-overlay-inline-unplayable-renderer,
        ytd-thumbnail-overlay-toggle-button-renderer,
        ytd-thumbnail-overlay-now-playing-renderer,
        ytm-promoted-video-renderer,
        ytm-promoted-sparkles-web-renderer,
        ytd-promoted-sparkles-web-renderer,
        ytm-mealbar-promo-renderer,
        ytd-mealbar-promo-renderer,
        ytm-statement-banner-renderer,
        ytd-statement-banner-renderer {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }

        [data-${APP_ID}-home-clean-hidden="1"],
        [data-${APP_ID}-ambient-shorts-hidden="1"] {
          display: none !important;
          visibility: hidden !important;
        }

        /*
          Лёгкая уборка очевидных Shorts-полок без :has().
          Не действует внутри /shorts.
        */
        html.${APP_ID}-page-nonshorts ytm-reel-shelf-renderer,
        html.${APP_ID}-page-nonshorts ytd-reel-shelf-renderer,
        html.${APP_ID}-page-nonshorts ytm-shorts-lockup-view-model,
        html.${APP_ID}-page-nonshorts ytm-shorts-lockup-view-model-v2,
        html.${APP_ID}-page-nonshorts ytm-shorts-lockup-view-model-v3,
        html.${APP_ID}-page-nonshorts ytm-reel-item-renderer,
        html.${APP_ID}-page-nonshorts ytd-reel-item-renderer {
          display: none !important;
          visibility: hidden !important;
        }

        ${CONFIG.shortsCssCleanupEnabled ? `
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytm-reel-shelf-renderer,
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytd-reel-shelf-renderer,
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytd-rich-shelf-renderer:has(a[href^="/shorts"]),
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytm-rich-section-renderer:has(a[href^="/shorts"]),
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytd-rich-section-renderer:has(a[href^="/shorts"]),
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytm-shorts-lockup-view-model,
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytm-shorts-lockup-view-model-v2,
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytm-shorts-lockup-view-model-v3,
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytm-reel-item-renderer,
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytd-reel-item-renderer,
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytm-rich-item-renderer:has(a[href^="/shorts/"]),
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytd-rich-item-renderer:has(a[href^="/shorts/"]),
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytm-video-with-context-renderer:has(a[href^="/shorts/"]),
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytm-compact-video-renderer:has(a[href^="/shorts/"]),
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytd-video-renderer:has(a[href^="/shorts/"]),
        html.${APP_ID}-page-nonshorts:not(.${APP_ID}-shorts-transitioning) ytd-compact-video-renderer:has(a[href^="/shorts/"]) {
          display: none !important;
          visibility: hidden !important;
        }
        ` : ''}
      `;
    } catch {}
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



  function ensureChannelFilterStyle() {
    if (!CONFIG.channelFilterEnabled || !CONFIG.channelBanButtonEnabled) return;

    try {
      const styleId = `${APP_ID}-channel-filter-style`;
      let style = document.getElementById(styleId);

      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        (document.head || document.documentElement).appendChild(style);
      }

      const size = `${CONFIG.channelBanButtonSizePx}px`;
      const offset = `${CONFIG.channelBanButtonOffsetPx}px`;
      const shortsSize = `${CONFIG.shortsBanButtonSizePx}px`;

      style.textContent = `
        .${APP_ID}-channel-ban-button {
          position: absolute;
          top: ${offset};
          right: ${offset};
          z-index: 2147483646;
          width: ${size};
          height: ${size};
          min-width: ${size};
          min-height: ${size};
          padding: 0;
          border: 0;
          border-radius: 999px;
          background: rgba(0, 0, 0, ${CONFIG.channelBanButtonOpacity});
          color: rgba(255, 255, 255, 0.94);
          font: ${CONFIG.channelBanButtonFontPx}px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;
          font-weight: 800;
          box-shadow: 0 2px 10px rgba(0,0,0,.32);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }

        .${APP_ID}-channel-ban-button:not(:active) {
          opacity: ${CONFIG.channelBanButtonDimOpacity};
        }

        .${APP_ID}-channel-ban-button:hover,
        .${APP_ID}-channel-ban-button:active {
          opacity: 1;
        }

        .${APP_ID}-shorts-ban-slot {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          width: auto;
          min-width: 48px;
          max-width: 72px;
          color: #fff;
          pointer-events: auto;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }

        .${APP_ID}-shorts-ban-button {
          width: ${shortsSize};
          height: ${shortsSize};
          min-width: ${shortsSize};
          min-height: ${shortsSize};
          padding: 0;
          border: 0;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
          color: rgba(255, 255, 255, 0.98);
          font: ${CONFIG.shortsBanButtonFontPx}px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;
          font-weight: 850;
          box-shadow: 0 2px 10px rgba(0,0,0,.24);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          opacity: 0.94;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .${APP_ID}-shorts-ban-button:active {
          opacity: 1;
          transform: scale(0.96);
        }

        .${APP_ID}-shorts-ban-label {
          min-height: 16px;
          max-width: 72px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: center;
          color: rgba(255, 255, 255, 0.96);
          font: 12px/1.12 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;
          font-weight: 650;
          text-shadow: 0 1px 3px rgba(0,0,0,.55);
        }

        .${APP_ID}-shorts-ban-button.${APP_ID}-shorts-ban-fixed {
          position: fixed;
          top: ${CONFIG.shortsBanButtonTopPx}px;
          right: ${CONFIG.shortsBanButtonRightPx}px;
          z-index: 2147483647;
          background: rgba(0, 0, 0, 0.74);
          box-shadow: 0 3px 16px rgba(0,0,0,.38);
        }

        [data-${APP_ID}-channel-card="1"] {
          position: relative !important;
        }
      `;
    } catch {}
  }

  function normalizeChannelPath(path) {
    return String(path || '')
      .trim()
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }

  function normalizeChannelName(name) {
    return String(name || '')
      .trim()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .replace(/\s+подтверждено\s*$/i, '')
      .toLowerCase();
  }

  function cleanChannelDisplayName(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s+Подтверждено\s*$/i, '');
  }

  function getChannelCardSelector() {
    return [
      'ytm-video-with-context-renderer',
      'ytm-compact-video-renderer',
      'ytm-rich-item-renderer',
      'ytm-video-card-renderer',
      'ytm-reel-item-renderer',
      'ytm-reel-video-renderer',
      'ytm-shorts-lockup-view-model',
      'ytm-shorts-lockup-view-model-v2',
      'ytm-shorts-lockup-view-model-v3',
      'ytm-video-renderer',
    ].join(',');
  }

  function getVideoLinkFromCard(card) {
    try {
      return card.querySelector(
        [
          'a[href*="/watch?v="]',
          'a[href^="/watch?"]',
          'a[href^="/shorts/"]',
          'a[href*="youtube.com/watch"]',
          'a[href*="youtube.com/shorts/"]',
        ].join(','),
      );
    } catch {
      return null;
    }
  }

  function getChannelInfoFromUrl(href, fallbackName = '') {
    try {
      const url = new URL(href, location.origin);
      const path = normalizeChannelPath(url.pathname);

      if (!/^\/(@|channel\/|c\/|user\/)/i.test(path)) return null;

      const parts = path.split('/').filter(Boolean);
      const first = parts[0] || '';
      const second = parts[1] || '';
      const channelId = first === 'channel' && /^UC[\w-]+/i.test(second) ? second : '';
      const handle = first.startsWith('@') ? first : '';
      const nameFromPath = decodeURIComponent(parts.join('/'));
      const displayName = cleanChannelDisplayName(fallbackName) || nameFromPath;

      return normalizeChannelInfo({
        key: channelId ? `channel:${channelId.toLowerCase()}` : `url:${path}`,
        url: path,
        channelId,
        handle,
        name: displayName,
        nameKey: normalizeChannelName(displayName),
        source: 'url',
        confidence: channelId || handle ? 'strong' : 'medium',
      });
    } catch {
      return null;
    }
  }



  function normalizeChannelId(channelId) {
    return String(channelId || '').trim();
  }

  function normalizeHandle(handle) {
    const value = String(handle || '').trim().toLowerCase();
    if (!value) return '';
    return value.startsWith('@') ? value : `@${value}`;
  }

  function getChannelAliases(info) {
    const aliases = new Set();

    try {
      if (!info) return [];

      const key = String(info.key || '').trim();
      const url = normalizeChannelPath(info.url || '');
      const channelId = normalizeChannelId(info.channelId || '');
      const handle = normalizeHandle(info.handle || '');
      const nameKey = normalizeChannelName(info.nameKey || info.name || '');

      if (key) aliases.add(key);
      if (url) aliases.add(`url:${url}`);
      if (channelId) {
        aliases.add(`channel:${channelId.toLowerCase()}`);
        aliases.add(`url:/channel/${channelId}`.toLowerCase());
      }
      if (handle) {
        aliases.add(`handle:${handle}`);
        aliases.add(`url:/${handle}`);
      }
      if (nameKey) aliases.add(`name:${nameKey}`);

      if (Array.isArray(info.keys)) {
        info.keys.forEach((item) => {
          const value = String(item || '').trim();
          if (value) aliases.add(value);
        });
      }

      if (Array.isArray(info.aliases)) {
        info.aliases.forEach((item) => {
          const value = String(item || '').trim();
          if (value) aliases.add(value);
        });
      }
    } catch {}

    return Array.from(aliases);
  }

  function normalizeChannelInfo(info) {
    if (!info) return null;

    const channelId = normalizeChannelId(info.channelId || '');
    const handle = normalizeHandle(info.handle || '');
    const url = normalizeChannelPath(info.url || (channelId ? `/channel/${channelId}` : handle ? `/${handle}` : ''));
    const name = cleanChannelDisplayName(info.name || info.title || url || channelId || handle || info.key || '');
    const nameKey = normalizeChannelName(info.nameKey || name);

    const normalized = {
      key:
        info.key ||
        (channelId ? `channel:${channelId.toLowerCase()}` : '') ||
        (handle ? `handle:${handle}` : '') ||
        (url ? `url:${url}` : '') ||
        (nameKey ? `name:${nameKey}` : ''),
      url,
      channelId,
      handle,
      name,
      nameKey,
      source: info.source || '',
      confidence: info.confidence || (channelId || handle || url ? 'strong' : 'weak'),
    };

    normalized.aliases = getChannelAliases(normalized);

    return normalized;
  }

  function isStrongChannelInfo(info) {
    const normalized = normalizeChannelInfo(info);
    if (!normalized) return false;

    return Boolean(
      normalized.channelId ||
        normalized.handle ||
        /^\/(@|channel\/|c\/|user\/)/i.test(normalized.url || '') ||
        String(normalized.key || '').startsWith('channel:') ||
        String(normalized.key || '').startsWith('handle:') ||
        String(normalized.key || '').startsWith('url:/@') ||
        String(normalized.key || '').startsWith('url:/channel/'),
    );
  }

  function extractChannelInfoFromPlayerResponse(videoId = '') {
    try {
      const responses = [
        window.ytInitialPlayerResponse,
        window.playerResponse,
      ].filter(Boolean);

      for (const response of responses) {
        const details = response?.videoDetails || {};
        const micro = response?.microformat?.playerMicroformatRenderer || {};

        if (videoId && details.videoId && details.videoId !== videoId) continue;

        const channelId =
          normalizeChannelId(details.channelId || micro.externalChannelId || micro.ownerChannelId || '');
        const ownerUrl =
          micro.ownerProfileUrl ||
          micro.ownerProfileUrlPath ||
          '';
        const name =
          cleanChannelDisplayName(details.author || micro.ownerChannelName || textFromRunsLike(micro.ownerText) || '');

        if (channelId) {
          return normalizeChannelInfo({
            key: `channel:${channelId.toLowerCase()}`,
            url: `/channel/${channelId}`,
            channelId,
            name: name || channelId,
            nameKey: normalizeChannelName(name || channelId),
            source: 'ytInitialPlayerResponse',
            confidence: 'strong',
          });
        }

        if (ownerUrl) {
          const info = getChannelInfoFromUrl(ownerUrl, name);
          if (info) {
            info.source = 'ytInitialPlayerResponse.ownerProfileUrl';
            info.confidence = 'strong';
            info.aliases = getChannelAliases(info);
            return info;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }



  function getVideoIdFromHref(href) {
    try {
      const url = new URL(href || '', location.origin);

      const watchId = url.searchParams.get('v');
      if (isValidVideoId(watchId)) return watchId;

      const shortsMatch = url.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch && isValidVideoId(shortsMatch[1])) return shortsMatch[1];

      const sourceMatch = url.pathname.match(/^\/source\/([^/?#]+)\/shorts/);
      if (sourceMatch && isValidVideoId(sourceMatch[1])) return sourceMatch[1];

      return '';
    } catch {
      return '';
    }
  }

  function getVideoIdFromCard(card) {
    try {
      const link = getVideoLinkFromCard(card);
      return getVideoIdFromHref(link?.getAttribute('href') || link?.href || '');
    } catch {
      return '';
    }
  }

  function textFromRunsLike(value) {
    try {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value.simpleText === 'string') return value.simpleText;
      if (value.accessibility?.accessibilityData?.label) return value.accessibility.accessibilityData.label;

      if (Array.isArray(value.runs)) {
        return value.runs
          .map((run) => run?.text || '')
          .join('')
          .trim();
      }

      if (Array.isArray(value)) {
        return value.map((item) => textFromRunsLike(item)).filter(Boolean).join(' ').trim();
      }

      return '';
    } catch {
      return '';
    }
  }

  function getChannelInfoFromBrowseEndpoint(endpoint, fallbackName = '') {
    try {
      const browse = endpoint?.browseEndpoint || endpoint?.commandMetadata?.webCommandMetadata;
      const browseEndpoint = endpoint?.browseEndpoint || endpoint?.navigationEndpoint?.browseEndpoint || endpoint;

      const canonical =
        browseEndpoint?.canonicalBaseUrl ||
        endpoint?.canonicalBaseUrl ||
        '';

      const browseId =
        browseEndpoint?.browseId ||
        endpoint?.browseId ||
        '';

      if (canonical && /^\/(@|channel\/|c\/|user\/)/i.test(canonical)) {
        return getChannelInfoFromUrl(canonical, fallbackName);
      }

      if (browseId && /^UC[\w-]+/i.test(browseId)) {
        const url = `/channel/${browseId}`;
        const displayName = cleanChannelDisplayName(fallbackName) || browseId;

        return normalizeChannelInfo({
          key: `channel:${browseId.toLowerCase()}`,
          url,
          channelId: browseId,
          name: displayName,
          nameKey: normalizeChannelName(displayName),
          source: 'browseEndpoint',
          confidence: 'strong',
        });
      }

      if (browse?.url && /^\/(@|channel\/|c\/|user\/)/i.test(browse.url)) {
        return getChannelInfoFromUrl(browse.url, fallbackName);
      }

      return null;
    } catch {
      return null;
    }
  }

  function findChannelInfoNearObject(root, targetVideoId = '') {
    const seen = new WeakSet();
    const queue = [{ value: root, depth: 0 }];
    const maxNodes = 5000;
    let visited = 0;
    let firstChannel = null;

    while (queue.length && visited < maxNodes) {
      const { value, depth } = queue.shift();
      visited += 1;

      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value);

      const maybeName =
        textFromRunsLike(value.shortBylineText) ||
        textFromRunsLike(value.longBylineText) ||
        textFromRunsLike(value.ownerText) ||
        textFromRunsLike(value.shortByline) ||
        textFromRunsLike(value.bylineText) ||
        textFromRunsLike(value.channelName) ||
        textFromRunsLike(value.author);

      const endpointCandidates = [
        value.navigationEndpoint,
        value.command,
        value.endpoint,
        value.browseEndpoint,
        value.shortBylineText?.runs?.[0]?.navigationEndpoint,
        value.longBylineText?.runs?.[0]?.navigationEndpoint,
        value.ownerText?.runs?.[0]?.navigationEndpoint,
      ].filter(Boolean);

      for (const endpoint of endpointCandidates) {
        const info = getChannelInfoFromBrowseEndpoint(endpoint, maybeName);
        if (info && !firstChannel) firstChannel = info;

        if (info && (!targetVideoId || value.videoId === targetVideoId || JSON.stringify(value).includes(targetVideoId))) {
          return info;
        }
      }

      if (targetVideoId && value.videoId === targetVideoId && firstChannel) {
        return firstChannel;
      }

      if (depth < 8) {
        for (const key of Object.keys(value)) {
          const child = value[key];

          if (!child || typeof child !== 'object') continue;
          queue.push({ value: child, depth: depth + 1 });
        }
      }
    }

    return targetVideoId ? null : firstChannel;
  }

  function extractChannelInfoFromInitialData(videoId = '') {
    try {
      const fromPlayer = extractChannelInfoFromPlayerResponse(videoId);
      if (fromPlayer) return fromPlayer;

      const data = window.ytInitialData;
      if (!data) return null;

      return findChannelInfoNearObject(data, videoId) || null;
    } catch {
      return null;
    }
  }

  function getCurrentShortsRoot() {
    try {
      const selectors = [
        'ytm-shorts-player',
        'ytm-reel-video-renderer[is-active]',
        'ytm-reel-video-renderer[aria-hidden="false"]',
        'ytm-shorts-video-view-model[is-active]',
        'ytm-reel-player-overlay-renderer',
        'reel-player-overlay-renderer',
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) return el;
      }

      return document.body || document.documentElement;
    } catch {
      return document.body || document.documentElement;
    }
  }


  function getShortsIdentityDecision(parts = getCurrentShortsVideoIdParts(), reason = 'decision') {
    const now = Date.now();

    if (!CONFIG.shortsIdentityRaceGuardEnabled || !isShortsPage()) {
      state.lastShortsIdentityStatus = {
        reason,
        status: 'disabled-or-not-shorts',
        parts,
        delayMs: 0,
        at: new Date().toISOString(),
      };

      return state.lastShortsIdentityStatus;
    }

    if (!parts.hasMismatch) {
      state.shortsIdentityMismatchSinceMs = 0;
      state.shortsIdentityDeferredAttempts = 0;
      state.lastShortsIdentityStatus = {
        reason,
        status: 'stable',
        parts,
        delayMs: 0,
        at: new Date().toISOString(),
      };

      return state.lastShortsIdentityStatus;
    }

    if (!state.shortsIdentityMismatchSinceMs) {
      state.shortsIdentityMismatchSinceMs = now;
      state.shortsIdentityDeferredAttempts = 0;
    }

    const mismatchAgeMs = now - state.shortsIdentityMismatchSinceMs;
    const shouldDelay =
      mismatchAgeMs < CONFIG.shortsIdentityMismatchGraceMs &&
      state.shortsIdentityDeferredAttempts < CONFIG.shortsIdentityMaxDeferredAttempts;

    if (shouldDelay) {
      state.shortsIdentityDeferredAttempts += 1;
    }

    state.lastShortsIdentityStatus = {
      reason,
      status: shouldDelay ? 'wait-mismatch' : 'proceed-ignore-player',
      parts,
      mismatchAgeMs,
      deferredAttempts: state.shortsIdentityDeferredAttempts,
      delayMs: shouldDelay ? CONFIG.shortsIdentityRaceDelayMs : 0,
      at: new Date().toISOString(),
    };

    return state.lastShortsIdentityStatus;
  }

  function isPlayerResponseSafeForShorts(parts = getCurrentShortsVideoIdParts()) {
    if (!parts.hasMismatch) return true;

    /*
      Если DOM/URL говорит одно, а playerResponse другое, playerResponse старый.
      Его нельзя использовать для канала, иначе какашка отправит в канализацию
      не того автора. Было бы смешно, если бы не было так похоже на продуктовую аналитику.
    */
    return false;
  }


  function extractCurrentShortsChannelInfo() {
    try {
      const root = getCurrentShortsRoot();
      const parts = getCurrentShortsVideoIdParts(root);
      const videoId = parts.chosen;

      /*
        `/shorts/<id>`: playerResponse обычно самый надёжный.
        `/shorts/`: URL без id, поэтому сначала пробуем активный DOM,
        чтобы не забанить канал предыдущего ролика из старого playerResponse.
      */
      const fromDom = extractChannelInfo(root);

      if (!videoId && fromDom && isStrongChannelInfo(fromDom)) {
        return fromDom;
      }

      if (isPlayerResponseSafeForShorts(parts)) {
        const fromPlayer = extractChannelInfoFromPlayerResponse(videoId);
        if (fromPlayer) return fromPlayer;
      }

      const fromData = extractChannelInfoFromInitialData(videoId);
      if (fromData) return fromData;

      if (fromDom) return fromDom;

      /*
        Документ целиком используем последним вариантом, потому что там могут лежать
        ссылки на соседние Shorts, меню, рекомендации и прочий DOM-иллюзионизм.
      */
      const fromDocument = extractChannelInfo(document);
      if (fromDocument) return fromDocument;

      return null;
    } catch {
      return null;
    }
  }


  function extractChannelInfo(card) {
    if (!card) return null;

    try {
      const channelLinks = Array.from(card.querySelectorAll?.('a[href]') || []).filter((link) => {
        const href = link.getAttribute('href') || '';
        return (
          /^\/(@|channel\/|c\/|user\/)/i.test(href) ||
          /youtube\.com\/(@|channel\/|c\/|user\/)/i.test(href)
        );
      });

      for (const link of channelLinks) {
        const label =
          link.getAttribute('aria-label') ||
          link.textContent ||
          link.querySelector?.('[role="text"]')?.textContent ||
          '';

        const info = getChannelInfoFromUrl(link.getAttribute('href') || link.href || '', label);
        if (info) return info;
      }

      /*
        На source/shorts и похожих лентах ссылка на канал может отсутствовать
        в видимом DOM, зато может лежать в ytInitialData рядом с videoId.
      */
      const videoId = getVideoIdFromCard(card);
      const fromData = extractChannelInfoFromInitialData(videoId);
      if (fromData) return fromData;

      /*
        Fallback по тексту. Ненадёжный, но лучше, чем смотреть на мусор руками.
      */
      const textSelectors = [
        '[class*="byline"]',
        '[class*="channel"]',
        '[class*="owner"]',
        '[class*="author"]',
        'ytm-badge-and-byline-renderer',
        'ytm-shorts-lockup-view-model',
        'ytm-reel-player-overlay-renderer',
        '.subhead',
        '.metadata',
        '.secondary-text',
      ];

      for (const selector of textSelectors) {
        const el = card.querySelector?.(selector);
        const raw = cleanChannelDisplayName(el?.textContent || el?.getAttribute?.('aria-label') || '');

        if (!raw) continue;

        const parts = raw
          .split(/[•·\n]/)
          .map((part) => cleanChannelDisplayName(part))
          .filter(Boolean);

        const candidate = parts.find((part) => {
          const lower = part.toLowerCase();
          return (
            part.length >= 2 &&
            !lower.includes('просмотр') &&
            !lower.includes('views') &&
            !lower.includes('назад') &&
            !lower.includes('ago') &&
            !lower.includes('shorts') &&
            !lower.includes('комментар') &&
            !lower.includes('поделиться') &&
            !lower.includes('подпис') &&
            !lower.includes('like') &&
            !lower.includes('share')
          );
        });

        if (candidate) {
          const key = normalizeChannelName(candidate);

          return normalizeChannelInfo({
            key: `name:${key}`,
            url: '',
            name: candidate,
            nameKey: key,
            source: 'text-fallback',
            confidence: 'weak',
          });
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  function readBannedChannels() {
    try {
      const raw = localStorage.getItem(CONFIG.channelBanStorageKey);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter((item) => item && item.key);
    } catch {
      return [];
    }
  }

  function writeBannedChannels(items) {
    try {
      localStorage.setItem(CONFIG.channelBanStorageKey, JSON.stringify(items || []));
    } catch {}
  }

  function getBannedChannelMap() {
    const items = readBannedChannels();
    const map = new Map();

    for (const rawItem of items) {
      const item = normalizeChannelInfo(rawItem) || rawItem;

      getChannelAliases(item).forEach((alias) => {
        map.set(alias, item);
      });
    }

    return map;
  }

  function isChannelBanned(info, map = getBannedChannelMap()) {
    const normalized = normalizeChannelInfo(info);
    if (!normalized) return false;

    return getChannelAliases(normalized).some((alias) => map.has(alias));
  }


  function getChannelBanCheck(info) {
    const normalized = normalizeChannelInfo(info);
    const map = getBannedChannelMap();

    if (!normalized) {
      return {
        banned: false,
        info: null,
        aliases: [],
        matchedAliases: [],
        matchedItem: null,
      };
    }

    const aliases = getChannelAliases(normalized);
    const matchedAliases = aliases.filter((alias) => map.has(alias));
    const matchedItem = matchedAliases.length ? map.get(matchedAliases[0]) : null;

    return {
      banned: matchedAliases.length > 0,
      info: normalized,
      aliases,
      matchedAliases,
      matchedItem: matchedItem || null,
    };
  }

  function recordPoopAction(info, meta = {}, didBan = false) {
    const check = getChannelBanCheck(info);

    state.lastPoopActionResult = {
      ok: Boolean(didBan && check.banned),
      didBan: Boolean(didBan),
      banConfirmed: Boolean(check.banned),
      videoId: meta.videoId || getCurrentShortsVideoId(),
      channel: check.info || normalizeChannelInfo(info),
      aliases: check.aliases || [],
      matchedAliases: check.matchedAliases || [],
      matchedItem: check.matchedItem || null,
      identity: meta.identity || getCurrentShortsVideoIdParts(),
      identityDecision: meta.identityDecision || state.lastShortsIdentityStatus,
      feedback: state.lastNegativeFeedbackResult,
      at: new Date().toISOString(),
    };

    if (CONFIG.channelBanVerifyAfterClick && didBan) {
      if (check.banned) {
        log('poop ban confirmed', state.lastPoopActionResult);
      } else {
        toast(`${APP_SHORT}: ЧС не подтвердился`, 1300);
        log('poop ban NOT confirmed', state.lastPoopActionResult);
      }
    }

    return state.lastPoopActionResult;
  }

  window.cuLastPoop = function cuLastPoop() {
    return state.lastPoopActionResult;
  };

  window.cuVerifyCurrentShortsBlacklist = function cuVerifyCurrentShortsBlacklist() {
    const info = extractCurrentShortsChannelInfo();
    const check = getChannelBanCheck(info);

    return {
      currentVideoId: getCurrentShortsVideoId(),
      currentChannel: normalizeChannelInfo(info),
      check,
      lastPoop: state.lastPoopActionResult,
      lastBlockedShortsResult: state.lastBlockedShortsResult,
      banned: readBannedChannels(),
    };
  };


  function banChannel(info, meta = {}) {
    if (!CONFIG.channelFilterEnabled || !info) return false;

    const normalized = normalizeChannelInfo(info);
    if (!normalized || !normalized.key) return false;

    if (CONFIG.shortsRequireStrongChannelForBan && !isStrongChannelInfo(normalized)) {
      toast(`${APP_SHORT}: канал определён неточно`, 1200);
      return false;
    }

    const items = readBannedChannels();
    const map = getBannedChannelMap();

    if (isChannelBanned(normalized, map)) {
      toast(`${APP_SHORT}: канал уже в ЧС`, 950);

      if (meta.videoId) {
        const existing = map.get(getChannelAliases(normalized).find((alias) => map.has(alias)));
        if (existing) {
          existing.videoIds = Array.from(new Set([...(existing.videoIds || []), meta.videoId]));
          writeBannedChannels(items);
        }
      }

      return true;
    }

    const item = {
      key: normalized.key,
      keys: getChannelAliases(normalized),
      aliases: getChannelAliases(normalized),
      name: normalized.name || normalized.url || normalized.key,
      nameKey: normalized.nameKey || normalizeChannelName(normalized.name),
      url: normalized.url || '',
      channelId: normalized.channelId || '',
      handle: normalized.handle || '',
      source: normalized.source || meta.source || '',
      confidence: normalized.confidence || '',
      videoIds: meta.videoId ? [meta.videoId] : [],
      bannedAt: new Date().toISOString(),
    };

    items.push(item);
    writeBannedChannels(items);

    state.lastBannedShortsVideoId = meta.videoId || '';
    state.lastBannedShortsChannelKey = item.key || '';

    toast(`${APP_SHORT}: канал в ЧС: ${item.name}`, 1300);
    scheduleChannelFilter('ban');

    if (meta.source === 'shorts-button') {
      scheduleBlockedShortsCheck('after-ban', CONFIG.shortsSkipBannedAfterBanDelayMs);
    }

    return true;
  }

  function unbanChannel(query) {
    const needle = normalizeChannelName(query);
    const pathNeedle = normalizeChannelPath(query);
    const normalizedQuery = String(query || '').trim();
    const before = readBannedChannels();

    const after = before.filter((rawItem) => {
      const item = normalizeChannelInfo(rawItem) || rawItem;
      const aliases = getChannelAliases(item);

      return !(
        item.key === normalizedQuery ||
        aliases.includes(normalizedQuery) ||
        aliases.includes(`name:${needle}`) ||
        aliases.includes(`url:${pathNeedle}`) ||
        normalizeChannelName(item.name) === needle ||
        item.nameKey === needle ||
        normalizeChannelPath(item.url) === pathNeedle ||
        String(item.channelId || '').toLowerCase() === normalizedQuery.toLowerCase().replace(/^channel:/, '')
      );
    });

    writeBannedChannels(after);
    scheduleChannelFilter('unban');
    scheduleBlockedShortsCheck('unban');

    return {
      removed: before.length - after.length,
      items: after,
    };
  }

  function clearBannedChannels() {
    writeBannedChannels([]);
    scheduleChannelFilter('clear');
    return [];
  }


  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeUiText(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ');
  }

  function getElementUiText(el) {
    try {
      if (!el) return '';

      return [
        el.getAttribute?.('aria-label'),
        el.getAttribute?.('title'),
        el.getAttribute?.('data-tooltip-text'),
        el.textContent,
      ]
        .filter(Boolean)
        .join(' ');
    } catch {
      return '';
    }
  }

  function isElementVisible(el) {
    try {
      if (!el || !el.getBoundingClientRect) return false;

      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return false;
      if (rect.bottom < 0 || rect.right < 0) return false;
      if (rect.top > (window.innerHeight || 0)) return false;
      if (rect.left > (window.innerWidth || 0)) return false;

      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
    } catch {
      return false;
    }
  }

  function getClickableElement(el) {
    try {
      return (
        el.closest?.('button, [role="button"], [role="menuitem"], ytm-menu-service-item-renderer, tp-yt-paper-item, a[href]') ||
        el
      );
    } catch {
      return el;
    }
  }

  function safeClickElement(el, reason = 'click') {
    try {
      const target = getClickableElement(el);
      if (!target || !isElementVisible(target)) return false;

      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch' }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      target.click();

      log('safe click', reason, getElementUiText(target));
      return true;
    } catch {
      try {
        el.click();
        return true;
      } catch {
        return false;
      }
    }
  }

  function findVisibleClickableByText(root, includeTerms, excludeTerms = [], options = {}) {
    try {
      const scope = root || document;
      const include = includeTerms.map(normalizeUiText).filter(Boolean);
      const exclude = excludeTerms.map(normalizeUiText).filter(Boolean);

      const nodes = Array.from(
        scope.querySelectorAll?.(
          [
            'button',
            '[role="button"]',
            '[role="menuitem"]',
            'ytm-menu-service-item-renderer',
            'tp-yt-paper-item',
            'a[aria-label]',
            '[aria-label]',
            '[title]',
          ].join(','),
        ) || [],
      );

      const candidates = [];

      for (const node of nodes) {
        const clickable = getClickableElement(node);
        if (!clickable || !isElementVisible(clickable)) continue;

        const text = normalizeUiText(getElementUiText(node) || getElementUiText(clickable));
        if (!text) continue;
        if (!include.some((term) => text.includes(term))) continue;
        if (exclude.some((term) => text.includes(term))) continue;

        const rect = clickable.getBoundingClientRect();
        let score = 0;

        if (options.preferRightRail && rect.left > (window.innerWidth || 0) * 0.45) score += 10;
        if (options.preferTop && rect.top < (window.innerHeight || 0) * 0.55) score += 3;
        if (options.preferBottom && rect.top > (window.innerHeight || 0) * 0.45) score += 3;

        score -= Math.abs(rect.left - (window.innerWidth || 0) * 0.82) / 100;
        score -= Math.abs(rect.top - (window.innerHeight || 0) * 0.55) / 140;

        candidates.push({ node: clickable, text, score });
      }

      candidates.sort((a, b) => b.score - a.score);
      return candidates[0]?.node || null;
    } catch {
      return null;
    }
  }

  function isToggleAlreadyPressed(el) {
    try {
      const target = getClickableElement(el);
      const text = normalizeUiText(getElementUiText(target));

      return (
        target?.getAttribute?.('aria-pressed') === 'true' ||
        target?.getAttribute?.('aria-checked') === 'true' ||
        text.includes('отменить отметку') ||
        text.includes('убрать отметку') ||
        text.includes('remove dislike') ||
        text.includes('undo dislike')
      );
    } catch {
      return false;
    }
  }

  function findShortsDislikeButton() {
    const root = getCurrentShortsRoot();

    const include = [
      'не нравится',
      'dislike',
    ];

    const exclude = [
      'не интересно',
      'not interested',
      'отменить отметку',
      'remove dislike',
      'комментар',
      'comment',
      'поделиться',
      'share',
      'жалоба',
      'report',
    ];

    return (
      findVisibleClickableByText(root, include, exclude, { preferRightRail: true }) ||
      findVisibleClickableByText(document, include, exclude, { preferRightRail: true })
    );
  }

  function clickShortsDislike() {
    if (!CONFIG.negativeFeedbackDislikeShorts) return 'disabled';

    try {
      const button = findShortsDislikeButton();

      if (!button) return 'not-found';
      if (isToggleAlreadyPressed(button)) return 'already';

      return safeClickElement(button, 'shorts-dislike') ? 'clicked' : 'failed';
    } catch {
      return 'failed';
    }
  }

  function findShortsMoreButton() {
    const root = getCurrentShortsRoot();

    const include = [
      'еще',
      'ещё',
      'другие действия',
      'more',
      'more actions',
    ];

    const exclude = [
      'поделиться',
      'share',
      'комментар',
      'comment',
      'поиск',
      'search',
      'создать',
      'create',
      'голосовой',
      'voice',
    ];

    return (
      findVisibleClickableByText(root, include, exclude, { preferRightRail: true, preferBottom: true }) ||
      findVisibleClickableByText(document, include, exclude, { preferRightRail: true, preferBottom: true })
    );
  }

  function findMenuFeedbackItem() {
    const terms = CONFIG.negativeFeedbackPreferDontRecommendChannel
      ? [
          [
            'не рекомендовать видео с этого канала',
            'не рекомендовать канал',
            'не рекомендовать видео этого канала',
            'dont recommend channel',
            "don't recommend channel",
            "don't recommend videos from this channel",
          ],
          ['не интересно', 'не интересует', 'not interested'],
        ]
      : [
          ['не интересно', 'не интересует', 'not interested'],
          [
            'не рекомендовать видео с этого канала',
            'не рекомендовать канал',
            'не рекомендовать видео этого канала',
            'dont recommend channel',
            "don't recommend channel",
            "don't recommend videos from this channel",
          ],
        ];

    const exclude = [
      'отменить',
      'undo',
      'отмена',
      'cancel',
      'пожаловаться',
      'report',
      'отправить отзыв',
      'send feedback',
    ];

    for (const group of terms) {
      const item = findVisibleClickableByText(document, group, exclude, {});
      if (item) return item;
    }

    return null;
  }


  function getOpenYouTubeBottomSheet() {
    try {
      return (
        document.querySelector('.ytSpecBottomSheetLayoutHost') ||
        document.querySelector('[class*="BottomSheetLayoutHost"]') ||
        document.querySelector('ytm-bottom-sheet-renderer') ||
        document.querySelector('[role="dialog"]')
      );
    } catch {
      return null;
    }
  }

  function closeYouTubeBottomSheet(reason = 'close') {
    try {
      const sheet = getOpenYouTubeBottomSheet();
      if (!sheet) return false;

      const closeButton = findVisibleClickableByText(
        sheet,
        ['закрыть', 'close', 'назад', 'back'],
        ['отзыв', 'feedback'],
        {},
      );

      if (closeButton && safeClickElement(closeButton, `bottom-sheet-${reason}`)) {
        return true;
      }

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));

      return true;
    } catch {
      return false;
    }
  }

  function isWrongShortsSettingsMenuOpen() {
    try {
      const sheet = getOpenYouTubeBottomSheet();
      if (!sheet) return false;

      const text = normalizeUiText(getElementUiText(sheet));

      const hasSettingsStuff =
        text.includes('описание') ||
        text.includes('субтитры') ||
        text.includes('звуковая дорожка') ||
        text.includes('добавить в плейлист') ||
        text.includes('открыть в приложении') ||
        text.includes('description') ||
        text.includes('captions') ||
        text.includes('audio track') ||
        text.includes('open in app');

      const hasUsefulFeedback =
        text.includes('не интересно') ||
        text.includes('не интересует') ||
        text.includes('не рекомендовать') ||
        text.includes('not interested') ||
        text.includes('dont recommend') ||
        text.includes("don't recommend");

      return hasSettingsStuff && !hasUsefulFeedback;
    } catch {
      return false;
    }
  }


  async function clickShortsMenuFeedback() {
    if (!CONFIG.negativeFeedbackUseMenu) return 'disabled';

    try {
      const more = findShortsMoreButton();
      if (!more) return 'menu-not-found';

      if (!safeClickElement(more, 'shorts-menu')) return 'menu-click-failed';

      await sleep(CONFIG.negativeFeedbackMenuOpenDelayMs);

      const item = findMenuFeedbackItem();

      if (!item) {
        if (CONFIG.negativeFeedbackCloseWrongMenu && isWrongShortsSettingsMenuOpen()) {
          closeYouTubeBottomSheet('wrong-menu');
          return 'wrong-menu-closed';
        }

        return 'feedback-item-not-found';
      }

      const text = normalizeUiText(getElementUiText(item));
      await sleep(CONFIG.negativeFeedbackMenuClickDelayMs);

      if (!safeClickElement(item, 'shorts-menu-feedback')) return 'feedback-click-failed';

      if (text.includes('не рекомендовать') || text.includes('dont recommend') || text.includes("don't recommend")) {
        return 'dont-recommend-channel';
      }

      if (text.includes('не интересно') || text.includes('не интересует') || text.includes('not interested')) {
        return 'not-interested';
      }

      return 'clicked';
    } catch {
      return 'failed';
    }
  }

  function buildNegativeFeedbackToast(result) {
    const parts = [];

    if (result.dislike === 'clicked') parts.push('👎');
    if (result.dislike === 'already') parts.push('👎 уже');

    if (result.menu === 'dont-recommend-channel') parts.push('не рекомендовать');
    if (result.menu === 'not-interested') parts.push('не интересно');

    if (!parts.length) {
      if (result.dislike === 'not-found' && (result.menu === 'menu-not-found' || result.menu === 'disabled')) {
        return `${APP_SHORT}: канал скрыт, 👎 не найден`;
      }

      if (result.menu === 'disabled') {
        return `${APP_SHORT}: канал скрыт + меню не трогаем`;
      }

      if (result.menu === 'wrong-menu-closed') {
        return `${APP_SHORT}: канал скрыт, меню настроек закрыто`;
      }

      return `${APP_SHORT}: канал скрыт локально`;
    }

    return `${APP_SHORT}: ${parts.join(' + ')}`;
  }

  async function sendShortsNegativeFeedback(info, reason = 'shorts', options = {}) {
    if (!CONFIG.negativeFeedbackEnabled || !CONFIG.negativeFeedbackOnShortsBan) return null;

    const now = Date.now();
    if (now < state.negativeFeedbackBusyUntilMs) {
      return state.lastNegativeFeedbackResult || null;
    }

    state.negativeFeedbackBusyUntilMs = now + CONFIG.negativeFeedbackBusyMs;

    const result = {
      reason,
      type: 'shorts',
      channel: info?.name || info?.url || '',
      videoId: options.videoId || getCurrentShortsVideoId(),
      dislike: 'skipped',
      menu: 'skipped',
      at: new Date().toISOString(),
    };

    try {
      result.dislike = clickShortsDislike();

      if (CONFIG.negativeFeedbackUseMenu) {
        result.menu = await clickShortsMenuFeedback();
      }

      state.lastNegativeFeedbackResult = result;

      if (CONFIG.showToasts) {
        toast(buildNegativeFeedbackToast(result), CONFIG.negativeFeedbackToastMs);
      }

      log('negative feedback result', result);
      return result;
    } catch (error) {
      result.error = String(error && error.message ? error.message : error);
      state.lastNegativeFeedbackResult = result;
      log('negative feedback failed', result);
      return result;
    }
  }


  function shouldRunCardFeedback(card = null, reason = 'card') {
    if (!CONFIG.cardFeedbackEnabled || !CONFIG.negativeFeedbackEnabled) return false;

    if (Date.now() < state.cardFeedbackBusyUntilMs) return false;

    if (CONFIG.cardFeedbackOnlyHomeSafeMode && !isHomeSafeModePage()) return false;

    if (reason.includes('home') || isHomeSafeModePage()) return true;

    return Boolean(CONFIG.negativeFeedbackOnCardBan);
  }

  function findCardMenuButton(card) {
    try {
      if (!card) return null;

      const nodes = Array.from(
        card.querySelectorAll?.(
          [
            'button',
            '[role="button"]',
            'yt-icon-button',
            'c3-icon-button',
            '[aria-label]',
            '[title]',
          ].join(','),
        ) || [],
      );

      const candidates = [];

      for (const node of nodes) {
        const clickable = getClickableElement(node);
        if (!clickable || !isElementVisible(clickable)) continue;

        const tag = String(clickable.tagName || '').toLowerCase();
        const href = clickable.getAttribute?.('href') || clickable.href || '';

        if (tag === 'a' && /\/(watch|shorts|channel\/|@|c\/|user\/)/.test(href)) continue;

        const text = normalizeUiText(getElementUiText(node) || getElementUiText(clickable));
        const aria = normalizeUiText(
          [
            node.getAttribute?.('aria-label'),
            clickable.getAttribute?.('aria-label'),
            node.getAttribute?.('title'),
            clickable.getAttribute?.('title'),
          ].filter(Boolean).join(' '),
        );

        const classText = normalizeUiText(
          [
            node.className,
            clickable.className,
            node.parentElement?.className,
            clickable.parentElement?.className,
          ].map((value) => String(value || '')).join(' '),
        );

        const all = `${text} ${aria} ${classText}`;

        let score = 0;

        if (all.includes('ещё')) score += 70;
        if (all.includes('еще')) score += 70;
        if (all.includes('more')) score += 70;
        if (all.includes('действ')) score += 55;
        if (all.includes('меню')) score += 55;
        if (all.includes('menu')) score += 55;
        if (all.includes('overflow')) score += 45;
        if (all.includes('options')) score += 45;
        if (all.includes('kebab')) score += 35;
        if (clickable.getAttribute?.('aria-haspopup') === 'true') score += 35;
        if (clickable.closest?.('[class*="menu"], [class*="Menu"], ytm-menu, ytm-menu-renderer')) score += 35;

        const rect = clickable.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();

        if (rect.width <= 56 && rect.height <= 56) score += 8;
        if (rect.left > cardRect.left + cardRect.width * 0.55) score += 12;
        if (rect.top < cardRect.top + cardRect.height * 0.55) score += 8;

        const excluded =
          all.includes('поделиться') ||
          all.includes('share') ||
          all.includes('комментар') ||
          all.includes('comment') ||
          all.includes('нравится') ||
          all.includes('like') ||
          all.includes('воспроизвести') ||
          all.includes('play') ||
          all.includes('смотреть') ||
          all.includes('watch');

        if (excluded) score -= 120;

        if (score > 40) {
          candidates.push({ el: clickable, score, text: all });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      return candidates[0]?.el || null;
    } catch {
      return null;
    }
  }

  function getOpenYouTubeMenuSurface() {
    try {
      return (
        getOpenYouTubeBottomSheet() ||
        document.querySelector('ytm-menu-popup-renderer') ||
        document.querySelector('tp-yt-iron-dropdown') ||
        document.querySelector('ytd-popup-container') ||
        document.querySelector('[role="menu"]') ||
        document.querySelector('[role="dialog"]')
      );
    } catch {
      return null;
    }
  }

  function isWrongCardMenuOpen() {
    try {
      const surface = getOpenYouTubeMenuSurface();
      if (!surface) return false;

      const text = normalizeUiText(getElementUiText(surface));

      const hasUsefulFeedback =
        text.includes('не интересно') ||
        text.includes('не интересует') ||
        text.includes('не рекомендовать') ||
        text.includes('not interested') ||
        text.includes('dont recommend') ||
        text.includes("don't recommend");

      if (hasUsefulFeedback) return false;

      const looksLikeMenu =
        text.includes('сохранить') ||
        text.includes('добавить') ||
        text.includes('плейлист') ||
        text.includes('поделиться') ||
        text.includes('пожаловаться') ||
        text.includes('описание') ||
        text.includes('субтитры') ||
        text.includes('save') ||
        text.includes('playlist') ||
        text.includes('share') ||
        text.includes('report') ||
        text.includes('description') ||
        text.includes('captions');

      return looksLikeMenu;
    } catch {
      return false;
    }
  }

  function closeCardMenu(reason = 'card-menu') {
    try {
      if (closeYouTubeBottomSheet(reason)) return true;

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));

      return true;
    } catch {
      return false;
    }
  }

  async function clickCardMenuFeedback(card, info, reason = 'card') {
    if (!shouldRunCardFeedback(card, reason)) {
      return {
        status: 'disabled',
        reason,
        at: new Date().toISOString(),
      };
    }

    state.cardFeedbackBusyUntilMs = Date.now() + CONFIG.cardFeedbackCooldownMs;

    const result = {
      reason,
      type: 'card',
      channel: info?.name || info?.url || '',
      videoId: getVideoIdFromCard(card),
      menu: '',
      clickedText: '',
      at: new Date().toISOString(),
    };

    try {
      const menuButton = findCardMenuButton(card);

      if (!menuButton) {
        result.status = 'menu-not-found';
        return result;
      }

      if (!safeClickElement(menuButton, 'card-menu')) {
        result.status = 'menu-click-failed';
        return result;
      }

      await sleep(CONFIG.cardFeedbackOpenMenuDelayMs);

      const item = findMenuFeedbackItem();

      if (!item) {
        if (CONFIG.cardFeedbackCloseWrongMenu && isWrongCardMenuOpen()) {
          closeCardMenu('wrong-card-menu');
          result.status = 'wrong-menu-closed';
          return result;
        }

        result.status = 'feedback-item-not-found';
        closeCardMenu('no-card-feedback-item');
        return result;
      }

      const text = normalizeUiText(getElementUiText(item));
      result.clickedText = text;

      await sleep(CONFIG.cardFeedbackClickDelayMs);

      if (!safeClickElement(item, 'card-menu-feedback')) {
        result.status = 'feedback-click-failed';
        closeCardMenu('card-feedback-click-failed');
        return result;
      }

      if (text.includes('не рекомендовать') || text.includes('dont recommend') || text.includes("don't recommend")) {
        result.status = 'dont-recommend-channel';
      } else if (text.includes('не интересно') || text.includes('не интересует') || text.includes('not interested')) {
        result.status = 'not-interested';
      } else {
        result.status = 'clicked';
      }

      setTimeout(() => closeCardMenu('after-card-feedback'), CONFIG.cardFeedbackCloseDelayMs);

      return result;
    } catch (error) {
      result.status = 'error';
      result.error = String(error && error.message ? error.message : error);
      closeCardMenu('card-feedback-error');
      return result;
    }
  }


  async function sendCardNegativeFeedback(card, info, reason = 'card') {
    if (!CONFIG.negativeFeedbackEnabled) return null;

    const result = await clickCardMenuFeedback(card, info, reason);

    state.lastCardFeedbackResult = result;
    state.lastNegativeFeedbackResult = result;

    const good =
      result &&
      (
        result.status === 'dont-recommend-channel' ||
        result.status === 'not-interested' ||
        result.status === 'clicked'
      );

    if (good) {
      toast(`${APP_SHORT}: сигнал YouTube отправлен`, CONFIG.negativeFeedbackToastMs);
    } else if (result && result.status === 'wrong-menu-closed') {
      toast(`${APP_SHORT}: не то меню, закрыто`, 850);
    } else if (result && result.status !== 'disabled') {
      log('card feedback skipped', result);
    }

    return result;
  }

  window.cuLastFeedback = function cuLastFeedback() {
    return state.lastNegativeFeedbackResult;
  };

  window.cuFeedbackCurrentShorts = function cuFeedbackCurrentShorts() {
    const info = extractCurrentShortsChannelInfo();
    if (!info) {
      const result = {
        type: 'shorts',
        status: 'no-channel',
        videoId: getCurrentShortsVideoId(),
        at: new Date().toISOString(),
      };

      state.lastNegativeFeedbackResult = result;
      return result;
    }

    sendShortsNegativeFeedback(info, 'manual-console');
    return {
      status: 'scheduled',
      channel: info.name || info.url || info.key,
      videoId: getCurrentShortsVideoId(),
    };
  };


  function hideChannelCard(card, info) {
    try {
      card.style.display = 'none';
      card.dataset.cuChannelHidden = '1';

      if (info?.name) {
        card.dataset.cuChannelName = info.name;
      }
    } catch {}
  }

  function restoreChannelCard(card) {
    try {
      if (card.dataset.cuChannelHidden === '1') {
        card.style.removeProperty('display');
        delete card.dataset.cuChannelHidden;
        delete card.dataset.cuChannelName;
      }
    } catch {}
  }

  function findChannelCardFromTarget(target) {
    try {
      return target?.closest?.(getChannelCardSelector()) || null;
    } catch {
      return null;
    }
  }

  function ensureBanButton(card) {
    if (!CONFIG.channelBanButtonEnabled || !card) return;

    try {
      if (card.querySelector(`.${APP_ID}-channel-ban-button`)) return;

      const videoLink = getVideoLinkFromCard(card);
      if (!videoLink) return;

      card.dataset.cuChannelCard = '1';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${APP_ID}-channel-ban-button`;
      button.textContent = CONFIG.channelBanButtonText;
      button.title = 'Скрыть канал';
      button.setAttribute('aria-label', 'Скрыть канал');

      button.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

          const currentCard = findChannelCardFromTarget(event.target) || card;
          const info = extractChannelInfo(currentCard);

          if (!info) {
            toast(`${APP_SHORT}: не нашёл канал`, 1100);
            return;
          }

          const didBan = banChannel(info, {
            source: 'card-button',
            videoId: getVideoIdFromCard(currentCard),
          });
          recordPoopAction(info, {
            source: 'card-button',
            videoId: getVideoIdFromCard(currentCard),
          }, didBan);

          const cardReason = isHomeSafeModePage() ? 'home-card-ban' : 'card-ban';
          const shouldSendCardFeedback =
            didBan &&
            (
              CONFIG.negativeFeedbackOnCardBan ||
              (CONFIG.homePoopNegativeFeedback && shouldRunCardFeedback(currentCard, cardReason))
            );

          if (shouldSendCardFeedback) {
            sendCardNegativeFeedback(currentCard, info, cardReason);
            setTimeout(() => hideChannelCard(currentCard, info), CONFIG.negativeFeedbackHideCardDelayMs);
          } else {
            hideChannelCard(currentCard, info);
          }
        },
        true,
      );

      card.appendChild(button);
    } catch {}
  }



  function getShortsActionBarRoot() {
    try {
      const currentRoot = getCurrentShortsRoot();

      const selectors = [
        '.ytReelPlayerOverlayViewModelActionsContainer reel-action-bar-view-model',
        '.ytReelPlayerOverlayViewModelActionsContainer',
        'reel-action-bar-view-model.ytwReelActionBarViewModelHost',
        'reel-action-bar-view-model',
        '.ytwReelActionBarViewModelHost',
      ];

      for (const scope of [currentRoot, document]) {
        if (!scope?.querySelector) continue;

        for (const selector of selectors) {
          const el = scope.querySelector(selector);
          if (el) return el;
        }
      }

      return null;
    } catch {
      return null;
    }
  }


  function handleShortsPoopAction(reason = 'shorts-button') {
    try {
      const parts = getCurrentShortsVideoIdParts();
      const decision = getShortsIdentityDecision(parts, reason);

      if (decision.status === 'wait-mismatch') {
        toast(`${APP_SHORT}: жду Shorts…`, 650);

        setTimeout(() => {
          handleShortsPoopAction(`${reason}-stable`);
        }, decision.delayMs || CONFIG.shortsIdentityRaceDelayMs);

        return false;
      }

      const info = extractCurrentShortsChannelInfo();

      if (!info) {
        toast(`${APP_SHORT}: не нашёл канал Shorts`, 1200);
        return false;
      }

      const shortsVideoId = getCurrentShortsVideoId();
      const didBan = banChannel(info, {
        source: 'shorts-button',
        videoId: shortsVideoId,
      });

      const poopMeta = {
        source: 'shorts-button',
        videoId: shortsVideoId,
        identity: getCurrentShortsVideoIdParts(),
        identityDecision: decision,
      };

      recordPoopAction(info, poopMeta, didBan);

      if (didBan) {
        sendShortsNegativeFeedback(info, 'shorts-ban', { videoId: shortsVideoId })
          .then(() => recordPoopAction(info, poopMeta, didBan))
          .catch(() => recordPoopAction(info, poopMeta, didBan));

        if (CONFIG.shortsAdvanceAfterPoopEnabled) {
          setTimeout(() => {
            advanceToNextShort('after-poop');
            scheduleBlockedShortsCheck('after-poop-check', CONFIG.shortsSkipBannedDelayMs);
          }, CONFIG.shortsAdvanceAfterPoopDelayMs);
        }
      }

      return didBan;
    } catch (error) {
      log('poop action failed:', error);
      toast(`${APP_SHORT}: 💩 не сработала`, 1100);
      return false;
    }
  }


  function createShortsBanSlot() {
    const slot = document.createElement('div');
    slot.className = `${APP_ID}-shorts-ban-slot ytwReelActionBarViewModelHostDesktopActionButton`;
    slot.dataset.cuShortsBanSlot = '1';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${APP_ID}-shorts-ban-button`;
    button.textContent = CONFIG.channelBanButtonText;
    button.title = 'Скрыть канал Shorts';
    button.setAttribute('aria-label', 'Скрыть канал Shorts');
    button.setAttribute('aria-haspopup', 'false');

    const label = document.createElement('div');
    label.className = `${APP_ID}-shorts-ban-label`;
    label.setAttribute('aria-hidden', 'true');
    label.textContent = CONFIG.shortsBanButtonActionBarLabel || 'ЧС';

    button.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

        handleShortsPoopAction('shorts-button');
      },
      true,
    );

    slot.appendChild(button);
    slot.appendChild(label);

    return slot;
  }

  function attachShortsBanButtonToActionBar() {
    if (!CONFIG.shortsBanButtonPreferActionBar) return false;

    try {
      const actionBar = getShortsActionBarRoot();
      if (!actionBar) return false;

      if (!state.shortsBanButtonEl) {
        state.shortsBanButtonEl = createShortsBanSlot();
      }

      state.shortsBanButtonEl.classList.remove(`${APP_ID}-shorts-ban-fixed`);

      if (state.shortsBanButtonEl.parentNode !== actionBar) {
        actionBar.appendChild(state.shortsBanButtonEl);
      }

      state.shortsBanButtonEl.style.display = 'inline-flex';
      state.shortsBanButtonEl.dataset.cuShortsBanPlacement = 'action-bar';

      const button = state.shortsBanButtonEl.querySelector?.(`.${APP_ID}-shorts-ban-button`);
      if (button) button.classList.remove(`${APP_ID}-shorts-ban-fixed`);

      return true;
    } catch {
      return false;
    }
  }

  function attachShortsBanButtonFixedFallback() {
    if (!CONFIG.shortsBanButtonFallbackFixed) return false;

    try {
      if (!state.shortsBanButtonEl) {
        state.shortsBanButtonEl = createShortsBanSlot();
      }

      const root = document.body || document.documentElement;
      if (state.shortsBanButtonEl.parentNode !== root) {
        root.appendChild(state.shortsBanButtonEl);
      }

      state.shortsBanButtonEl.style.display = 'inline-flex';
      state.shortsBanButtonEl.dataset.cuShortsBanPlacement = 'fixed';

      const button = state.shortsBanButtonEl.querySelector?.(`.${APP_ID}-shorts-ban-button`);
      if (button) button.classList.add(`${APP_ID}-shorts-ban-fixed`);

      return true;
    } catch {
      return false;
    }
  }


  function ensureShortsBanButton() {
    if (!CONFIG.channelFilterEnabled || !CONFIG.channelBanButtonEnabled || !CONFIG.shortsBanOverlayEnabled) return;
    if (!isShortsPage()) {
      hideShortsBanButton();
      return;
    }

    try {
      ensureChannelFilterStyle();

      const attachedToActionBar = attachShortsBanButtonToActionBar();

      if (!attachedToActionBar) {
        attachShortsBanButtonFixedFallback();
      }
    } catch {}
  }

  function hideShortsBanButton() {
    try {
      if (state.shortsBanButtonEl) {
        state.shortsBanButtonEl.style.display = 'none';
      }
    } catch {}
  }


  function createShortsVolumeSlot() {
    const slot = document.createElement('div');
    slot.className = `${APP_ID}-shorts-volume-slot ytwReelActionBarViewModelHostDesktopActionButton`;
    slot.dataset.cuShortsVolumeSlot = '1';

    Object.assign(slot.style, {
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      minWidth: '48px',
      maxWidth: '72px',
      color: '#fff',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'transparent',
      userSelect: 'none',
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${APP_ID}-shorts-volume-button`;
    button.textContent = CONFIG.shortsVolumeButtonText || '🔉';
    button.title = 'Громкость Shorts';
    button.setAttribute('aria-label', 'Громкость Shorts');
    button.setAttribute('aria-haspopup', 'true');

    Object.assign(button.style, {
      width: `${CONFIG.shortsBanButtonSizePx}px`,
      height: `${CONFIG.shortsBanButtonSizePx}px`,
      minWidth: `${CONFIG.shortsBanButtonSizePx}px`,
      minHeight: `${CONFIG.shortsBanButtonSizePx}px`,
      padding: '0',
      border: '0',
      borderRadius: '999px',
      background: 'rgba(255, 255, 255, 0.14)',
      color: 'rgba(255, 255, 255, 0.98)',
      font: '25px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      fontWeight: '850',
      boxShadow: '0 2px 10px rgba(0,0,0,.24)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'transparent',
      userSelect: 'none',
      opacity: '0.94',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    });

    const label = document.createElement('div');
    label.className = `${APP_ID}-shorts-volume-action-label`;
    label.setAttribute('aria-hidden', 'true');
    label.textContent = CONFIG.shortsVolumeActionBarLabel || 'Звук';

    Object.assign(label.style, {
      minHeight: '16px',
      maxWidth: '72px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      textAlign: 'center',
      color: 'rgba(255,255,255,.96)',
      font: '12px/1.12 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      fontWeight: '650',
      textShadow: '0 1px 3px rgba(0,0,0,.55)',
    });

    button.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

        toggleShortsVolumePanel();
      },
      true,
    );

    slot.appendChild(button);
    slot.appendChild(label);

    state.shortsVolumeButtonEl = button;

    return slot;
  }

  function createShortsVolumePanel() {
    const panel = document.createElement('div');
    panel.className = `${APP_ID}-shorts-volume-panel`;

    Object.assign(panel.style, {
      position: 'fixed',
      left: '12px',
      right: '12px',
      bottom: `${CONFIG.shortsVolumePanelBottomPx}px`,
      zIndex: '2147483647',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '9px',
      padding: '11px 13px',
      borderRadius: '22px',
      background: 'rgba(0,0,0,.72)',
      color: 'rgba(255,255,255,.92)',
      boxShadow: '0 6px 24px rgba(0,0,0,.38)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'transparent',
      userSelect: 'none',
    });

    const icon = document.createElement('span');
    icon.textContent = '🔉';
    icon.setAttribute('aria-hidden', 'true');

    Object.assign(icon.style, {
      font: '18px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      opacity: '0.92',
    });

    const sliderWrap = document.createElement('div');

    Object.assign(sliderWrap.style, {
      position: 'relative',
      width: 'min(58vw, 220px)',
      height: `${Math.max(CONFIG.volumeThumbSizePx, CONFIG.volumeTrackHeightActivePx) + 10}px`,
      display: 'flex',
      alignItems: 'center',
      flex: '0 1 auto',
      pointerEvents: 'auto',
      touchAction: 'pan-x',
    });

    const inactiveTrack = document.createElement('div');
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
    activeTrack.className = `${APP_ID}-shorts-volume-track-active`;
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
    thumb.className = `${APP_ID}-shorts-volume-thumb`;
    Object.assign(thumb.style, {
      position: 'absolute',
      left: '30%',
      top: '50%',
      width: `${CONFIG.volumeThumbSizePx}px`,
      height: `${CONFIG.volumeThumbSizePx}px`,
      transform: 'translate(-50%, -50%)',
      borderRadius: '999px',
      border: '2px solid rgba(255,255,255,.92)',
      background: 'rgba(255,255,255,.92)',
      boxShadow: '0 2px 8px rgba(0,0,0,.40)',
      pointerEvents: 'none',
    });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(CONFIG.volumeMinPercent);
    slider.max = String(CONFIG.volumeMaxPercent);
    slider.step = String(CONFIG.volumeStepPercent);
    slider.value = String(readStoredVolumePercent() ?? CONFIG.volumeDefaultPercent);
    slider.setAttribute('aria-label', 'Громкость Shorts');

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
    label.className = `${APP_ID}-shorts-volume-label`;
    label.textContent = getVolumeLabelText(slider.value);
    label.title = getVolumeTitle(slider.value);

    Object.assign(label.style, {
      minWidth: '38px',
      textAlign: 'right',
      font: '13px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      fontWeight: '750',
      color: 'rgba(255,255,255,.88)',
    });

    const stop = (event) => {
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      showShortsVolumePanel();
    };

    ['pointerdown', 'touchstart', 'click'].forEach((name) => {
      panel.addEventListener(name, stop, true);
      sliderWrap.addEventListener(name, stop, true);
      slider.addEventListener(name, stop, true);
    });

    const onInput = (event, reason) => {
      event.preventDefault();
      event.stopPropagation();
      updateVolumeWidgetVisual(slider, activeTrack, thumb, slider.value);
      setVideoVolumePercent(slider.value, reason);
      syncStoredVolumeToAllVideos(reason, true);
      showShortsVolumePanel();
    };

    slider.addEventListener('input', (event) => onInput(event, 'shorts-slider'), true);
    slider.addEventListener('change', (event) => onInput(event, 'shorts-slider-change'), true);

    sliderWrap.appendChild(inactiveTrack);
    sliderWrap.appendChild(activeTrack);
    sliderWrap.appendChild(thumb);
    sliderWrap.appendChild(slider);

    panel.appendChild(icon);
    panel.appendChild(sliderWrap);
    panel.appendChild(label);

    state.shortsVolumeSliderEl = slider;
    state.shortsVolumeActiveTrackEl = activeTrack;
    state.shortsVolumeThumbEl = thumb;
    state.shortsVolumeLabelEl = label;

    updateShortsVolumeWidgetVisual(slider.value);

    return panel;
  }

  function ensureShortsVolumePanel() {
    if (!CONFIG.shortsVolumeControlEnabled || !isShortsPage()) return null;

    try {
      if (!state.shortsVolumePanelEl) {
        state.shortsVolumePanelEl = createShortsVolumePanel();
      }

      const root = document.body || document.documentElement;

      if (state.shortsVolumePanelEl.parentNode !== root) {
        root.appendChild(state.shortsVolumePanelEl);
      }

      updateVolumeControl();
      return state.shortsVolumePanelEl;
    } catch {
      return null;
    }
  }

  function showShortsVolumePanel() {
    const panel = ensureShortsVolumePanel();
    if (!panel) return;

    try {
      panel.style.display = 'flex';
      updateVolumeControl();
      syncStoredVolumeToAllVideos('shorts-volume-panel', true);

      clearTimeout(state.shortsVolumeHideTimer);
      state.shortsVolumeHideTimer = setTimeout(hideShortsVolumePanel, CONFIG.shortsVolumePanelAutoHideMs);
    } catch {}
  }

  function hideShortsVolumePanel() {
    try {
      clearTimeout(state.shortsVolumeHideTimer);

      if (state.shortsVolumePanelEl) {
        state.shortsVolumePanelEl.style.display = 'none';
      }
    } catch {}
  }

  function toggleShortsVolumePanel() {
    try {
      const panel = ensureShortsVolumePanel();

      if (!panel || panel.style.display === 'flex') {
        hideShortsVolumePanel();
        return;
      }

      showShortsVolumePanel();
    } catch {}
  }

  function attachShortsVolumeToActionBar() {
    if (!CONFIG.shortsVolumeControlEnabled) return false;

    try {
      const actionBar = getShortsActionBarRoot();
      if (!actionBar) return false;

      if (!state.shortsVolumeSlotEl) {
        state.shortsVolumeSlotEl = createShortsVolumeSlot();
      }

      if (state.shortsVolumeSlotEl.parentNode !== actionBar) {
        if (state.shortsBanButtonEl && state.shortsBanButtonEl.parentNode === actionBar) {
          actionBar.insertBefore(state.shortsVolumeSlotEl, state.shortsBanButtonEl);
        } else {
          actionBar.appendChild(state.shortsVolumeSlotEl);
        }
      }

      state.shortsVolumeSlotEl.style.display = 'inline-flex';
      state.shortsVolumeSlotEl.dataset.cuShortsVolumePlacement = 'action-bar';

      ensureShortsVolumePanel();
      updateVolumeControl();

      return true;
    } catch {
      return false;
    }
  }

  function ensureShortsVolumeControl() {
    if (!CONFIG.volumeControlEnabled || !CONFIG.shortsVolumeControlEnabled) return;

    if (!isShortsPage()) {
      hideShortsVolumeControl();
      return;
    }

    attachShortsVolumeToActionBar();
  }

  function hideShortsVolumeControl() {
    try {
      if (state.shortsVolumeSlotEl) {
        state.shortsVolumeSlotEl.style.display = 'none';
      }

      hideShortsVolumePanel();
    } catch {}
  }

  function syncShortsVolumeControl() {
    if (isShortsPage()) {
      ensureShortsVolumeControl();
    } else {
      hideShortsVolumeControl();
    }
  }



  function syncShortsBanButton() {
    if (isShortsPage()) {
      ensureShortsBanButton();
      syncShortsVolumeControl();
    } else {
      hideShortsBanButton();
      hideShortsVolumeControl();
    }
  }



  function getCurrentShortsBannedInfo() {
    if (!CONFIG.channelFilterEnabled || !isShortsPage()) return null;

    const info = extractCurrentShortsChannelInfo();
    if (!info) return null;

    const check = getChannelBanCheck(info);

    if (!check.banned) return null;

    return {
      info: check.info,
      matchedAlias: check.matchedAliases[0] || '',
      matchedAliases: check.matchedAliases || [],
      bannedItem: check.matchedItem || null,
      videoId: getCurrentShortsVideoId(),
    };
  }


  function clickShortsNextButton() {
    if (!CONFIG.shortsSkipUseNextButton) return false;

    try {
      const include = [
        'следующее видео',
        'следующий ролик',
        'следующее',
        'next video',
        'next short',
        'next',
      ];

      const exclude = [
        'предыдущее',
        'previous',
        'назад',
        'back',
        'комментар',
        'comment',
        'поделиться',
        'share',
      ];

      const button = findVisibleClickableByText(document, include, exclude, { preferRightRail: true, preferBottom: true });

      if (!button) return false;
      return safeClickElement(button, 'shorts-next-button');
    } catch {
      return false;
    }
  }

  function sendShortsNextKeyboard() {
    if (!CONFIG.shortsSkipUseKeyboard) return false;

    try {
      const targets = [
        getCurrentShortsRoot(),
        document.activeElement,
        document.body,
        document.documentElement,
        document,
        window,
      ].filter(Boolean);

      for (const target of targets) {
        try {
          target.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            keyCode: 40,
            which: 40,
            bubbles: true,
            cancelable: true,
          }));

          target.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            keyCode: 40,
            which: 40,
            bubbles: true,
            cancelable: true,
          }));
        } catch {}
      }

      return true;
    } catch {
      return false;
    }
  }


  function dispatchShortsSwipe(distancePx) {
    try {
      const startX = Math.round((window.innerWidth || 360) * 0.52);
      const startY = Math.round((window.innerHeight || 640) * 0.72);
      const endY = Math.max(40, startY - distancePx);
      const target = getCurrentShortsRoot() || document.body || document.documentElement;

      const common = {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        pointerId: 11,
        isPrimary: true,
        clientX: startX,
      };

      target.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientY: startY }));
      target.dispatchEvent(new PointerEvent('pointermove', { ...common, clientY: Math.round((startY + endY) / 2) }));
      target.dispatchEvent(new PointerEvent('pointermove', { ...common, clientY: endY }));
      target.dispatchEvent(new PointerEvent('pointerup', { ...common, clientY: endY }));

      target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));

      return true;
    } catch {
      return false;
    }
  }

  function advanceToNextShort(reason = 'blocked') {
    try {
      const nextClicked = clickShortsNextButton();

      if (nextClicked) {
        log('advance to next short', { reason, method: 'next-button' });
        return true;
      }

      const keySent = sendShortsNextKeyboard();
      const distance = CONFIG.shortsSkipGestureDistancePx || Math.round((window.innerHeight || 640) * 0.66);
      const swiped = dispatchShortsSwipe(distance);

      try {
        window.scrollBy({
          top: Math.round((window.innerHeight || 640) * 0.92),
          left: 0,
          behavior: 'smooth',
        });
      } catch {
        window.scrollBy(0, Math.round((window.innerHeight || 640) * 0.92));
      }

      try {
        document.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: Math.round((window.innerHeight || 640) * 0.9),
          deltaMode: 0,
        }));
      } catch {}

      log('advance to next short', { reason, method: 'keyboard+swipe+scroll', keySent, swiped });
      return Boolean(keySent || swiped);
    } catch (error) {
      log('advance short failed', error);
      return false;
    }
  }

  function processBlockedShorts(reason = 'blocked-check') {
    if (!CONFIG.shortsSkipBannedChannelsEnabled || !isShortsPage()) return null;

    try {
      const now = Date.now();

      if (now - state.lastBlockedShortsSkipAtMs < CONFIG.shortsSkipBannedCooldownMs) {
        return state.lastBlockedShortsResult;
      }

      const identityParts = getCurrentShortsVideoIdParts();
      const identityDecision = getShortsIdentityDecision(identityParts, reason);

      if (identityDecision.status === 'wait-mismatch') {
        state.lastBlockedShortsResult = {
          status: 'waiting-identity',
          reason,
          identityDecision,
          videoId: identityParts.chosen || '',
          at: new Date().toISOString(),
        };

        scheduleBlockedShortsCheck(`${reason}-stable`, identityDecision.delayMs || CONFIG.shortsIdentityRaceDelayMs);
        return state.lastBlockedShortsResult;
      }

      const blocked = getCurrentShortsBannedInfo();

      if (!blocked) {
        state.lastBlockedShortsResult = {
          status: 'not-banned',
          reason,
          videoId: getCurrentShortsVideoId(),
          at: new Date().toISOString(),
        };

        return state.lastBlockedShortsResult;
      }

      if (blocked.videoId && blocked.videoId === state.lastBlockedShortsVideoId) {
        return state.lastBlockedShortsResult;
      }

      const skipped = advanceToNextShort(reason);

      state.lastBlockedShortsSkipAtMs = now;
      state.lastBlockedShortsVideoId = blocked.videoId || '';
      state.lastBlockedShortsResult = {
        status: skipped ? 'skipped' : 'skip-failed',
        reason,
        videoId: blocked.videoId || '',
        channel: blocked.info?.name || blocked.info?.url || blocked.info?.key || '',
        matchedAlias: blocked.matchedAlias || '',
        at: new Date().toISOString(),
      };

      if (skipped) {
        toast(`${APP_SHORT}: Shorts из ЧС пропущен`, 850);
      }

      return state.lastBlockedShortsResult;
    } catch (error) {
      state.lastBlockedShortsResult = {
        status: 'error',
        reason,
        error: String(error && error.message ? error.message : error),
        at: new Date().toISOString(),
      };

      return state.lastBlockedShortsResult;
    }
  }

  function scheduleBlockedShortsCheck(reason = 'scheduled', delay = CONFIG.shortsSkipBannedDelayMs) {
    if (!CONFIG.shortsSkipBannedChannelsEnabled) return;
    if (!shouldRunShortsTasks()) return;

    clearTimeout(state.blockedShortsTimer);
    state.blockedShortsTimer = setTimeout(() => processBlockedShorts(reason), delay);
  }

  window.cuCheckCurrentShortsBan = function cuCheckCurrentShortsBan() {
    return {
      current: getCurrentShortsBannedInfo(),
      result: processBlockedShorts('manual-console'),
      banned: readBannedChannels(),
    };
  };



  function getHomePoopCards() {
    try {
      if (!shouldRunHomePoopTasks()) return [];

      const selector = getChannelCardSelector();
      const cards = Array.from(document.querySelectorAll(selector));

      return cards
        .filter((card) => {
          if (!card || card.dataset.cuHomePoopSkip === '1') return false;
          if (card.closest?.('ytd-popup-container, tp-yt-paper-dialog, ytm-bottom-sheet-renderer')) return false;

          const link = getVideoLinkFromCard(card);
          if (!link) return false;

          /*
            На главной берём только карточки видео/Shorts. Никаких active player,
            никаких video-элементов и прочего тяжёлого хозяйства.
          */
          const href = link.getAttribute('href') || link.href || '';
          return /\/watch\?|\/shorts\//.test(href);
        })
        .slice(0, CONFIG.homePoopMaxCardsPerScan);
    } catch {
      return [];
    }
  }

  function processHomePoop(reason = 'home-poop') {
    if (!shouldRunHomePoopTasks()) return null;

    try {
      ensureChannelFilterStyle();

      const cards = getHomePoopCards();
      const bannedMap = getBannedChannelMap();

      let buttons = 0;
      let hidden = 0;
      let scanned = 0;

      for (const card of cards) {
        scanned += 1;

        const info = extractChannelInfo(card);

        if (info && CONFIG.homePoopHideBannedCards && isChannelBanned(info, bannedMap)) {
          hideChannelCard(card, info);
          hidden += 1;
          continue;
        }

        restoreChannelCard(card);
        ensureBanButton(card);

        if (card.querySelector?.(`.${APP_ID}-channel-ban-button`)) {
          buttons += 1;
        }
      }

      state.lastHomePoopResult = {
        reason,
        scanned,
        buttons,
        hidden,
        at: new Date().toISOString(),
      };

      log('home poop processed', state.lastHomePoopResult);
      return state.lastHomePoopResult;
    } catch (error) {
      state.lastHomePoopResult = {
        reason,
        error: String(error && error.message ? error.message : error),
        at: new Date().toISOString(),
      };

      log('home poop failed', state.lastHomePoopResult);
      return state.lastHomePoopResult;
    }
  }

  function scheduleHomePoop(reason = 'scheduled', delay = CONFIG.homePoopScanDelayMs) {
    if (!shouldRunHomePoopTasks()) return;

    clearTimeout(state.homePoopTimer);
    state.homePoopTimer = setTimeout(() => processHomePoop(reason), delay);
  }

  window.cuProcessHomePoop = function cuProcessHomePoop() {
    return processHomePoop('manual-console');
  };

  window.cuLastHomePoop = function cuLastHomePoop() {
    return state.lastHomePoopResult;
  };

  window.cuLastCardFeedback = function cuLastCardFeedback() {
    return state.lastCardFeedbackResult;
  };





  function clearAmbientShortsCleanupTimer() {
    try {
      clearTimeout(state.ambientShortsCleanupTimer);
      state.ambientShortsCleanupTimer = 0;
    } catch {}
  }

  function restoreAmbientShortsHiddenNodes() {
    try {
      document.querySelectorAll('[data-cu-ambient-shorts-hidden="1"]').forEach((node) => {
        try {
          delete node.dataset.cuAmbientShortsHidden;
        } catch {}
      });
    } catch {}
  }

  function updateShortsRouteClass(reason = 'route') {
    try {
      const root = document.documentElement;
      if (!root) return;

      const shorts = isShortsPage() || isSourceShortsPage();

      root.classList.toggle(`${APP_ID}-page-shorts`, shorts);
      root.classList.toggle(`${APP_ID}-page-nonshorts`, !shorts);
      root.classList.remove(`${APP_ID}-shorts-transitioning`);

      if (shorts) {
        clearAmbientShortsCleanupTimer();
        restoreAmbientShortsHiddenNodes();
      }

      log('shorts route', reason, shorts ? 'shorts' : 'nonshorts');
    } catch {}
  }

  function beginShortsTransition(reason = 'shorts-navigation') {
    try {
      clearAmbientShortsCleanupTimer();
      clearTimeout(state.homeCleanupTimer);
      clearTimeout(state.shortsTransitionTimer);

      document.documentElement?.classList.add(`${APP_ID}-shorts-transitioning`);

      state.shortsTransitionTimer = setTimeout(() => {
        updateShortsRouteClass(`${reason}-timeout`);
      }, CONFIG.shortsTransitionGuardMs);
    } catch {}
  }

  function bindShortsTransitionGuard() {
    const handler = (event) => {
      try {
        const target = event.target;
        const anchor = target?.closest?.('a[href]');

        if (anchor && isShortsHref(anchor.getAttribute('href') || anchor.href || '')) {
          beginShortsTransition('shorts-link');
          return;
        }

        const pivot = target?.closest?.('ytm-pivot-bar-item-renderer, ytm-pivot-bar-renderer');
        if (!pivot) return;

        const text = String(pivot.textContent || '').trim().toLowerCase();
        if (text.includes('shorts') || text.includes('шортс')) {
          beginShortsTransition('shorts-bottom-nav');
        }
      } catch {}
    };

    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('touchstart', handler, true);
  }


  function isAllowedShortsPage() {
    if (!CONFIG.ambientShortsCleanupKeepDirectShortsPage) return false;

    return isShortsPage() || isSourceShortsPage();
  }

  function shouldRunAmbientShortsCleanupTasks() {
    if (!CONFIG.ambientShortsCleanupEnabled) return false;
    if (!isSupportedYouTubeHost()) return false;
    if (isAllowedShortsPage()) return false;

    return true;
  }

  function isAllowedShortsNavigationElement(el) {
    if (!CONFIG.ambientShortsCleanupKeepBottomNav) return false;

    try {
      return Boolean(
        el?.closest?.(
          [
            'ytm-pivot-bar-renderer',
            'ytm-pivot-bar-item-renderer',
            '#pivot-bar',
            '.pivot-bar',
            '.ytm-pivot-bar-renderer',
            'ytm-mobile-topbar-renderer',
          ].join(','),
        ),
      );
    } catch {
      return false;
    }
  }

  function isShortsHref(href) {
    try {
      const url = new URL(href, location.origin);
      return /^\/shorts(?:\/|$)/.test(url.pathname);
    } catch {
      return /\/shorts(?:\/|$)/.test(String(href || ''));
    }
  }

  function findAmbientShortsContainer(anchor) {
    try {
      if (!anchor || isAllowedShortsNavigationElement(anchor)) return null;

      const shelf = anchor.closest?.(
        [
          'ytm-reel-shelf-renderer',
          'ytm-rich-section-renderer',
          'ytd-reel-shelf-renderer',
          'ytd-rich-section-renderer',
          'ytd-rich-shelf-renderer',
          'ytd-shelf-renderer',
        ].join(','),
      );

      if (shelf) return shelf;

      return anchor.closest?.(
        [
          'ytm-shorts-lockup-view-model',
          'ytm-shorts-lockup-view-model-v2',
          'ytm-shorts-lockup-view-model-v3',
          'ytm-reel-item-renderer',
          'ytm-reel-video-renderer',
          'ytm-rich-item-renderer',
          'ytm-video-with-context-renderer',
          'ytm-compact-video-renderer',
          'ytm-video-card-renderer',
          'yt-lockup-view-model',
          'ytd-reel-item-renderer',
          'ytd-rich-item-renderer',
          'ytd-video-renderer',
          'ytd-compact-video-renderer',
          'ytd-grid-video-renderer',
          'ytd-playlist-video-renderer',
        ].join(','),
      );
    } catch {
      return null;
    }
  }

  function getAmbientShortsTextCandidates() {
    try {
      const selectors = [
        'ytm-rich-section-renderer',
        'ytm-reel-shelf-renderer',
        'ytm-item-section-renderer',
        'ytm-rich-item-renderer',
        'ytm-chip-cloud-chip-renderer',
        'ytd-rich-section-renderer',
        'ytd-reel-shelf-renderer',
        'ytd-rich-shelf-renderer',
        'ytd-shelf-renderer',
        'ytd-rich-item-renderer',
        'ytd-video-renderer',
        'yt-chip-cloud-chip-renderer',
        'ytm-chip-cloud-chip-renderer',
      ];

      const nodes = [];
      const seen = new Set();

      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          if (!node || seen.has(node)) continue;
          if (isAllowedShortsNavigationElement(node)) continue;

          seen.add(node);
          nodes.push(node);

          if (nodes.length >= CONFIG.ambientShortsCleanupMaxTextNodesPerScan) {
            return nodes;
          }
        }
      }

      return nodes;
    } catch {
      return [];
    }
  }

  function isAmbientShortsOrJamNode(node) {
    if (!node || !node.querySelector) return false;

    try {
      const text = getNodeOwnText(node).toLowerCase();
      const html = String(node.outerHTML || '').slice(0, 28000).toLowerCase();

      if (CONFIG.ambientShortsCleanupHideShelves || CONFIG.ambientShortsCleanupHideCards) {
        if (
          /(^|\s|#)shorts(\s|$)/i.test(text) ||
          text.includes('shorts') ||
          text.includes('шортс') ||
          text.includes('шортсы') ||
          html.includes('/shorts/') ||
          html.includes('reel-shelf') ||
          html.includes('reel_item') ||
          html.includes('shorts-lockup')
        ) {
          return true;
        }
      }

      if (CONFIG.ambientShortsCleanupHideMyJam) {
        if (
          text.includes('мой джем') ||
          text.includes('my jam') ||
          text.includes('джем') ||
          html.includes('my_jam') ||
          html.includes('music-jam') ||
          html.includes('music_jam')
        ) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  function stopAmbientPreviewVideos(reason = 'ambient-preview') {
    if (!CONFIG.ambientShortsCleanupDisablePreviewAutoplay || !shouldRunAmbientShortsCleanupTasks()) return 0;

    let stopped = 0;

    try {
      for (const video of Array.from(document.querySelectorAll('video')).slice(0, 16)) {
        try {
          if (!video || video.closest?.('ytd-player, ytm-player, #movie_player')) continue;

          video.pause();
          video.muted = true;
          video.autoplay = false;
          video.preload = 'none';
          stopped += 1;
        } catch {}
      }
    } catch {}

    if (stopped) log('ambient previews stopped', reason, stopped);
    return stopped;
  }

  function processAmbientShortsCleanup(reason = 'ambient-shorts-cleanup') {
    if (!shouldRunAmbientShortsCleanupTasks()) return null;

    try {
      ensureHomeCleanupStyle();

      const hiddenNodes = new Set();
      let links = 0;
      let hiddenByLink = 0;
      let hiddenByText = 0;

      const anchors = Array.from(
        document.querySelectorAll('a[href^="/shorts/"], a[href*="youtube.com/shorts/"]'),
      ).slice(0, CONFIG.ambientShortsCleanupMaxLinksPerScan);

      for (const anchor of anchors) {
        if (!isShortsHref(anchor.getAttribute('href') || anchor.href || '')) continue;
        if (isAllowedShortsNavigationElement(anchor)) continue;

        links += 1;
        const container = findAmbientShortsContainer(anchor);

        if (container && !hiddenNodes.has(container)) {
          container.dataset.cuAmbientShortsHidden = '1';
          hiddenNodes.add(container);
          hiddenByLink += 1;
        }
      }

      for (const node of getAmbientShortsTextCandidates()) {
        if (hiddenNodes.has(node)) continue;
        if (isAmbientShortsOrJamNode(node)) {
          node.dataset.cuAmbientShortsHidden = '1';
          hiddenNodes.add(node);
          hiddenByText += 1;
        }
      }

      const stoppedPreviews = stopAmbientPreviewVideos(reason);

      state.lastAmbientShortsCleanupResult = {
        reason,
        links,
        hiddenByLink,
        hiddenByText,
        hidden: hiddenByLink + hiddenByText,
        stoppedPreviews,
        at: new Date().toISOString(),
      };

      log('ambient shorts cleanup processed', state.lastAmbientShortsCleanupResult);
      return state.lastAmbientShortsCleanupResult;
    } catch (error) {
      state.lastAmbientShortsCleanupResult = {
        reason,
        error: String(error && error.message ? error.message : error),
        at: new Date().toISOString(),
      };

      log('ambient shorts cleanup failed', state.lastAmbientShortsCleanupResult);
      return state.lastAmbientShortsCleanupResult;
    }
  }

  function scheduleAmbientShortsCleanup(reason = 'scheduled', delay = CONFIG.ambientShortsCleanupDelayMs) {
    if (!shouldRunAmbientShortsCleanupTasks()) return;

    clearTimeout(state.ambientShortsCleanupTimer);
    state.ambientShortsCleanupTimer = setTimeout(() => processAmbientShortsCleanup(reason), delay);
  }


  window.cuShortsSafeMode = function cuShortsSafeMode() {
    return {
      enabled: CONFIG.shortsSafeModeEnabled,
      active: isShortsSafeModePage(),
      pathname: location.pathname,
      shouldRunHeavyPlayerTasks: shouldRunHeavyPlayerTasks(),
      shouldRunShortsTasks: shouldRunShortsTasks(),
      shouldRunVolumeSyncTasks: shouldRunVolumeSyncTasks(),
      shortsSafeVolumeSyncActive: shouldRunShortsSafeVolumeSync(),
      lastShortsSafeVolumeResult: state.lastShortsSafeVolumeResult,
      observerInstalled: Boolean(state.observer),
      boundVideo: Boolean(state.boundVideo),
    };
  };


  window.cuProcessShortsCleanup = function cuProcessShortsCleanup() {
    updateShortsRouteClass('manual-console');

    return {
      mode: CONFIG.shortsCssCleanupEnabled ? 'css' : 'off',
      jsScannerEnabled: CONFIG.ambientShortsCleanupEnabled,
      shortsPage: isShortsPage() || isSourceShortsPage(),
      transitioning: Boolean(document.documentElement?.classList.contains(`${APP_ID}-shorts-transitioning`)),
      at: new Date().toISOString(),
    };
  };

  window.cuLastShortsCleanup = function cuLastShortsCleanup() {
    return state.lastAmbientShortsCleanupResult;
  };

  function shouldRunHomeCleanupTasks() {
    return Boolean(CONFIG.homeCleanupEnabled && isHomeSafeModePage());
  }

  function getNodeOwnText(node) {
    try {
      return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }

  function isProbablyShortsOrJamNode(node) {
    if (!node || !node.querySelector) return false;

    try {
      const text = getNodeOwnText(node).toLowerCase();
      const html = String(node.outerHTML || '').slice(0, 24000).toLowerCase();

      if (CONFIG.homeCleanupHideShortsShelves) {
        if (
          /(^|\s|#)shorts(\s|$)/i.test(text) ||
          text.includes('shorts') ||
          text.includes('шортс') ||
          text.includes('шортсы') ||
          html.includes('/shorts/') ||
          html.includes('reel') ||
          html.includes('shorts')
        ) {
          return true;
        }
      }

      if (CONFIG.homeCleanupHideMyJam) {
        if (
          text.includes('мой джем') ||
          text.includes('my jam') ||
          text.includes('джем') ||
          html.includes('my_jam') ||
          html.includes('music-jam') ||
          html.includes('music_jam')
        ) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  function getHomeCleanupCandidates() {
    try {
      const selectors = [
        'ytm-rich-section-renderer',
        'ytm-reel-shelf-renderer',
        'ytm-shorts-lockup-view-model',
        'ytm-rich-item-renderer',
        'ytm-item-section-renderer',
        'ytm-section-list-renderer > *',
        'ytd-rich-section-renderer',
        'ytd-reel-shelf-renderer',
        'ytd-rich-shelf-renderer',
        'ytd-rich-item-renderer',
        'ytd-shelf-renderer',
        'ytd-video-renderer',
        'ytm-compact-video-renderer',
        'ytm-video-with-context-renderer',
      ];

      const seen = new Set();
      const nodes = [];

      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          if (!node || seen.has(node)) continue;
          seen.add(node);
          nodes.push(node);

          if (nodes.length >= CONFIG.homeCleanupMaxNodesPerScan) {
            return nodes;
          }
        }
      }

      return nodes;
    } catch {
      return [];
    }
  }

  function stopHomePreviewVideos(reason = 'home-preview') {
    if (!CONFIG.homeCleanupDisablePreviewAutoplay || !isHomeSafeModePage()) return 0;

    let stopped = 0;

    try {
      for (const video of Array.from(document.querySelectorAll('video')).slice(0, 12)) {
        try {
          if (!video || video.closest?.('ytd-player, ytm-player, #movie_player')) continue;

          video.pause();
          video.muted = true;
          video.autoplay = false;
          video.preload = 'none';
          stopped += 1;
        } catch {}
      }
    } catch {}

    if (stopped) log('home previews stopped', reason, stopped);
    return stopped;
  }

  function processHomeCleanup(reason = 'home-cleanup') {
    if (!shouldRunHomeCleanupTasks()) return null;

    try {
      ensureHomeCleanupStyle();

      const nodes = getHomeCleanupCandidates();

      let hidden = 0;
      let scanned = 0;

      for (const node of nodes) {
        scanned += 1;

        if (isProbablyShortsOrJamNode(node)) {
          node.dataset.cuHomeCleanHidden = '1';
          hidden += 1;
        }
      }

      const stoppedPreviews = stopHomePreviewVideos(reason);

      state.lastHomeCleanupResult = {
        reason,
        scanned,
        hidden,
        stoppedPreviews,
        at: new Date().toISOString(),
      };

      log('home cleanup processed', state.lastHomeCleanupResult);
      return state.lastHomeCleanupResult;
    } catch (error) {
      state.lastHomeCleanupResult = {
        reason,
        error: String(error && error.message ? error.message : error),
        at: new Date().toISOString(),
      };

      log('home cleanup failed', state.lastHomeCleanupResult);
      return state.lastHomeCleanupResult;
    }
  }

  function scheduleHomeCleanup(reason = 'scheduled', delay = CONFIG.homeCleanupDelayMs) {
    if (!shouldRunHomeCleanupTasks()) return;

    clearTimeout(state.homeCleanupTimer);
    state.homeCleanupTimer = setTimeout(() => processHomeCleanup(reason), delay);
  }

  function bindHomePreviewStopper() {
    try {
      document.addEventListener(
        'play',
        (event) => {
          const target = event.target;

          if (
            !(
              (CONFIG.homeCleanupDisablePreviewAutoplay && isHomeSafeModePage()) ||
              (
                CONFIG.ambientShortsCleanupDisablePreviewAutoplay &&
                !isShortsPage() &&
                !isSourceShortsPage()
              )
            )
          ) return;
          if (!target || String(target.tagName || '').toLowerCase() !== 'video') return;
          if (target.closest?.('ytd-player, ytm-player, #movie_player')) return;

          try {
            target.pause();
            target.muted = true;
            target.autoplay = false;
            target.preload = 'none';
          } catch {}
        },
        true,
      );
    } catch {}
  }

  window.cuProcessHomeCleanup = function cuProcessHomeCleanup() {
    return processHomeCleanup('manual-console');
  };

  window.cuLastHomeCleanup = function cuLastHomeCleanup() {
    return state.lastHomeCleanupResult;
  };


  function processChannelCards(reason = 'process') {
    if (!CONFIG.channelFilterEnabled) return;

    try {
      ensureChannelFilterStyle();
      syncShortsBanButton();
      scheduleBlockedShortsCheck(reason);

      const cards = Array.from(document.querySelectorAll(getChannelCardSelector()));
      const bannedMap = getBannedChannelMap();

      for (const card of cards) {
        /*
          На обычной watch-странице кнопка на основном видео не нужна.
          Там нет смысла банить канал через сам плеер, а вот в рекомендациях и Shorts
          санитарная кнопка полезна. Поэтому карточки с настоящим <video> пропускаем:
          активный Shorts обрабатывается отдельной fixed-кнопкой.
        */
        if (CONFIG.hideBanButtonOnMainWatchVideo && card.querySelector?.('video')) {
          restoreChannelCard(card);
          continue;
        }

        const videoLink = getVideoLinkFromCard(card);

        if (!videoLink) {
          restoreChannelCard(card);
          continue;
        }

        const info = extractChannelInfo(card);

        if (info && isChannelBanned(info, bannedMap)) {
          hideChannelCard(card, info);
          continue;
        }

        restoreChannelCard(card);
        ensureBanButton(card);
      }

      log('channel cards processed', {
        reason,
        cards: cards.length,
        banned: bannedMap.size,
        shortsButton: Boolean(state.shortsBanButtonEl && state.shortsBanButtonEl.style.display !== 'none'),
      });
    } catch (error) {
      log('channel filter failed:', error);
    }
  }

  function scheduleChannelFilter(reason = 'scheduled') {
    if (!CONFIG.channelFilterEnabled) return;
    if (!shouldRunChannelFilterTasks()) return;

    clearTimeout(state.channelFilterTimer);
    state.channelFilterTimer = setTimeout(() => processChannelCards(reason), CONFIG.channelBanScanDelayMs);
  }

  window.cuListBannedChannels = function cuListBannedChannels() {
    return readBannedChannels();
  };

  window.cuUnbanChannel = function cuUnbanChannel(query) {
    return unbanChannel(query);
  };

  window.cuClearBannedChannels = function cuClearBannedChannels() {
    return clearBannedChannels();
  };



  function onUrlMaybeChanged(reason = 'url') {
    const href = location.href;
    if (href === state.currentUrl) return;

    state.currentUrl = href;
    updateShortsRouteClass(reason);
    state.videoId = '';
    state.loadedVideoId = '';
    state.segments = [];
    state.lastSkipKey = '';
    state.lastSkipAtMs = 0;
    state.lastTap.time = 0;
    hideCustomControls();

    if (isShortsSafeModePage()) {
      stopShortsRuntimeTasks(reason);
      scheduleShortsSafeVolume(`${reason}-route`, 0);
      return;
    }

    syncShortsBanButton();
    syncNativeAdPoll(reason);

    scheduleBind();

    if (shouldRunVolumeSyncTasks()) {
      scheduleVolumeSync(reason, true);
    }

    if (shouldRunHeavyPlayerTasks()) {
      scheduleRefresh(reason);
      syncFullscreenSoon(reason);
    }

    scheduleHomeChipsCleanup(reason);

    if (shouldRunHomeCleanupTasks()) {
      scheduleHomeCleanup(reason);
    }

    if (shouldRunHomePoopTasks()) {
      scheduleHomePoop(reason);
    }

    if (shouldRunChannelFilterTasks()) {
      scheduleChannelFilter(reason);
    }

    if (shouldRunShortsTasks()) {
      syncShortsBanButton();
      scheduleBlockedShortsCheck(reason);
    }
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
        if (location.href !== state.currentUrl) {
          onUrlMaybeChanged('mutation-url');
          return;
        }

        /*
          0.3.19: внутри Shorts MutationObserver КЮ молчит полностью.
          Никаких кнопок, volume sync, blacklist scans или bindVideo.
        */
        if (isShortsSafeModePage()) {
          return;
        }

        /*
          На главной мобильного YouTube MutationObserver может получать лавину
          изменений ещё до стабилизации приложения. В 0.3.9 тяжёлые задачи могли
          подливать масла в этот bootstrap-пожар. На home оставляем только лёгкую
          чистку чипов, без обхода карточек, Shorts и всех video.
        */
        if (isHomeSafeModePage() && CONFIG.homeSafeModeDisableMutationHeavyTasks) {
          scheduleHomeChipsCleanup('mutation-home-safe');
          scheduleHomeCleanup('mutation-home-safe', CONFIG.homeCleanupMutationDelayMs);
          scheduleHomePoop('mutation-home-safe', CONFIG.homePoopMutationDelayMs);
          return;
        }

        runNativeAdSkipCheck('mutation');
        scheduleBind();

        if (shouldRunVolumeSyncTasks()) {
          scheduleVolumeSync('mutation');
        }

        scheduleHomeChipsCleanup('mutation');

        if (shouldRunHomeCleanupTasks()) {
          scheduleHomeCleanup('mutation', CONFIG.homeCleanupMutationDelayMs);
        }

        if (shouldRunHomePoopTasks()) {
          scheduleHomePoop('mutation', CONFIG.homePoopMutationDelayMs);
        }

        if (shouldRunChannelFilterTasks()) {
          scheduleChannelFilter('mutation');
        }

        if (shouldRunShortsTasks()) {
          syncShortsBanButton();
          scheduleBlockedShortsCheck('mutation');
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

  window.cuSetVolume = function cuSetVolume(sliderPercent) {
    const value = normalizeVolumePercent(sliderPercent);
    setVideoVolumePercent(value, 'console');
    return {
      slider: value,
      actual: sliderPercentToActualVolumePercent(value),
      stored: readStoredVolumePercent(),
    };
  };

  window.cuVolumeInfo = function cuVolumeInfo() {
    const slider = readStoredVolumePercent() ?? CONFIG.volumeDefaultPercent;

    return {
      slider,
      actual: sliderPercentToActualVolumePercent(slider),
      curveEnabled: CONFIG.volumeComfortCurveEnabled,
      exponent: getVolumeCurveExponent(),
      activeSlider: getVideoVolumePercent(getVideo()),
      activeActual: getVideoActualVolumePercent(getVideo()),
      videos: getAllVideos().length,
      shortsVolumeControlVisible: Boolean(state.shortsVolumeSlotEl && state.shortsVolumeSlotEl.style.display !== 'none'),
      shortsVolumePanelVisible: Boolean(state.shortsVolumePanelEl && state.shortsVolumePanelEl.style.display === 'flex'),
      lastSync: state.lastVolumeSyncResult,
    };
  };


  window.cuDebug = function cuDebug() {
    const video = getVideo();
    const player = getPlayer();

    return {
      app: APP_SHORT,
      version: '0.3.24',
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
      volumeActualPercent: getVideoActualVolumePercent(video),
      storedVolumePercent: readStoredVolumePercent(),
      volumeComfortCurveEnabled: CONFIG.volumeComfortCurveEnabled,
      volumeCurveExponent: getVolumeCurveExponent(),
      volumeSyncAllVideos: CONFIG.volumeSyncAllVideos,
      videosCount: getAllVideos().length,
      activeVideoSliderPercent: getVideoVolumePercent(getVideo()),
      activeVideoActualPercent: getVideoActualVolumePercent(getVideo()),
      storedVolumePercentNow: readStoredVolumePercent(),
      storedVolumeActualPercentNow: sliderPercentToActualVolumePercent(readStoredVolumePercent() ?? CONFIG.volumeDefaultPercent),
      shortsVolumeControlVisible: Boolean(state.shortsVolumeSlotEl && state.shortsVolumeSlotEl.style.display !== 'none'),
      shortsVolumePanelVisible: Boolean(state.shortsVolumePanelEl && state.shortsVolumePanelEl.style.display === 'flex'),
      lastVolumeSyncResult: state.lastVolumeSyncResult,
      hasVolumeSlider: Boolean(state.volumeSliderEl),
      hasVolumeTrack: Boolean(state.volumeActiveTrackEl),
      volumeTrackActiveWidth: state.volumeActiveTrackEl ? state.volumeActiveTrackEl.style.width : '',
      fullscreenLayoutFixEnabled: CONFIG.fullscreenLayoutFixEnabled,
      fullscreenLayoutFixRootTag: (state.fullscreenLayoutFixRoot && state.fullscreenLayoutFixRoot.tagName) || '',
      fullscreenHintWatchPagesOnly: CONFIG.fullscreenHintWatchPagesOnly,
      fullscreenHintHideOnShorts: CONFIG.fullscreenHintHideOnShorts,
      fullscreenHintForbiddenPage: isFullscreenHintForbiddenPage(),
      shouldShowFullscreenHint: shouldShowFullscreenHint(),
      fullscreenHintScale: CONFIG.fullscreenHintScale,
      hideYoutubeFullscreenNoise: CONFIG.hideYoutubeFullscreenNoise,
      homePage: isHomePage(),
      homeSafeModePage: isHomeSafeModePage(),
      shouldRunHeavyPlayerTasks: shouldRunHeavyPlayerTasks(),
      shouldRunHomePoopTasks: shouldRunHomePoopTasks(),
      shouldRunHomeCleanupTasks: shouldRunHomeCleanupTasks(),
      shouldRunAmbientShortsCleanupTasks: shouldRunAmbientShortsCleanupTasks(),
      shouldRunChannelFilterTasks: shouldRunChannelFilterTasks(),
      shouldRunVolumeSyncTasks: shouldRunVolumeSyncTasks(),
      homePoopEnabled: CONFIG.homePoopEnabled,
      homeCleanupEnabled: CONFIG.homeCleanupEnabled,
      ambientShortsCleanupEnabled: CONFIG.ambientShortsCleanupEnabled,
      shortsCssCleanupEnabled: CONFIG.shortsCssCleanupEnabled,
      shortsSafeModeEnabled: CONFIG.shortsSafeModeEnabled,
      shortsSafeModePage: isShortsSafeModePage(),
      shortsSafeVolumeSyncEnabled: CONFIG.shortsSafeVolumeSyncEnabled,
      shortsSafeVolumeSyncActive: shouldRunShortsSafeVolumeSync(),
      lastShortsSafeVolumeResult: state.lastShortsSafeVolumeResult,
      shortsRouteClass: document.documentElement?.classList.contains(`${APP_ID}-page-shorts`) ? 'shorts' : 'nonshorts',
      shortsTransitioning: Boolean(document.documentElement?.classList.contains(`${APP_ID}-shorts-transitioning`)),
      homePoopNegativeFeedback: CONFIG.homePoopNegativeFeedback,
      cardFeedbackEnabled: CONFIG.cardFeedbackEnabled,
      lastHomeCleanupResult: state.lastHomeCleanupResult,
      lastAmbientShortsCleanupResult: state.lastAmbientShortsCleanupResult,
      lastHomePoopResult: state.lastHomePoopResult,
      lastCardFeedbackResult: state.lastCardFeedbackResult,
      cardFeedbackBusy: Date.now() < state.cardFeedbackBusyUntilMs,
      homeChipsCleanupEnabled: CONFIG.homeChipsCleanupEnabled,
      channelFilterEnabled: CONFIG.channelFilterEnabled,
      shortsPage: isShortsPage(),
      sourceShortsPage: isSourceShortsPage(),
      currentShortsVideoId: getCurrentShortsVideoId(),
      currentShortsVideoIdParts: getCurrentShortsVideoIdParts(),
      currentShortsVideoIdFromUrl: getShortsVideoIdFromUrl(),
      currentShortsVideoIdFromPlayer: getVideoIdFromPlayerResponse(),
      shortsIdentityRaceGuardEnabled: CONFIG.shortsIdentityRaceGuardEnabled,
      lastShortsIdentityStatus: state.lastShortsIdentityStatus,
      currentShortsChannel: extractCurrentShortsChannelInfo(),
      currentShortsBannedInfo: getCurrentShortsBannedInfo(),
      currentShortsBlacklistCheck: getChannelBanCheck(extractCurrentShortsChannelInfo()),
      lastPoopActionResult: state.lastPoopActionResult,
      shortsSkipBannedChannelsEnabled: CONFIG.shortsSkipBannedChannelsEnabled,
      shortsAdvanceAfterPoopEnabled: CONFIG.shortsAdvanceAfterPoopEnabled,
      lastBlockedShortsResult: state.lastBlockedShortsResult,
      bannedChannelsCount: readBannedChannels().length,
      channelBanButtonText: CONFIG.channelBanButtonText,
      channelBanButtons: document.querySelectorAll(`.${APP_ID}-channel-ban-button`).length,
      shortsBanButtonVisible: Boolean(state.shortsBanButtonEl && state.shortsBanButtonEl.style.display !== 'none'),
      shortsBanButtonPlacement: state.shortsBanButtonEl?.dataset?.cuShortsBanPlacement || '',
      shortsActionBarFound: Boolean(getShortsActionBarRoot()),
      negativeFeedbackEnabled: CONFIG.negativeFeedbackEnabled,
      negativeFeedbackUseMenu: CONFIG.negativeFeedbackUseMenu,
      negativeFeedbackCloseWrongMenu: CONFIG.negativeFeedbackCloseWrongMenu,
      wrongShortsSettingsMenuOpen: isWrongShortsSettingsMenuOpen(),
      shortsDislikeButtonFound: Boolean(findShortsDislikeButton()),
      shortsMoreButtonFound: Boolean(findShortsMoreButton()),
      lastNegativeFeedbackResult: state.lastNegativeFeedbackResult,
      hiddenChannelCards: document.querySelectorAll('[data-cu-channel-hidden="1"]').length,
      videoRect: getVideoRectInfo(),
      hasFullscreenHint: Boolean(state.fsHintEl),
      hasCustomControls: Boolean(state.customControlsEl),
      customControlsVisible: Boolean(state.customControlsEl && state.customControlsEl.style.display !== 'none'),
      fullscreenElementTag: (getFullscreenElement() && getFullscreenElement().tagName) || '',
      launcher: window.cuLauncherInfo?.() || null,
      nativeAdSkipEnabled: CONFIG.nativeAdSkipEnabled,
      nativeAdSkipShouldRun: shouldRunNativeAdSkipTasks(),
      nativeAdPollActive: Boolean(state.nativeAdPollTimer),
      nativeAdSignals: (() => {
        const signals = getNativeAdSignals();
        return {
          playerAdShowing: signals.playerAdShowing,
          playerAdInterrupting: signals.playerAdInterrupting,
          hasSkipButton: Boolean(signals.skipButton),
          hasOverlayCloseButton: Boolean(signals.overlayCloseButton),
          adUi: signals.adUi,
          strong: signals.strong,
          active: signals.active,
        };
      })(),
      lastNativeAdResult: state.nativeAdLastResult,
      sponsorBlockCategories: [...CONFIG.categories],
      sponsorBlockSelfpromoEnabled: CONFIG.categories.includes('selfpromo'),
      sponsorBlockLastFetch: state.lastSponsorBlockFetch,
      sponsorBlockLastError: state.lastSponsorBlockError,
      sponsorBlockLastSkip: state.lastSponsorSkipResult,
      sponsorBlockResolvedVideoId: getSponsorVideoId(),
      sponsorBlockWakeTimerActive: Boolean(state.sponsorWakeTimer),
      sponsorBlockByCategory: (() => {
        const result = {};
        for (const segment of state.segments) {
          result[segment.category] = (result[segment.category] || 0) + 1;
        }
        return result;
      })(),
      segments: state.segments.length,
      loadedVideoId: state.loadedVideoId,
    };
  };


  function makeLauncherTabId() {
    try {
      const stored = sessionStorage.getItem('cu:launcher-tab-id');
      if (stored) return stored;

      const id = globalThis.crypto?.randomUUID?.()
        || `cu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

      sessionStorage.setItem('cu:launcher-tab-id', id);
      return id;
    } catch {
      return `cu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function isLauncherRequest() {
    if (!CONFIG.launcherSingletonEnabled) return false;

    try {
      const url = new URL(location.href);
      return url.searchParams.get(CONFIG.launcherQueryKey) === CONFIG.launcherQueryValue;
    } catch {
      return false;
    }
  }

  function cleanLauncherMarkerFromUrl() {
    try {
      const url = new URL(location.href);

      if (url.searchParams.get(CONFIG.launcherQueryKey) !== CONFIG.launcherQueryValue) {
        return false;
      }

      url.searchParams.delete(CONFIG.launcherQueryKey);

      const query = url.searchParams.toString();
      const clean =
        `${url.pathname}${query ? `?${query}` : ''}${url.hash || ''}`;

      history.replaceState(history.state, '', clean);
      return true;
    } catch {
      return false;
    }
  }

  function launcherRecord(stage, data = {}) {
    state.launcherLastEvent = {
      stage,
      at: new Date().toISOString(),
      ...data,
    };

    log('launcher', state.launcherLastEvent);
    return state.launcherLastEvent;
  }

  function tryFocusCurrentTab() {
    try {
      window.focus();
    } catch {}

    try {
      document.documentElement?.focus?.({ preventScroll: true });
    } catch {}
  }

  function sendLauncherMessage(message) {
    try {
      state.launcherChannel?.postMessage({
        version: 1,
        from: state.launcherTabId,
        href: location.href,
        at: Date.now(),
        ...message,
      });
      return true;
    } catch {
      return false;
    }
  }

  function setupLauncherChannel() {
    if (!CONFIG.launcherSingletonEnabled || typeof BroadcastChannel !== 'function') {
      return false;
    }

    if (state.launcherChannel) return true;

    state.launcherTabId = state.launcherTabId || makeLauncherTabId();
    state.launcherChannel = new BroadcastChannel(CONFIG.launcherChannelName);

    state.launcherChannel.addEventListener('message', (event) => {
      const message = event?.data;

      if (!message || typeof message !== 'object') return;
      if (!message.from || message.from === state.launcherTabId) return;

      if (message.type === 'probe') {
        /*
          Новая launcher-вкладка во время собственного probe ещё не считается
          живой основной вкладкой. Иначе два одновременно открытых ярлыка
          могли бы попытаться закрыть друг друга.
        */
        if (!state.launcherReady) return;

        sendLauncherMessage({
          type: 'alive',
          probeId: message.probeId || '',
          responder: state.launcherTabId,
          title: document.title || '',
          visible: !document.hidden,
        });
        return;
      }

      if (message.type === 'focus' && message.target === state.launcherTabId) {
        launcherRecord('focus-request', { from: message.from });
        tryFocusCurrentTab();
      }
    });

    return true;
  }

  async function probeExistingYoutubeTab() {
    if (!setupLauncherChannel()) {
      return { supported: false, duplicate: false, responder: null };
    }

    const probeId =
      globalThis.crypto?.randomUUID?.()
      || `probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve) => {
      let finished = false;
      let responder = null;

      const finish = () => {
        if (finished) return;
        finished = true;

        try {
          state.launcherChannel?.removeEventListener('message', onMessage);
        } catch {}

        resolve({
          supported: true,
          duplicate: Boolean(responder),
          responder,
        });
      };

      const onMessage = (event) => {
        const message = event?.data;

        if (!message || message.type !== 'alive') return;
        if (message.probeId !== probeId) return;
        if (!message.from || message.from === state.launcherTabId) return;

        responder = {
          id: message.from,
          href: message.href || '',
          title: message.title || '',
          visible: Boolean(message.visible),
        };

        finish();
      };

      state.launcherChannel.addEventListener('message', onMessage);

      sendLauncherMessage({
        type: 'probe',
        probeId,
      });

      setTimeout(finish, CONFIG.launcherProbeWaitMs);
    });
  }

  function closeDuplicateLauncherTab(responder = null) {
    state.launcherDuplicateDetected = true;
    state.launcherResponder = responder;

    launcherRecord('duplicate-detected', { responder });

    if (responder?.id) {
      sendLauncherMessage({
        type: 'focus',
        target: responder.id,
      });
    }

    /*
      Chrome обычно запрещает web-странице закрывать обычную вкладку.
      Но ярлык Android иногда создаёт вкладку с единственной записью истории,
      поэтому пробуем несколько безопасных вариантов. Если браузер всё равно
      возражает, уходим на лёгкую служебную страницу вместо второго YouTube.
    */
    try {
      window.close();
    } catch {}

    setTimeout(() => {
      try {
        window.open('', '_self');
        window.close();
      } catch {}
    }, CONFIG.launcherCloseRetryMs);

    setTimeout(() => {
      try {
        location.replace(CONFIG.launcherFallbackUrl);
      } catch {}
    }, CONFIG.launcherCloseRetryMs * 3);
  }

  async function initLauncherSingleton() {
    state.launcherTabId = state.launcherTabId || makeLauncherTabId();
    state.launcherWasRequest = isLauncherRequest();

    setupLauncherChannel();

    if (!state.launcherWasRequest) {
      state.launcherReady = true;
      launcherRecord('normal-tab-ready');
      return { duplicate: false, launcher: false };
    }

    launcherRecord('launcher-probe-start');

    const result = await probeExistingYoutubeTab();

    if (result.duplicate) {
      closeDuplicateLauncherTab(result.responder);
      return { duplicate: true, launcher: true, responder: result.responder };
    }

    cleanLauncherMarkerFromUrl();
    state.launcherReady = true;

    launcherRecord('launcher-became-primary', {
      broadcastSupported: result.supported,
    });

    return { duplicate: false, launcher: true };
  }

  window.cuLauncherInfo = function cuLauncherInfo() {
    return {
      enabled: CONFIG.launcherSingletonEnabled,
      tabId: state.launcherTabId,
      ready: state.launcherReady,
      wasLauncherRequest: state.launcherWasRequest,
      duplicateDetected: state.launcherDuplicateDetected,
      responder: state.launcherResponder,
      broadcastChannel: typeof BroadcastChannel === 'function',
      lastEvent: state.launcherLastEvent,
      href: location.href,
    };
  };


  async function init() {
    const launcherState = await initLauncherSingleton();

    if (launcherState?.duplicate) {
      return;
    }

    state.currentUrl = location.href;
    state.wasLandscape = isLandscape();

    updateShortsRouteClass('init');
    installRouteWatchers();
    installFullscreenWatchers();
    installDoubleTapSeek();
    installMutationObserver();
    syncNativeAdPoll('init');
    ensureHomeCleanupStyle();
    bindHomePreviewStopper();
    bindShortsSafeVolumeSync();
    bindGlobalSponsorMediaSignals();

    if (isShortsSafeModePage()) {
      stopShortsRuntimeTasks('init');
      scheduleShortsSafeVolume('init-shorts', 0);
    } else {
      scheduleBind();
    }

    if (!isShortsSafeModePage() && shouldRunVolumeSyncTasks()) {
      scheduleVolumeSync('init', true);
    }

    if (!isShortsSafeModePage() && shouldRunHeavyPlayerTasks()) {
      scheduleRefresh('init');
      syncFullscreenSoon('init');
    }

    scheduleHomeChipsCleanup('init');

    if (shouldRunHomeCleanupTasks()) {
      scheduleHomeCleanup('init');
    }

    if (shouldRunHomePoopTasks()) {
      scheduleHomePoop('init');
    }

    if (shouldRunChannelFilterTasks()) {
      scheduleChannelFilter('init');
    }

    if (!isShortsSafeModePage() && shouldRunShortsTasks()) {
      syncShortsBanButton();
      scheduleBlockedShortsCheck('init');
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopNativeAdPoll('hidden');
        return;
      }

      if (!document.hidden) {
        if (isShortsSafeModePage()) {
          stopShortsRuntimeTasks('visibility');
          scheduleShortsSafeVolume('visibility-shorts', 0);
          return;
        }

        syncNativeAdPoll('visibility');
        scheduleBind();

        if (shouldRunHeavyPlayerTasks()) {
          scheduleRefresh('visibility');
          syncFullscreenSoon('visibility');
          syncCustomControls('visibility');
        }

        if (shouldRunVolumeSyncTasks()) {
          scheduleVolumeSync('visibility', true);
        }

        scheduleHomeChipsCleanup('visibility');

        if (shouldRunHomeCleanupTasks()) {
          scheduleHomeCleanup('visibility');
        }

        if (shouldRunHomePoopTasks()) {
          scheduleHomePoop('visibility');
        }

        if (shouldRunChannelFilterTasks()) {
          scheduleChannelFilter('visibility');
        }

        if (shouldRunShortsTasks()) {
          syncShortsBanButton();
          scheduleBlockedShortsCheck('visibility');
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void init();
    }, { once: true });
  } else {
    void init();
  }
})();
