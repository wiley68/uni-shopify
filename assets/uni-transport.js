/**
 * Shared UniCredit page-level transport lifecycle.
 * Owns: active flow, active iframe, body scroll lock, Escape, postMessage close.
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
    previousOverflow: "",
    closeImpl: null,
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

  function isActive() {
    return state.flow !== null;
  }

  function getFlow() {
    return state.flow;
  }

  function getIframe() {
    return state.iframe;
  }

  /**
   * Begin exclusive Uni flow. Locks body scroll once.
   * @returns {boolean} false if another flow is already active or CP config invalid
   */
  function begin(flow, options) {
    if (!isConfigured()) return false;
    if (state.flow) return false;
    if (flow !== "product" && flow !== "cart") return false;
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

  function setIframe(iframe) {
    if (!state.flow) return;
    state.iframe = iframe || null;
  }

  /**
   * End the active flow and restore scroll. No-op if flow mismatch (inactive close).
   * @returns {boolean}
   */
  function end(flow) {
    if (state.flow !== flow) return false;
    document.body.style.overflow = state.previousOverflow;
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
    if (data.type !== "uni:close") return;
    if (!state.iframe || !state.iframe.contentWindow) return;
    if (event.source !== state.iframe.contentWindow) return;
    closeActive();
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
    isConfigured: isConfigured,
    shopifyRoot: shopifyRoot,
    validateCurrency: validateCurrency,
    isActive: isActive,
    getFlow: getFlow,
    getIframe: getIframe,
    begin: begin,
    setIframe: setIframe,
    end: end,
    closeActive: closeActive,
  };
})(typeof window !== "undefined" ? window : globalThis);
