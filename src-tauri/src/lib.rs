use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl,
};

const SOUND_CLOUD_LINK_EVENT: &str = "soundcloud-link";
const SOUND_CLOUD_ACCOUNT_EVENT: &str = "soundcloud-account";
const SOUND_CLOUD_PLAYER_EVENT: &str = "soundcloud-player-state";
const SHELL_ROUTE_EVENT: &str = "navigate-shell";
const SOUND_CLOUD_WEBVIEW_LABEL: &str = "soundcloud-site";
const SOUND_CLOUD_PLAYER_TITLE_PREFIX: &str = "SC_WRAPPER_PLAYER_STATE:";
const SOUND_CLOUD_APP_MODE_SCRIPT: &str = r#"
(() => {
  if (!/(^|\.)soundcloud\.com$/i.test(window.location.hostname)) {
    return;
  }

  if (window.__SC_WRAPPER_APP_MODE__) {
    window.__SC_WRAPPER_APP_MODE__.run();
    return;
  }

  const normalize = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const navigateInPlace = (value) => {
    if (!value) {
      return;
    }

    try {
      window.location.assign(new URL(String(value), window.location.href).href);
    } catch (_) {
      window.location.assign(String(value));
    }
  };

  const createPopupProxy = () => {
    const locationProxy = {};
    const popup = {
      closed: false,
      close() {
        this.closed = true;
      },
      focus() {},
      blur() {},
      postMessage() {}
    };

    Object.defineProperty(locationProxy, 'href', {
      get() {
        return 'about:blank';
      },
      set(value) {
        navigateInPlace(value);
      }
    });

    locationProxy.assign = navigateInPlace;
    locationProxy.replace = navigateInPlace;

    Object.defineProperty(popup, 'location', {
      get() {
        return locationProxy;
      },
      set(value) {
        navigateInPlace(value);
      }
    });

    return popup;
  };

  const installPopupBridge = () => {
    if (window.__SC_WRAPPER_POPUP_BRIDGE__) {
      return;
    }

    const popupLikeHosts = [
      'accounts.google.com',
      'facebook.com',
      'www.facebook.com',
      'appleid.apple.com',
      'secure.soundcloud.com'
    ];
    const originalOpen = window.open ? window.open.bind(window) : null;

    window.open = (url, target, features) => {
      const nextUrl = String(url || '');
      const popup = createPopupProxy();

      if (!nextUrl || nextUrl === 'about:blank') {
        return popup;
      }

      try {
        const parsed = new URL(nextUrl, window.location.href);
        const host = parsed.hostname.toLowerCase();
        const isOauthFlow =
          popupLikeHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)) ||
          parsed.pathname.toLowerCase().includes('oauth') ||
          parsed.search.toLowerCase().includes('oauth');

        if (isOauthFlow || target === '_blank') {
          navigateInPlace(parsed.href);
          return popup;
        }
      } catch (_) {
        navigateInPlace(nextUrl);
        return popup;
      }

      if (originalOpen) {
        const opened = originalOpen(url, target, features);
        return opened || popup;
      }

      navigateInPlace(nextUrl);
      return popup;
    };

    document.addEventListener(
      'click',
      (event) => {
        const link = event.target instanceof Element ? event.target.closest('a[target="_blank"], a[href*="oauth"], a[href*="accounts.google.com"], a[href*="facebook.com"], a[href*="appleid.apple.com"]') : null;
        if (!(link instanceof HTMLAnchorElement) || !link.href) {
          return;
        }

        event.preventDefault();
        navigateInPlace(link.href);
      },
      true
    );

    window.__SC_WRAPPER_POPUP_BRIDGE__ = true;
  };

  const ensureStyles = () => {
    let style = document.getElementById('sc-wrapper-app-mode-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'sc-wrapper-app-mode-style';
      document.documentElement.appendChild(style);
    }

    style.textContent = `
      html.sc-wrapper-app-mode,
      html.sc-wrapper-app-mode body {
        height: auto !important;
        min-width: 0 !important;
        background: #0e0e10 !important;
        overflow-x: hidden !important;
      }

      html.sc-wrapper-app-mode body {
        min-height: 100vh !important;
        overflow-y: auto !important;
        padding-top: 0 !important;
      }

      html.sc-wrapper-app-mode,
      html.sc-wrapper-app-mode body,
      html.sc-wrapper-app-mode #content,
      html.sc-wrapper-app-mode .l-container,
      html.sc-wrapper-app-mode .l-content,
      html.sc-wrapper-app-mode .l-fluid-fixed,
      html.sc-wrapper-app-mode .l-main {
        scrollbar-width: thin !important;
        scrollbar-color: #737373 transparent !important;
      }

      html.sc-wrapper-app-mode #content,
      html.sc-wrapper-app-mode .l-container,
      html.sc-wrapper-app-mode .l-content,
      html.sc-wrapper-app-mode .l-fluid-fixed,
      html.sc-wrapper-app-mode .l-main {
        height: auto !important;
        overflow: visible !important;
      }

      html.sc-wrapper-app-mode .header,
      html.sc-wrapper-app-mode .header__inner,
      html.sc-wrapper-app-mode body > header,
      html.sc-wrapper-app-mode [role="banner"],
      html.sc-wrapper-app-mode .l-footer,
      html.sc-wrapper-app-mode footer,
      html.sc-wrapper-app-mode .mobileApps,
      html.sc-wrapper-app-mode .mobileAppTeaser,
      html.sc-wrapper-app-mode .sidebarModule,
      html.sc-wrapper-app-mode .listenEngagement,
      html.sc-wrapper-app-mode .announcements,
      html.sc-wrapper-app-mode .announcement,
      html.sc-wrapper-app-mode [class*="Announcement"],
      html.sc-wrapper-app-mode [class*="announcement"],
      html.sc-wrapper-app-mode .privacyPolicy__banner {
        display: none !important;
      }

      html.sc-wrapper-app-mode #content,
      html.sc-wrapper-app-mode .l-container,
      html.sc-wrapper-app-mode .l-content,
      html.sc-wrapper-app-mode .l-fluid-fixed,
      html.sc-wrapper-app-mode .l-main {
        width: 100% !important;
        max-width: none !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }

      html.sc-wrapper-app-mode .l-sidebar-right,
      html.sc-wrapper-app-mode .l-sidebar-left {
        display: none !important;
      }

      html.sc-wrapper-app-mode .l-main {
        margin-right: 0 !important;
      }

      html.sc-wrapper-app-mode .playControls,
      html.sc-wrapper-app-mode .playControls__inner {
        display: none !important;
      }
    `;
  };

  const hideChromeByText = () => {
    const blockedText = [
      'go mobile',
      'download on the app store',
      'get it on google play',
      'legal privacy cookie policy',
      'imprint artist resources newsroom',
      'language: english'
    ];

    const nodes = Array.from(document.querySelectorAll('aside, footer, .l-sidebar-right, .l-sidebar-left, .mobileApps, .mobileAppTeaser'));
    for (const node of nodes) {
      const text = normalize(node.textContent || '');
      if (!text || text.includes('discover tracks and playlists') || text.includes('trending by genre')) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (rect.width > 520 && rect.height > 420) {
        continue;
      }

      const shouldHide = blockedText.some((marker) => text.includes(marker));
      if (shouldHide && node instanceof HTMLElement) {
        node.style.display = 'none';
      }
    }
  };

  const hideSiteNavigation = () => {
    const selectorCandidates = Array.from(document.querySelectorAll(
      'header, nav, [role="banner"], [class*="Header"], [class*="header"], [class*="Navigation"], [class*="navigation"], [class*="topbar"], [class*="Topbar"]'
    )).slice(0, 40);

    for (const node of selectorCandidates) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (rect.top <= 180 && rect.width >= 360 && rect.height <= 180) {
        node.style.display = 'none';
      }
    }

    const textCandidates = Array.from(document.querySelectorAll('body > div, body > section, #content > div, .l-container > div')).slice(0, 80);
    for (const node of textCandidates) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (rect.top > 180 || rect.width < 520 || rect.height > 180) {
        continue;
      }

      const text = normalize(node.textContent || '');
      const hasPrimaryNav = text.includes('home') && text.includes('feed') && text.includes('library');
      const hasAccountNav = text.includes('sign in') && text.includes('create account') && text.includes('upload');
      const hasSearch = text.includes('search for artists') || text.includes('search for artist');

      if (hasPrimaryNav && (hasAccountNav || hasSearch)) {
        node.style.display = 'none';
      }
    }
  };

  const hideTopPromos = () => {
    const candidates = Array.from(document.querySelectorAll('body > div, #content > div, [class*="Announcement"], [class*="announcement"]')).slice(0, 80);

    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (rect.top > 220 || rect.height > 140 || rect.width < 360) {
        continue;
      }

      const text = normalize(node.textContent || '');
      if (
        text.includes('now available') ||
        text.includes('get heard by up to') ||
        text.includes('artist or artist pro')
      ) {
        node.style.display = 'none';
      }
    }
  };

  const findAction = () => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
    const preferred = ['reject all', 'reject'];
    const fallback = ['i accept', 'accept all', 'accept'];

    for (const label of preferred) {
      const match = candidates.find((element) => normalize(element.textContent || '') === label);
      if (match) {
        return match;
      }
    }

    for (const label of fallback) {
      const match = candidates.find((element) => normalize(element.textContent || '') === label);
      if (match) {
        return match;
      }
    }

    return null;
  };

  const dismissResidualOverlay = () => {
    const markers = ['cookies & tracking', 'personalized ads'];
    const nodes = Array.from(document.querySelectorAll('div, section, aside'));
    const overlay = nodes.find((node) => {
      const text = normalize(node.textContent || '');
      return markers.every((marker) => text.includes(marker));
    });

    if (overlay instanceof HTMLElement) {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
    }
  };

  const installPlayerStateBridge = () => {
    if (window.__SC_WRAPPER_PLAYER_STATE_BRIDGE__) {
      return;
    }

    const textFrom = (selectors) => {
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        const text = normalize(node?.textContent || '');
        if (text) {
          return node.textContent.replace(/\s+/g, ' ').trim();
        }
      }
      return '';
    };

    const cleanTrackTitleText = (value) => {
      let text = String(value || '')
        .replace(/^current track:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      for (let index = Math.floor(text.length / 2); index > 2; index -= 1) {
        const first = text.slice(0, index).trim();
        const second = text.slice(index).trim();
        if (first && first === second) {
          text = first;
          break;
        }
      }

      return text;
    };

    const titleFrom = (selectors) => {
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) {
          continue;
        }

        const candidates = [
          node.getAttribute?.('title'),
          node.getAttribute?.('aria-label'),
          node.textContent
        ];

        for (const candidate of candidates) {
          const text = cleanTrackTitleText(candidate);
          if (text) {
            return text;
          }
        }
      }

      return '';
    };

    const parseTime = (value) => {
      const parts = String(value || '').split(':').map((part) => Number(part));
      if (parts.some((part) => Number.isNaN(part))) {
        return 0;
      }

      return parts.reduce((total, part) => total * 60 + part, 0);
    };

    const imageFrom = () => {
      const image = document.querySelector('.playbackSoundBadge__avatar img, .playbackSoundBadge__avatar .image__full');
      if (image instanceof HTMLImageElement && image.src) {
        return image.src;
      }

      const background = document.querySelector('.playbackSoundBadge__avatar [style*="background-image"], .playbackSoundBadge__avatar span');
      if (background instanceof HTMLElement) {
        const match = window.getComputedStyle(background).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
        return match?.[1] || '';
      }

      return '';
    };

    const imageFromNode = (node) => {
      const image = node.querySelector('img');
      if (image instanceof HTMLImageElement && image.src) {
        return image.src;
      }

      const background = node.querySelector('[style*="background-image"]');
      if (background instanceof HTMLElement) {
        const match = window.getComputedStyle(background).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
        return match?.[1] || '';
      }

      return '';
    };

    const textIn = (node, selectors) => {
      for (const selector of selectors) {
        const match = node.querySelector(selector);
        const text = match?.textContent?.replace(/\s+/g, ' ').trim();
        if (text) {
          return text;
        }
      }

      return '';
    };

    const queueItems = (currentTrack) => {
      const candidates = Array.from(document.querySelectorAll(
        '.playQueue__item, .playQueueItem, .queueItem, .queue__item, [class*="playQueue"] li, [class*="Queue"] [role="option"]'
      ));
      const rows = candidates
        .filter((node) => node instanceof HTMLElement)
        .filter((node) => {
          const text = normalize(node.textContent || '');
          const rect = node.getBoundingClientRect();
          return text && !text.includes('next up') && rect.width > 80;
        })
        .slice(0, 20);

      if (!rows.length) {
        return currentTrack.title && currentTrack.title !== 'SoundCloud Web Player'
          ? [{ ...currentTrack, id: 'current-track', isCurrent: true }]
          : [];
      }

      return rows.map((row, index) => {
        const title =
          cleanTrackTitleText(textIn(row, ['.playQueueItem__trackTitle', '.queueItem__title', '[class*="title"]', 'a[href*="/"]'])) ||
          'SoundCloud track';
        const artist =
          textIn(row, ['.playQueueItem__username', '.queueItem__artist', '[class*="username"]', '[class*="artist"]']) ||
          '';
        const duration =
          textIn(row, ['.playQueueItem__duration', '.queueItem__duration', '[class*="duration"]', 'time']) ||
          '';
        const href = row.querySelector('a[href*="/"]')?.getAttribute('href') || '';
        const source = normalize(`${row.className || ''} ${row.getAttribute('aria-selected') || ''}`);

        return {
          id: href || `${title}-${artist}-${index}`,
          title,
          artist,
          duration,
          artworkUrl: imageFromNode(row),
          isCurrent: index === 0 || source.includes('selected') || source.includes('active') || title === currentTrack.title
        };
      });
    };

    const controlState = (selectors) => {
      const nodes = selectors
        .map((selector) => document.querySelector(selector))
        .filter((node) => node instanceof HTMLElement);
      const node = nodes[0];
      if (!node) {
        return { active: false, mode: 'off' };
      }

      const source = normalize([
        node.className || '',
        node.getAttribute('aria-label') || '',
        node.getAttribute('title') || '',
        node.getAttribute('aria-pressed') || '',
        node.getAttribute('data-testid') || ''
      ].join(' '));
      const isPressed = node.getAttribute('aria-pressed') === 'true';
      const isOff =
        node.getAttribute('aria-pressed') === 'false' ||
        /\bm-none\b/.test(source) ||
        /\boff\b/.test(source) ||
        source.includes('disabled') ||
        source.includes('inactive');
      const isRepeatOne =
        /\bm-one\b/.test(source) ||
        source.includes('repeat one') ||
        source.includes('repeat current') ||
        source.includes('repeat single');
      const isActive =
        !isOff &&
        (isPressed ||
          /\bm-active\b/.test(source) ||
          /\bm-all\b/.test(source) ||
          /\bm-shuffling\b/.test(source) ||
          source.includes('enabled') ||
          source.includes('active'));

      return {
        active: isActive || isRepeatOne,
        mode: isRepeatOne ? 'one' : isActive ? 'all' : 'off'
      };
    };

    const playbackState = () => {
      const audio = Array.from(document.querySelectorAll('audio')).find((element) => Number.isFinite(element.duration));
      if (audio) {
        return !audio.paused && !audio.ended;
      }

      const control = document.querySelector('.playControl, .playControls__play, [aria-label="Play"], [aria-label="Pause"]');
      const source = normalize(`${control?.className || ''} ${control?.getAttribute?.('aria-label') || ''} ${control?.getAttribute?.('title') || ''}`);
      return source.includes('pause') || source.includes('playing') || source.includes('m-playing');
    };

    const percentFromStyle = (selectors) => {
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!(node instanceof HTMLElement)) {
          continue;
        }

        const style = window.getComputedStyle(node);
        for (const value of [style.width, style.height, node.style.width, node.style.height]) {
          const match = String(value || '').match(/^(\d+(?:\.\d+)?)%$/);
          if (match) {
            return Number(match[1]);
          }
        }
      }

      return Number.NaN;
    };

    const volumeState = () => {
      const button = document.querySelector('.volume__button, .volume button, [aria-label="Volume"], [aria-label="Mute"], [aria-label="Unmute"]');
      const buttonSource = normalize(`${button?.className || ''} ${button?.getAttribute?.('aria-label') || ''} ${button?.getAttribute?.('title') || ''}`);
      const audio = Array.from(document.querySelectorAll('audio')).find((element) => Number.isFinite(element.volume));
      const slider = document.querySelector('.volume__sliderWrapper [role="slider"], .volume [role="slider"], [aria-label*="Volume"][role="slider"]');
      const sliderValue = Number(slider?.getAttribute('aria-valuenow'));
      const styleValue = percentFromStyle(['.volume__sliderProgress', '.volume__sliderHandle', '.volume__sliderWrapper [style*="%"]']);
      const audioValue = audio && Number.isFinite(audio.volume) ? Math.round(audio.volume * 100) : Number.NaN;
      const rememberedValue = Number(window.__SC_WRAPPER_LAST_VOLUME__);
      const value = Number.isFinite(audioValue) && audioValue > 0
        ? audioValue
        : Number.isFinite(rememberedValue) && rememberedValue > 0
          ? rememberedValue
          : Number.isFinite(sliderValue) && sliderValue > 0
            ? sliderValue
            : Number.isFinite(styleValue) && styleValue > 0
              ? styleValue
              : Number.isFinite(audioValue)
                ? audioValue
                : Number.isFinite(sliderValue)
                  ? sliderValue
                  : Number.isFinite(styleValue)
                    ? styleValue
                    : 38;
      const hasAudioState = audio && Number.isFinite(audio.volume);
      const muted = hasAudioState
        ? Boolean(audio.muted || (audio.volume <= 0 && value <= 0))
        : buttonSource.includes('unmute') || buttonSource.includes('muted') || buttonSource.includes('m-muted');

      return {
        muted,
        volume: Math.max(0, Math.min(100, value))
      };
    };

    const readState = () => {
      const currentTime = textFrom(['.playbackTimeline__timePassed span[aria-hidden="true"]', '.playbackTimeline__timePassed']) || '0:00';
      const duration = textFrom(['.playbackTimeline__duration span[aria-hidden="true"]', '.playbackTimeline__duration']) || '--:--';
      const elapsedSeconds = parseTime(currentTime);
      const durationSeconds = parseTime(duration);
      const progress = durationSeconds > 0 ? Math.round((elapsedSeconds / durationSeconds) * 1000) / 10 : 0;
      const shuffleState = controlState(['.shuffleControl', '[aria-label*="Shuffle"]', '[title*="Shuffle"]']);
      const repeatState = controlState(['.repeatControl', '[aria-label*="Repeat"]', '[title*="Repeat"]']);
      const volume = volumeState();
      const currentTrack = {
        title: titleFrom(['.playbackSoundBadge__titleLink', '.playbackSoundBadge__title', '.playbackSoundBadge a[href*="/"]']) || 'SoundCloud Web Player',
        artist: textFrom(['.playbackSoundBadge__lightLink', '.playbackSoundBadge__usernameLink']) || 'Playing from the website',
        artworkUrl: imageFrom(),
        duration
      };

      return {
        title: currentTrack.title,
        artist: currentTrack.artist,
        artworkUrl: currentTrack.artworkUrl,
        currentTime,
        duration,
        volume: volume.volume,
        isMuted: volume.muted,
        isPlaying: playbackState(),
        shuffleEnabled: shuffleState.active,
        repeatMode: repeatState.mode,
        queueItems: queueItems(currentTrack),
        progress: Math.max(0, Math.min(100, progress))
      };
    };

    let lastState = '';
    const publish = () => {
      const state = JSON.stringify(readState());
      if (state === lastState) {
        return;
      }

      lastState = state;
      document.title = `SC_WRAPPER_PLAYER_STATE:${state}`;
    };

    publish();
    window.setInterval(publish, 1000);
    window.__SC_WRAPPER_PLAYER_STATE_BRIDGE__ = true;
  };

  const run = () => {
    document.documentElement.classList.add('sc-wrapper-app-mode');
    ensureStyles();
    hideSiteNavigation();
    hideTopPromos();
    hideChromeByText();
    installPlayerStateBridge();

    const action = findAction();
    if (action instanceof HTMLElement) {
      action.click();
      window.setTimeout(dismissResidualOverlay, 120);
      return true;
    }

    dismissResidualOverlay();
    return false;
  };

  let pending = false;
  let runCount = 0;
  const scheduleRun = () => {
    if (pending || runCount >= 18) {
      return;
    }

    pending = true;
    window.setTimeout(() => {
      pending = false;
      runCount += 1;
      run();

      if (runCount >= 18) {
        observer.disconnect();
      }
    }, 180);
  };

  const observer = new MutationObserver(scheduleRun);

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', run, { passive: true });
  window.setTimeout(run, 250);
  window.setTimeout(run, 1200);
  window.setTimeout(run, 2800);
  window.setTimeout(() => observer.disconnect(), 9000);

  window.__SC_WRAPPER_APP_MODE__ = {
    run,
    disconnect() {
      observer.disconnect();
    }
  };
})();
"#;

const SOUND_CLOUD_POPUP_BOOTSTRAP_SCRIPT: &str = r#"
(() => {
  if (!/(^|\.)soundcloud\.com$/i.test(window.location.hostname)) {
    return;
  }

  window.__SC_WRAPPER_NATIVE_POPUPS__ = true;
})();
"#;

#[tauri::command]
async fn create_soundcloud_webview(
    app: tauri::AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview(SOUND_CLOUD_WEBVIEW_LABEL) {
        let _ = existing.close();
    }

    let parsed_url = url.parse().map_err(|error| format!("Invalid SoundCloud URL: {error}"))?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window is not available".to_string())?;

    let app_handle = app.clone();
    let app_for_player_state = app.clone();
    let builder = WebviewBuilder::new(
        SOUND_CLOUD_WEBVIEW_LABEL,
        WebviewUrl::External(parsed_url),
    )
    .data_directory("soundcloud-wrapper-session".into())
    .initialization_script(SOUND_CLOUD_POPUP_BOOTSTRAP_SCRIPT)
    .on_document_title_changed(move |_webview, title| {
        if let Some(payload) = title.strip_prefix(SOUND_CLOUD_PLAYER_TITLE_PREFIX) {
            let _ = app_for_player_state.emit(SOUND_CLOUD_PLAYER_EVENT, payload.to_string());
        }
    })
    .on_new_window(move |url, features| {
        let app_for_popup = app_handle.clone();
        let saw_external_auth_page = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let saw_external_auth_page_for_load = saw_external_auth_page.clone();
        let label = format!(
            "soundcloud-oauth-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or_default()
        );
        let window = tauri::WebviewWindowBuilder::new(
            &app_handle,
            label,
            WebviewUrl::External("about:blank".parse().expect("valid about:blank URL")),
        )
        .data_directory("soundcloud-wrapper-session".into())
        .window_features(features)
        .title(url.as_str())
        .on_page_load(move |window, payload| {
            let url = payload.url();
            let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
            let is_soundcloud = host == "soundcloud.com" || host.ends_with(".soundcloud.com");
            let is_blank = url.as_str() == "about:blank";

            if !is_soundcloud && !is_blank {
                saw_external_auth_page_for_load.store(true, std::sync::atomic::Ordering::Relaxed);
                return;
            }

            if payload.event() == PageLoadEvent::Finished
                && is_soundcloud
                && saw_external_auth_page_for_load.load(std::sync::atomic::Ordering::Relaxed)
            {
                let _ = app_for_popup.emit(SOUND_CLOUD_ACCOUNT_EVENT, "signed-in");
                let _ = window.close();
                if let Some(webview) = app_for_popup.get_webview(SOUND_CLOUD_WEBVIEW_LABEL) {
                    let _ = webview.eval("window.location.reload()");
                }
            }
        })
        .build()
        .expect("failed to create OAuth window");

        NewWindowResponse::Create { window }
    });

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|error| error.to_string())?;

    webview
        .set_auto_resize(true)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn set_soundcloud_webview_bounds(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app
        .get_webview(SOUND_CLOUD_WEBVIEW_LABEL)
        .ok_or_else(|| "SoundCloud webview is not available yet".to_string())?;

    webview
        .set_position(LogicalPosition::new(x, y))
        .and_then(|_| webview.set_size(LogicalSize::new(width, height)))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn close_soundcloud_webview(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(SOUND_CLOUD_WEBVIEW_LABEL) {
        webview.close().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn control_soundcloud_player(app: tauri::AppHandle, action: String) -> Result<(), String> {
    let selector = match action.as_str() {
        "previous" => ".skipControl__previous, [aria-label='Previous']",
        "toggle" => ".playControl, .playControls__play, [aria-label='Play'], [aria-label='Pause']",
        "next" => ".skipControl__next, [aria-label='Next']",
        "shuffle" => ".shuffleControl, [aria-label='Shuffle']",
        "repeat" => ".repeatControl, [aria-label='Repeat']",
        "like" => ".playbackSoundBadge__like button, .sc-button-like, [aria-label='Like']",
        "volume" => ".volume__button, .volume button, [aria-label='Volume']",
        _ => return Err(format!("Unsupported player action: {action}")),
    };

    let webview = app
        .get_webview(SOUND_CLOUD_WEBVIEW_LABEL)
        .ok_or_else(|| "SoundCloud webview is not available yet".to_string())?;
    let script = format!(
        r#"
(() => {{
  const selector = {selector:?};
  const control = document.querySelector(selector);
  if (control instanceof HTMLElement) {{
    control.click();
  }}
}})();
"#
    );

    webview.eval(&script).map_err(|error| error.to_string())
}

#[tauri::command]
fn seek_soundcloud_player(app: tauri::AppHandle, progress: f64) -> Result<(), String> {
    let progress = progress.clamp(0.0, 100.0) / 100.0;
    let webview = app
        .get_webview(SOUND_CLOUD_WEBVIEW_LABEL)
        .ok_or_else(|| "SoundCloud webview is not available yet".to_string())?;
    let script = format!(
        r#"
(() => {{
  const progress = {progress};
  const controls = Array.from(document.querySelectorAll('.playControls, .playControls__inner, .playbackTimeline'))
    .filter((element) => element instanceof HTMLElement);
  const previousStyles = controls.map((element) => [
    element,
    element.getAttribute('style')
  ]);

  for (const element of controls) {{
    element.style.setProperty('display', 'block', 'important');
    element.style.setProperty('visibility', 'hidden', 'important');
    element.style.setProperty('opacity', '0', 'important');
    element.style.setProperty('pointer-events', 'none', 'important');
  }}

  const selectors = [
    '.playbackTimeline__progressWrapper',
    '.playbackTimeline__progressBackground',
    '.playbackTimeline__progress',
    '.playbackTimeline__slider',
    '[class*="playbackTimeline"] [role="slider"]'
  ];
  const timeline = selectors
    .map((selector) => document.querySelector(selector))
    .find((element) => element instanceof HTMLElement && element.getBoundingClientRect().width > 0);

  if (!(timeline instanceof HTMLElement)) {{
    for (const [element, style] of previousStyles) {{
      if (style === null) {{
        element.removeAttribute('style');
      }} else {{
        element.setAttribute('style', style);
      }}
    }}
    return;
  }}

  const rect = timeline.getBoundingClientRect();
  const x = rect.left + rect.width * progress;
  const y = rect.top + rect.height / 2;

  const dispatchMouse = (eventName, buttons) => {{
    timeline.dispatchEvent(new MouseEvent(eventName, {{
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons
    }}));
  }};

  const dispatchPointer = (eventName, buttons) => {{
    if (typeof PointerEvent !== 'function') {{
      return;
    }}

    timeline.dispatchEvent(new PointerEvent(eventName, {{
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    }}));
  }};

  dispatchPointer('pointermove', 0);
  dispatchMouse('mousemove', 0);
  dispatchPointer('pointerdown', 1);
  dispatchMouse('mousedown', 1);
  dispatchPointer('pointermove', 1);
  dispatchMouse('mousemove', 1);
  dispatchPointer('pointerup', 0);
  dispatchMouse('mouseup', 0);
  dispatchMouse('click', 0);

  window.setTimeout(() => {{
    for (const [element, style] of previousStyles) {{
      if (style === null) {{
        element.removeAttribute('style');
      }} else {{
        element.setAttribute('style', style);
      }}
    }}
  }}, 100);
}})();
"#
    );

    webview.eval(&script).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_soundcloud_volume(app: tauri::AppHandle, volume: f64) -> Result<(), String> {
    let volume = volume.clamp(0.0, 100.0) / 100.0;
    let webview = app
        .get_webview(SOUND_CLOUD_WEBVIEW_LABEL)
        .ok_or_else(|| "SoundCloud webview is not available yet".to_string())?;
    let script = format!(
        r#"
(() => {{
  const volume = {volume};
  window.__SC_WRAPPER_LAST_VOLUME__ = Math.round(volume * 100);
  const audios = Array.from(document.querySelectorAll('audio'));
  if (audios.length) {{
    for (const audio of audios) {{
      audio.volume = volume;
      audio.muted = false;
      audio.dispatchEvent(new Event('volumechange', {{ bubbles: true }}));
    }}
  }}

  const slider = document.querySelector(
    '.volume__sliderWrapper [role="slider"], .volume [role="slider"], .volume__sliderWrapper, [aria-label*="Volume"][role="slider"]'
  );
  if (!(slider instanceof HTMLElement)) {{
    return;
  }}

  const rect = slider.getBoundingClientRect();
  const x = rect.left + rect.width * volume;
  const y = rect.top + rect.height / 2;
  const eventOptions = {{
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y
  }};

  for (const eventName of ['pointerdown', 'mousedown', 'mouseup', 'click']) {{
    slider.dispatchEvent(new MouseEvent(eventName, eventOptions));
  }}
}})();
"#
    );

    webview.eval(&script).map_err(|error| error.to_string())
}

#[tauri::command]
fn apply_soundcloud_app_mode(app: tauri::AppHandle) -> Result<(), String> {
    let webview = app
        .get_webview(SOUND_CLOUD_WEBVIEW_LABEL)
        .ok_or_else(|| "SoundCloud webview is not available yet".to_string())?;

    webview
        .eval(SOUND_CLOUD_APP_MODE_SCRIPT)
        .map_err(|error| error.to_string())
}

fn parse_soundcloud_arg(args: &[String]) -> Option<String> {
    args.iter()
        .find(|arg| {
            arg.starts_with("https://soundcloud.com/")
                || arg.starts_with("http://soundcloud.com/")
                || arg.starts_with("https://on.soundcloud.com/")
                || arg.starts_with("http://on.soundcloud.com/")
        })
        .cloned()
}

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_soundcloud_link<R: Runtime>(app: &tauri::AppHandle<R>, url: String) {
    let _ = app.emit(SOUND_CLOUD_LINK_EVENT, url);
}

fn build_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show SoundCloud App", true, None::<&str>)?;
    let settings_item =
        MenuItem::with_id(app, "settings", "Open Settings", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("SoundCloud App")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "settings" => {
                show_main_window(app);
                let _ = app.emit(SHELL_ROUTE_EVENT, "settings");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                show_main_window(app);

                if let Some(url) = parse_soundcloud_arg(&args) {
                    emit_soundcloud_link(app, url);
                }
            }))
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            apply_soundcloud_app_mode,
            create_soundcloud_webview,
            set_soundcloud_webview_bounds,
            close_soundcloud_webview,
            control_soundcloud_player,
            seek_soundcloud_player,
            set_soundcloud_volume
        ])
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(desktop)]
            build_tray(app.handle())?;

            let launch_args: Vec<String> = std::env::args().collect();
            if let Some(url) = parse_soundcloud_arg(&launch_args) {
                emit_soundcloud_link(app.handle(), url);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
