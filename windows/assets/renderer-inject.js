(function () {
  "use strict";

  var ROOT_CLASSES = [
    "opencode-dream-skin", "dream-theme-light", "dream-theme-dark",
    "dream-art-wide", "dream-art-standard", "dream-focus-left",
    "dream-focus-center", "dream-focus-right", "dream-safe-left",
    "dream-safe-center", "dream-safe-right", "dream-safe-none",
    "dream-task-ambient", "dream-task-banner", "dream-task-off",
  ];
  var HOME_CLASS = "dream-home";
  var TASK_CLASS = "dream-task";
  var ACTIVE_HOME_CLASS = "dream-active-home";

  var THEME = JSON.parse('__DREAM_THEME_JSON__');
  var CSS = "__DREAM_CSS_JSON__";
  var ART = '__DREAM_ART_JSON__';

  var state = window.__OPENCODE_DREAM_SKIN_STATE__;
  if (state && state.cleanup) state.cleanup();

  var root = document.documentElement;
  if (!root || !document.body) return;

  var appearance = (function () {
    var ds = root.getAttribute("data-color-scheme") || "";
    var dt = root.getAttribute("data-theme") || "";
    return ds.indexOf("dark") !== -1 || dt.indexOf("dark") !== -1 ? "dark" : "light";
  })();

  // ── Settings persistence ──
  var SETTINGS_KEY = "dream-skin-settings";
  var defaultSettings = {
    blur: 3, brightness: 100, contrast: 100, saturate: 100,
    containerAlpha: 65, titlebarAlpha: 75, contentAlpha: 70, composerAlpha: 80,
    artX: (THEME.art && THEME.art.focusX != null ? THEME.art.focusX : 0.72) * 100,
    artY: (THEME.art && THEME.art.focusY != null ? THEME.art.focusY : 0.45) * 100,
    darkMode: "auto",
    customArt: null
  };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        var merged = {};
        for (var k in defaultSettings) merged[k] = saved[k] != null ? saved[k] : defaultSettings[k];
        // Prevent opacity sliders from being 0 (makes UI invisible)
        if (merged.containerAlpha < 5) merged.containerAlpha = defaultSettings.containerAlpha;
        return merged;
      }
    } catch (e) {}
    return JSON.parse(JSON.stringify(defaultSettings));
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  var saveTimer = null;
  function saveSettingsDebounced(s) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if ("requestIdleCallback" in window) {
        requestIdleCallback(function () { saveSettings(s); }, { timeout: 1000 });
      } else {
        saveSettings(s);
      }
    }, 300);
  }

  var settings = loadSettings();

  // ── Apply custom art (image or video) ──
  function applyCustomArt(artUrl) {
    if (!artUrl) artUrl = ART;
    var isVid = artUrl.indexOf("video/") !== -1 || /\.mp4|\.webm|\.ogg|\.mov/i.test(artUrl) || artUrl.indexOf("localhost:8765") !== -1;

    if (isVid) {
      // Remove image background
      root.style.removeProperty("--dream-art");
      root.style.removeProperty("background-image");
      root.classList.add("dream-video-active");

      // Create or update video container
      var vc = document.getElementById("opencode-dream-skin-video");
      if (!vc) {
        vc = document.createElement("div");
        vc.id = "opencode-dream-skin-video";
        vc.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;overflow:visible;z-index:-2147483647;pointer-events:none;background:#000;";
        document.body.insertBefore(vc, document.body.firstChild);
      }
      var vid = document.getElementById("opencode-dream-skin-video-el");
      if (!vid) {
        vid = document.createElement("video");
        vid.id = "opencode-dream-skin-video-el";
        vid.autoplay = true;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        vid.style.cssText = "width:100%;height:100%;object-fit:cover;";
        vc.appendChild(vid);
      }
      if (vid.src !== artUrl) { vid.src = artUrl; vid.load(); }
    } else {
      // Remove video if switching from video
      var vcOld = document.getElementById("opencode-dream-skin-video");
      if (vcOld) vcOld.remove();
      root.classList.remove("dream-video-active");

      // Set image background
      root.style.setProperty("--dream-art", "url(\"" + artUrl + "\")");
      root.style.backgroundImage = "url(\"" + artUrl + "\")";
      root.style.backgroundPosition = settings.artX + "% " + settings.artY + "%";
      root.style.backgroundSize = "cover";
      root.style.backgroundRepeat = "no-repeat";
      root.style.backgroundAttachment = "fixed";
    }
  }

  // Sanitize customArt: a future XSS or a tampered localStorage value could
  // attempt to make the renderer fetch arbitrary file:// or javascript: URLs.
  // Accept only the schemes we actually emit (data:, http://localhost) and
  // fall back to the bundled ART if the value is malformed.
  function sanitizeCustomArt(value) {
    if (typeof value !== "string" || value.length < 1) return ART;
    if (value.length > 16 * 1024 * 1024) return ART;
    if (value.indexOf("data:") === 0) {
      return /^data:(image|video)\/(png|jpe?g|webp|gif|mp4|webm|ogg|mov);base64,/.test(value) ? value : ART;
    }
    if (/^https?:\/\//i.test(value)) {
      try {
        var u = new URL(value);
        if (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]" || u.hostname === "::1") {
          return value;
        }
      } catch (e) {}
      return ART;
    }
    return ART;
  }
  var activeArt = sanitizeCustomArt(settings.customArt);
  applyCustomArt(activeArt);

  // ── Apply settings to CSS variables (batched with dirty checking) ──
  var settingsRaf = null;
  var dirtyKeys = new Set();
  function applySettings(keys) {
    if (keys) {
      keys.forEach(function (k) { dirtyKeys.add(k); });
    }
    if (settingsRaf) return;
    settingsRaf = requestAnimationFrame(function () {
      settingsRaf = null;
      var target = dirtyKeys.size ? dirtyKeys : null;
      if (!target || target.has("blur")) root.style.setProperty("--dream-blur", settings.blur + "px");
      if (!target || target.has("brightness")) root.style.setProperty("--dream-brightness", settings.brightness + "%");
      if (!target || target.has("contrast")) root.style.setProperty("--dream-contrast", settings.contrast + "%");
      if (!target || target.has("saturate")) root.style.setProperty("--dream-saturate", settings.saturate + "%");
      if (!target || target.has("containerAlpha")) root.style.setProperty("--dream-container-alpha", (settings.containerAlpha / 100).toFixed(2));
      if (!target || target.has("titlebarAlpha")) root.style.setProperty("--dream-titlebar-alpha", (settings.titlebarAlpha / 100).toFixed(2));
      if (!target || target.has("contentAlpha")) root.style.setProperty("--dream-content-alpha", (settings.contentAlpha / 100).toFixed(2));
      if (!target || target.has("composerAlpha")) root.style.setProperty("--dream-composer-alpha", (settings.composerAlpha / 100).toFixed(2));
      if (!target || target.has("artX") || target.has("artY")) root.style.setProperty("--dream-art-position", settings.artX + "% " + settings.artY + "%");
      dirtyKeys.clear();
    });
  }

  // Remove OpenCode's inline background-color
  root.style.removeProperty("background-color");

  // Inject CSS
  var style = document.getElementById("opencode-dream-skin-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "opencode-dream-skin-style";
    (document.head || root).appendChild(style);
  }
  // OpenCode 的样式全部位于 CSS @layer（properties/theme/base/components/utilities）中。
  // 按 CSS 规范，带 !important 的分层样式优先于未分层样式，因此皮肤样式若不分层，
  // 背景色等声明会被 utilities 层覆盖（表现为滑块无效）。
  // 将皮肤 CSS 包裹进最后声明的 @layer dream-skin，确保其优先级高于 OpenCode 各层。
  style.textContent = "@layer dream-skin { " + CSS + " }";

  // Apply classes to root
  root.classList.add("opencode-dream-skin");
  root.classList.toggle("dream-theme-light", appearance === "light");
  root.classList.toggle("dream-theme-dark", appearance === "dark");

  // Apply settings
  applySettings();

  // Detect page type
  var home = document.querySelector('[data-component="session-new-design"], [data-component="home"], [data-component="welcome"], [data-testid*="home"], [data-component="session-list"], [data-component="session-manager"]');
  if (home) {
    var container = home.closest('[role="main"]') || home.parentElement;
    if (container) { container.classList.add(HOME_CLASS); container.classList.remove(TASK_CLASS); }
    var mainLayout = document.getElementById("root") && document.getElementById("root").firstElementChild;
    if (mainLayout) mainLayout.classList.add(HOME_CLASS);
    root.classList.add(ACTIVE_HOME_CLASS);
  } else {
    document.querySelectorAll('[role="main"]').forEach(function (el) { el.classList.add(TASK_CLASS); });
  }

  // ── Settings Panel UI ──
  function buildPanel() {
    if (document.getElementById("dream-settings-panel")) return;

    var panel = document.createElement("div");
    panel.id = "dream-settings-panel";
    panel.className = "hidden";

    function slider(label, key, min, max, step, unit) {
      return '<div class="dream-row">' +
        '<span class="dream-label">' + label + '</span>' +
        '<div class="dream-slider-wrap">' +
        '<input type="range" class="dream-slider" data-key="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + settings[key] + '">' +
        '<span class="dream-value" data-display="' + key + '">' + settings[key] + unit + '</span>' +
        '</div></div>';
    }

    panel.innerHTML =
      '<div class="dream-panel-header" id="dream-panel-drag">' +
        '<span class="dream-panel-title">Skin Settings</span>' +
        '<button class="dream-panel-close" id="dream-panel-close">&times;</button>' +
      '</div>' +
      '<div class="dream-section">' +
        '<div class="dream-section-title">Background</div>' +
        slider("Blur", "blur", 0, 20, 1, "px") +
        slider("Brightness", "brightness", 0, 200, 5, "%") +
        slider("Contrast", "contrast", 0, 200, 5, "%") +
        slider("Saturate", "saturate", 0, 200, 5, "%") +
        slider("Opacity", "containerAlpha", 0, 100, 1, "%") +
        slider("Pos X", "artX", 0, 100, 1, "%") +
        slider("Pos Y", "artY", 0, 100, 1, "%") +
      '</div>' +
      '<div class="dream-section">' +
        '<div class="dream-section-title">UI</div>' +
        slider("Titlebar", "titlebarAlpha", 0, 100, 1, "%") +
        slider("Content", "contentAlpha", 0, 100, 1, "%") +
        slider("Composer", "composerAlpha", 0, 100, 1, "%") +
        '<div class="dream-row">' +
          '<span class="dream-label">Dark mode</span>' +
          '<select class="dream-select" id="dream-dark-mode">' +
            '<option value="auto"' + (settings.darkMode === "auto" ? " selected" : "") + '>Auto</option>' +
            '<option value="light"' + (settings.darkMode === "light" ? " selected" : "") + '>Light</option>' +
            '<option value="dark"' + (settings.darkMode === "dark" ? " selected" : "") + '>Dark</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="dream-section">' +
        '<div class="dream-section-title">Background Image</div>' +
        '<div class="dream-btn-row">' +
          '<button class="dream-btn" id="dream-change-img">Change</button>' +
          '<button class="dream-btn" id="dream-browse-local">Browse...</button>' +
          '<button class="dream-btn" id="dream-reset">Reset</button>' +
        '</div>' +
        '<div id="dream-gallery" class="dream-gallery"></div>' +
        '<input type="file" id="dream-file-input" accept="image/*,video/*">' +
      '</div>';

    document.body.appendChild(panel);
    bindPanelEvents(panel);
  }

  function bindPanelEvents(panel) {
    // Close button
    panel.querySelector("#dream-panel-close").addEventListener("click", function () {
      panel.classList.add("hidden");
    });

    // Drag
    var dragEl = panel.querySelector("#dream-panel-drag");
    var dragging = false, dx = 0, dy = 0;
    dragEl.addEventListener("mousedown", function (e) {
      if (e.target.id === "dream-panel-close") return;
      dragging = true;
      var rect = panel.getBoundingClientRect();
      dx = e.clientX - rect.left;
      dy = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = (e.clientX - dx) + "px";
      panel.style.top = (e.clientY - dy) + "px";
    });
    document.addEventListener("mouseup", function () { dragging = false; });

    // Sliders (optimized: pass dirty key to skip unchanged variables)
    panel.querySelectorAll(".dream-slider").forEach(function (slider) {
      var key = slider.getAttribute("data-key");
      var display = panel.querySelector('[data-display="' + key + '"]');
      var unit = key === "blur" ? "px" : "%";
      slider.addEventListener("input", function () {
        var val = parseFloat(slider.value);
        // Prevent containerAlpha from reaching 0 (makes background invisible)
        if (key === "containerAlpha" && val < 5) val = 5;
        settings[key] = val;
        display.textContent = val + unit;
        applySettings([key]);
        saveSettingsDebounced(settings);
      });
      slider.addEventListener("change", function () {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        saveSettings(settings);
      });
    });

    // Dark mode select
    panel.querySelector("#dream-dark-mode").addEventListener("change", function (e) {
      settings.darkMode = e.target.value;
      applyDarkMode();
      saveSettings(settings);
    });

    // Gallery — load images from image-server
    var gallery = panel.querySelector("#dream-gallery");
    var galleryLoaded = false;
    var IMAGE_SERVER = "http://127.0.0.1:18765";

    function loadGallery() {
      if (galleryLoaded) return;
      galleryLoaded = true;
      fetch(IMAGE_SERVER + "/api/images")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var all = [];
          (data.images || []).forEach(function (name) {
            all.push({ name: name, url: IMAGE_SERVER + "/asset-image/" + encodeURIComponent(name), type: "image" });
          });
          (data.videos || []).forEach(function (name) {
            all.push({ name: name, url: IMAGE_SERVER + "/asset-image/" + encodeURIComponent(name), type: "video" });
          });
          if (all.length === 0) {
            gallery.innerHTML = '<div class="dream-gallery-empty">No images in assets folder</div>';
            return;
          }
          var currentArt = settings.customArt || "";
          var html = "";
          all.forEach(function (item) {
            var isActive = currentArt.indexOf(item.url) !== -1;
            if (item.type === "image") {
              html += '<div class="dream-gallery-item' + (isActive ? " active" : "") + '" data-url="' + item.url + '" title="' + item.name + '">' +
                '<img src="' + item.url + '" loading="lazy">' +
                '</div>';
            } else {
              html += '<div class="dream-gallery-item' + (isActive ? " active" : "") + '" data-url="' + item.url + '" title="' + item.name + '">' +
                '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:10px;">' + item.name + '</div>' +
                '</div>';
            }
          });
          gallery.innerHTML = html;
          // Bind click
          gallery.querySelectorAll(".dream-gallery-item").forEach(function (el) {
            el.addEventListener("click", function () {
              var url = el.getAttribute("data-url");
              settings.customArt = url;
              saveSettings(settings);
              applyCustomArt(url);
              // Update active state
              gallery.querySelectorAll(".dream-gallery-item").forEach(function (g) { g.classList.remove("active"); });
              el.classList.add("active");
            });
          });
        })
        .catch(function () {
          gallery.innerHTML = '<div class="dream-gallery-empty">Image server not running (start with --port 18765)</div>';
        });
    }

    // Change — toggle gallery
    panel.querySelector("#dream-change-img").addEventListener("click", function () {
      gallery.classList.toggle("open");
      if (gallery.classList.contains("open")) loadGallery();
    });

    // Browse — open file picker for local files
    var fileInput = panel.querySelector("#dream-file-input");
    panel.querySelector("#dream-browse-local").addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        var dataUrl = ev.target.result;
        settings.customArt = dataUrl;
        saveSettings(settings);
        applyCustomArt(dataUrl);
      };
      reader.readAsDataURL(file);
    });

    // Reset — only reset slider values, keep current background image/video
    panel.querySelector("#dream-reset").addEventListener("click", function () {
      var prevCustomArt = settings.customArt;
      var prevDarkMode = settings.darkMode;
      settings = JSON.parse(JSON.stringify(defaultSettings));
      settings.customArt = prevCustomArt;
      settings.darkMode = prevDarkMode;
      applySettings();
      applyDarkMode();
      saveSettings(settings);
      // Update UI — dispatch input event to sync browser's internal range state
      panel.querySelectorAll(".dream-slider").forEach(function (s) {
        var key = s.getAttribute("data-key");
        s.value = settings[key];
        s.dispatchEvent(new Event("input", { bubbles: true }));
        var unit = key === "blur" ? "px" : "%";
        var display = panel.querySelector('[data-display="' + key + '"]');
        if (display) display.textContent = settings[key] + unit;
      });
      panel.querySelector("#dream-dark-mode").value = settings.darkMode;
    });
  }

  function applyDarkMode() {
    if (settings.darkMode === "auto") {
      // Follow system
      var ds = root.getAttribute("data-color-scheme") || "";
      var dt = root.getAttribute("data-theme") || "";
      var next = ds.indexOf("dark") !== -1 || dt.indexOf("dark") !== -1 ? "dark" : "light";
      root.classList.remove("dream-theme-light", "dream-theme-dark");
      root.classList.add("dream-theme-" + next);
      appearance = next;
    } else {
      root.classList.remove("dream-theme-light", "dream-theme-dark");
      root.classList.add("dream-theme-" + settings.darkMode);
      appearance = settings.darkMode;
    }
  }

  // Build panel
  buildPanel();

  // Keyboard shortcut: Ctrl+S to toggle
  var keydownHandler = function (e) {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyS") {
      e.preventDefault();
      e.stopPropagation();
      var panel = document.getElementById("dream-settings-panel");
      if (panel) panel.classList.toggle("hidden");
    }
  };
  document.addEventListener("keydown", keydownHandler, true);

  // Cleanup
  function cleanup() {
    if (observer) { observer.disconnect(); observer = null; }
    if (permissionObserver) { permissionObserver.disconnect(); permissionObserver = null; }
    if (homePollTimer) { clearInterval(homePollTimer); homePollTimer = null; }
    root.classList.remove.apply(root.classList, ROOT_CLASSES);
    root.classList.remove(ACTIVE_HOME_CLASS);
    root.classList.remove("dream-video-active");
    document.querySelectorAll("." + HOME_CLASS).forEach(function (n) { n.classList.remove(HOME_CLASS); });
    document.querySelectorAll("." + TASK_CLASS).forEach(function (n) { n.classList.remove(TASK_CLASS); });
    var ml = document.getElementById("root") && document.getElementById("root").firstElementChild;
    if (ml) ml.classList.remove(HOME_CLASS);
    // Remove CSS variables
    ["--dream-art", "--dream-art-position", "--dream-accent",
     "--dream-blur", "--dream-brightness", "--dream-contrast", "--dream-saturate",
     "--dream-container-alpha", "--dream-titlebar-alpha", "--dream-content-alpha", "--dream-composer-alpha"
    ].forEach(function (v) { root.style.removeProperty(v); });
    root.style.removeProperty("background-image");
    root.style.removeProperty("background-position");
    root.style.removeProperty("background-size");
    root.style.removeProperty("background-repeat");
    root.style.removeProperty("background-attachment");
    var s = document.getElementById("opencode-dream-skin-style");
    if (s) s.remove();
    var vc = document.getElementById("opencode-dream-skin-video");
    if (vc) vc.remove();
    var panel = document.getElementById("dream-settings-panel");
    if (panel) panel.remove();
    document.removeEventListener("keydown", keydownHandler, true);
    delete window.__OPENCODE_DREAM_SKIN_STATE__;
    return true;
  }

  // Observer
  var observer = null;
  var lastHomeState = !!home;
  var homeCheckTimer = null;
  function runHomeCheck() {
    var hasHome = !!document.querySelector('[data-component="session-new-design"], [data-component="home"], [data-component="welcome"], [data-component="session-list"], [data-component="session-manager"]');
    if (hasHome === lastHomeState) return false;
    lastHomeState = hasHome;
    if (hasHome) {
      var el = document.querySelector('[data-component="session-new-design"], [data-component="session-list"], [data-component="session-manager"]');
      var c = el && (el.closest('[role="main"]') || el.parentElement);
      if (c) { c.classList.add(HOME_CLASS); c.classList.remove(TASK_CLASS); }
      var ml = document.getElementById("root") && document.getElementById("root").firstElementChild;
      if (ml) ml.classList.add(HOME_CLASS);
      root.classList.add(ACTIVE_HOME_CLASS);
    } else {
      document.querySelectorAll("." + HOME_CLASS).forEach(function (n) { n.classList.remove(HOME_CLASS); });
      var m2 = document.getElementById("root") && document.getElementById("root").firstElementChild;
      if (m2) m2.classList.remove(HOME_CLASS);
      root.classList.remove(ACTIVE_HOME_CLASS);
    }
    return true;
  }
  function scheduleHomeCheck() {
    if (homeCheckTimer) return;
    homeCheckTimer = setTimeout(function () {
      homeCheckTimer = null;
      runHomeCheck();
    }, 150);
  }
  if (typeof MutationObserver === "function") {
    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].type === "attributes") {
          var ds = root.getAttribute("data-color-scheme") || "";
          var dt = root.getAttribute("data-theme") || "";
          var next = ds.indexOf("dark") !== -1 || dt.indexOf("dark") !== -1 ? "dark" : "light";
          if (next !== appearance) {
            if (settings.darkMode === "auto") {
              root.classList.remove("dream-theme-light", "dream-theme-dark");
              root.classList.add("dream-theme-" + next);
              appearance = next;
            }
          }
        }
      }
      scheduleHomeCheck();
    });
    var rootEl = document.getElementById("root");
    if (rootEl) observer.observe(rootEl, { childList: true, subtree: true });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-color-scheme"] });
  }

  // Periodic fallback: check page type with exponential backoff. The
  // MutationObserver above usually catches navigation, but Electron's SPA
  // routing occasionally fires no DOM mutations we observe; this timer is a
  // safety net. It starts at 500ms and stretches up to 3000ms when the page
  // type is stable, cutting the steady-state wakeups by ~70%.
  var homePollTimer = null;
  var pollInterval = 500;
  var stableCount = 0;
  var POLL_STABLE_THRESHOLD = 4;
  var POLL_MAX_INTERVAL = 3000;
  function pollLoop() {
    if (!window.__OPENCODE_DREAM_SKIN_STATE__) {
      homePollTimer = null;
      return;
    }
    var changed = runHomeCheck();
    if (changed) {
      pollInterval = 500;
      stableCount = 0;
    } else {
      stableCount += 1;
      if (stableCount >= POLL_STABLE_THRESHOLD) {
        pollInterval = Math.min(POLL_MAX_INTERVAL, pollInterval + 500);
      }
    }
    homePollTimer = setTimeout(pollLoop, pollInterval);
  }
  homePollTimer = setTimeout(pollLoop, pollInterval);

  // ── Permission request notification (popup + sound) ──
  var permissionObserver = null;
  function playNotifSound() {
    try {
      var actx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = actx.createOscillator();
      var gain = actx.createGain();
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.frequency.setValueAtTime(660, actx.currentTime);
      osc.frequency.setValueAtTime(880, actx.currentTime + 0.1);
      osc.type = "sine";
      gain.gain.setValueAtTime(0.12, actx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.3);
      osc.start(actx.currentTime);
      osc.stop(actx.currentTime + 0.3);
    } catch (e) {}
  }
  function initPermissionNotifier() {
    var ds = document.querySelector('[data-component="dialog-stack"]');
    if (!ds) { setTimeout(initPermissionNotifier, 1000); return; }
    var lastCount = ds.children.length;
    permissionObserver = new MutationObserver(function () {
      var curr = ds.children.length;
      if (curr > lastCount) {
        playNotifSound();
        var nd = ds.children[curr - 1];
        if (nd) {
          nd.classList.remove("dream-notif-new");
          void nd.offsetWidth;
          nd.classList.add("dream-notif-new");
        }
      }
      lastCount = curr;
    });
    permissionObserver.observe(ds, { childList: true });
  }
  initPermissionNotifier();

  // ── Visibility optimization: pause video when tab/window is hidden ──
  if (!window.__dreamVisListenerAdded) {
    window.__dreamVisListenerAdded = true;
    document.addEventListener("visibilitychange", function () {
      var vid = document.getElementById("opencode-dream-skin-video-el");
      if (!vid) return;
      if (document.hidden) { vid.pause(); } else { vid.play().catch(function () {}); }
    });
    window.addEventListener("blur", function () {
      var vid = document.getElementById("opencode-dream-skin-video-el");
      if (vid && !document.hidden) vid.playbackRate = 0.5;
    });
    window.addEventListener("focus", function () {
      var vid = document.getElementById("opencode-dream-skin-video-el");
      if (vid) vid.playbackRate = 1;
    });
  }

  state = { version: "2.0.0", cleanup: cleanup, appearance: appearance, settings: settings, applySettings: applySettings };
  window.__OPENCODE_DREAM_SKIN_STATE__ = state;
})();
