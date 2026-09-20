/**
 * Shared UniCredit page-level transport lifecycle.
 * Owns: active flow, active iframe, body scroll lock, Escape, postMessage close/ready,
 * initial iframe containment until trusted uni:ready.
 *
 * CP base URL is the single deployment source of truth for all environments.
 * Temporary DEV/TEST echo path — replace before production release.
 */
(function (global) {
  "use strict";

  var KEY = "__UniTransport";
  if (global[KEY]) return;

  // =============================================================================
  // ENVIRONMENT PACKAGE SWITCH — change ONLY this value for DEV / TEST / PRODUCTION
  // DEV:        https://uni.avalonbg.com
  // TEST:       <test CP base URL>
  // PRODUCTION: <production CP base URL>
  // Do NOT put this in Theme Editor settings.
  // =============================================================================
  var CP_BASE_URL = "https://uni.avalonbg.com";

  // Production CP routes
  var CP_ECHO_PATH = "/shopify/financing";

  /** Bounded wait for trusted CP uni:ready before safe parent error. */
  var READY_TIMEOUT_MS = 10000;

  var SAFE_LOAD_ERROR =
    "Финансирането временно не може да бъде заредено.\nМоля, опитайте отново.";

  function resolveCpConfig(baseUrl) {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) return null;
    try {
      var parsed = new URL(baseUrl.trim());
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
        return null;
      if (!parsed.host) return null;
      var origin = parsed.origin;
      return {
        baseUrl: origin,
        origin: origin,
        echoUrl: origin.replace(/\/$/, "") + CP_ECHO_PATH,
      };
    } catch (_ignored) {
      return null;
    }
  }

  var cpConfig = resolveCpConfig(CP_BASE_URL);
  var CP_ORIGIN = cpConfig ? cpConfig.origin : "";
  var CP_URL = cpConfig ? cpConfig.echoUrl : "";

  function isConfigured() {
    return !!(cpConfig && CP_ORIGIN && CP_URL);
  }

  var state = {
    flow: null,
    modalId: null,
    iframe: null,
    frameWrap: null,
    previousOverflow: "",
    closeImpl: null,
    readyReceived: false,
    readyTimeoutId: null,
  };

  function shopifyRoot() {
    var root =
      global.Shopify && global.Shopify.routes && global.Shopify.routes.root;
    root = typeof root === "string" && root ? root : "/";
    return root.endsWith("/") ? root : root + "/";
  }

  /**
   * Presentment currency: uppercase ISO-like code (3 letters).
   * @returns {string|null}
   */
  function validateCurrency(code) {
    if (typeof code !== "string") return null;
    var normalized = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) return null;
    return normalized;
  }

  /**
   * Normalize Shopify Collection IDs for CP transport.
   * Browser-supplied, untrusted shopping context — not auth/settlement authority.
   * @returns {number[]} positive safe integers only, deduped, invalid → dropped
   */
  function normalizeCollectionIds(raw) {
    if (!Array.isArray(raw)) return [];
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var value = raw[i];
      var id = null;
      if (typeof value === "number") {
        if (Number.isSafeInteger(value) && value > 0) id = value;
      } else {
        var text = String(value == null ? "" : value).trim();
        if (/^\d+$/.test(text)) {
          var number = Number(text);
          if (Number.isSafeInteger(number) && number > 0) id = number;
        }
      }
      if (!id) continue;
      var key = String(id);
      if (seen[key]) continue;
      seen[key] = true;
      out.push(id);
    }
    return out;
  }

  function isActive() {
    return state.flow !== null;
  }

  function getFlow() {
    return state.flow;
  }

  function getIframe() {
    return state.iframe;
  }

  function clearReadyTimeout() {
    if (state.readyTimeoutId != null) {
      clearTimeout(state.readyTimeoutId);
      state.readyTimeoutId = null;
    }
  }

  function resetContainmentState() {
    clearReadyTimeout();
    state.frameWrap = null;
    state.readyReceived = false;
  }

  function statusClassForFlow() {
    return state.flow === "cart"
      ? "uni-cart-modal__status"
      : "uni-product-modal__status";
  }

  function ensureLoadingStatus(wrap) {
    if (!wrap) return;
    var status = wrap.querySelector("[data-uni-frame-status]");
    if (!status) {
      status = document.createElement("div");
      status.setAttribute("data-uni-frame-status", "");
      status.className = statusClassForFlow();
      wrap.appendChild(status);
    }
    status.setAttribute("role", "status");
    status.textContent = "Зареждане…";
  }

  /**
   * Safe parent-side error: iframe stays hidden; no upstream HTML / CP URLs.
   */
  function showSafeLoadError() {
    clearReadyTimeout();
    if (state.iframe) {
      state.iframe.hidden = true;
      state.iframe.setAttribute("aria-hidden", "true");
    }
    if (!state.frameWrap) return;
    var status = state.frameWrap.querySelector("[data-uni-frame-status]");
    if (!status) {
      status = document.createElement("div");
      status.setAttribute("data-uni-frame-status", "");
      status.className = statusClassForFlow();
      state.frameWrap.appendChild(status);
    }
    status.setAttribute("role", "alert");
    status.textContent = SAFE_LOAD_ERROR;
  }

  /**
   * Reveal iframe only after trusted uni:ready (origin + source validated).
   * Does not recreate/reload iframe or reset financing session.
   */
  function revealIframeOnReady() {
    if (!state.flow || state.readyReceived) return;
    state.readyReceived = true;
    clearReadyTimeout();
    if (state.frameWrap) {
      var status = state.frameWrap.querySelector("[data-uni-frame-status]");
      if (status) status.remove();
    }
    if (state.iframe) {
      state.iframe.hidden = false;
      state.iframe.removeAttribute("aria-hidden");
    }
  }

  /**
   * Begin exclusive Uni flow. Locks body scroll once.
   * @returns {boolean} false if another flow is already active or CP config invalid
   */
  function begin(flow, options) {
    if (!isConfigured()) return false;
    if (state.flow) return false;
    if (flow !== "product" && flow !== "cart") return false;
    resetContainmentState();
    state.flow = flow;
    state.modalId = options && options.modalId ? options.modalId : null;
    state.closeImpl =
      options && typeof options.closeImpl === "function"
        ? options.closeImpl
        : null;
    state.iframe = null;
    state.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return true;
  }

  /**
   * Register active iframe and arm containment until trusted uni:ready.
   * options.wrap = modal frame-wrap element hosting loading/error UI.
   * iframe load is NOT authority to reveal.
   */
  function setIframe(iframe, options) {
    if (!state.flow) return;
    clearReadyTimeout();
    state.readyReceived = false;
    state.iframe = iframe || null;
    state.frameWrap =
      options && options.wrap ? options.wrap : state.frameWrap;

    if (!iframe) return;

    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");
    ensureLoadingStatus(state.frameWrap);

    state.readyTimeoutId = setTimeout(function () {
      state.readyTimeoutId = null;
      if (!state.flow || state.readyReceived) return;
      showSafeLoadError();
    }, READY_TIMEOUT_MS);
  }

  /**
   * End the active flow and restore scroll. No-op if flow mismatch (inactive close).
   * Clears ready timeout so close-while-loading leaves no ghost error.
   * @returns {boolean}
   */
  function end(flow) {
    if (state.flow !== flow) return false;
    document.body.style.overflow = state.previousOverflow;
    resetContainmentState();
    state.flow = null;
    state.modalId = null;
    state.iframe = null;
    state.closeImpl = null;
    state.previousOverflow = "";
    return true;
  }

  function closeActive() {
    if (!state.flow || typeof state.closeImpl !== "function") return;
    state.closeImpl();
  }

  function onMessage(event) {
    if (!isConfigured()) return;
    if (event.origin !== CP_ORIGIN) return;
    var data = event.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    if (!state.iframe || !state.iframe.contentWindow) return;
    if (event.source !== state.iframe.contentWindow) return;

    if (data.type === "uni:ready") {
      revealIframeOnReady();
      return;
    }
    if (data.type === "uni:close") {
      closeActive();
    }
  }

  function onKeydown(event) {
    if (event.key === "Escape") closeActive();
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("keydown", onKeydown);
  }
  if (typeof global.addEventListener === "function") {
    global.addEventListener("message", onMessage);
  }

  global[KEY] = {
    CP_BASE_URL: CP_BASE_URL,
    CP_ORIGIN: CP_ORIGIN,
    CP_URL: CP_URL,
    READY_TIMEOUT_MS: READY_TIMEOUT_MS,
    isConfigured: isConfigured,
    shopifyRoot: shopifyRoot,
    validateCurrency: validateCurrency,
    normalizeCollectionIds: normalizeCollectionIds,
    isActive: isActive,
    getFlow: getFlow,
    getIframe: getIframe,
    begin: begin,
    setIframe: setIframe,
    end: end,
    closeActive: closeActive,
  };
})(typeof window !== "undefined" ? window : globalThis);
