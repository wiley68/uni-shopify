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

  /** Exact SmartUCF hosts allowed for top-level bank redirect. */
  var SMARTUCF_HOSTS = {
    "onlinetest.ucfin.bg": true,
    "online.ucfin.bg": true,
  };

  /** Exact SmartUCF Process 1 start path prefix (session id is one final segment). */
  var SMARTUCF_START_PREFIX = "/sucf-online/Request/Start/";

  /** Bounded storefront cart clear before Cart P1 SmartUCF navigation (ms). */
  var CART_CLEAR_TIMEOUT_MS = 2000;

  /** Dev-only console diagnostics for financing postMessage handoff. */
  function transportDebug(message, detail) {
    try {
      if (
        typeof console === "undefined" ||
        typeof console.debug !== "function"
      ) {
        return;
      }
      if (detail === undefined) console.debug("[uni-transport]", message);
      else console.debug("[uni-transport]", message, detail);
    } catch (_ignored) {}
  }

  function safeBankUrlDiag(raw) {
    try {
      var parsed = new URL(String(raw == null ? "" : raw).trim());
      var path = parsed.pathname || "";
      var pattern = "(unexpected path)";
      if (path.indexOf(SMARTUCF_START_PREFIX) === 0) {
        var rest = path.slice(SMARTUCF_START_PREFIX.length);
        if (rest.endsWith("/")) rest = rest.slice(0, -1);
        if (rest && rest.indexOf("/") === -1) {
          pattern = SMARTUCF_START_PREFIX + "<session>";
        } else {
          pattern = SMARTUCF_START_PREFIX + "<invalid-session>";
        }
      }
      return { host: parsed.hostname, pathPattern: pattern };
    } catch (_ignored) {
      return { host: "(invalid)", pathPattern: "(invalid)" };
    }
  }

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
    bankRedirectHandled: false,
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

  /**
   * Validate SmartUCF start URL from uni:bank-redirect.
   * Requires https + exact trusted host + prefix /sucf-online/Request/Start/
   * + exactly one non-empty final session segment (query allowed).
   * @returns {string|null} href safe for top-level navigation
   */
  function validateSmartUcfUrl(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    try {
      var parsed = new URL(raw.trim());
      if (parsed.protocol !== "https:") return null;
      if (parsed.username || parsed.password) return null;
      if (!SMARTUCF_HOSTS[parsed.hostname]) return null;

      var path = parsed.pathname || "";
      if (path.indexOf(SMARTUCF_START_PREFIX) !== 0) return null;

      var session = path.slice(SMARTUCF_START_PREFIX.length);
      if (session.endsWith("/")) session = session.slice(0, -1);
      if (!session) return null;
      if (session.indexOf("/") !== -1) return null;
      if (session === "." || session === "..") return null;

      return parsed.href;
    } catch (_ignored) {
      return null;
    }
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
    state.bankRedirectHandled = false;
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
    state.frameWrap = options && options.wrap ? options.wrap : state.frameWrap;

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

  /**
   * Clear current Shopify cart via Ajax Cart API (locale-aware root).
   * Bounded wait — storefront hygiene only; must never block SmartUCF forever.
   */
  function clearShopifyCartBounded() {
    var url = shopifyRoot() + "cart/clear.js";
    var controller = null;
    try {
      if (typeof AbortController === "function") {
        controller = new AbortController();
      }
    } catch (_ignored) {
      controller = null;
    }

    var timeoutId = null;
    var timedOut = false;

    var fetchPromise = fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller ? controller.signal : undefined,
    }).then(function (response) {
      if (!response.ok) throw new Error("cart-clear-http");
    });

    var timeoutPromise = new Promise(function (_resolve, reject) {
      timeoutId = setTimeout(function () {
        timedOut = true;
        if (controller) {
          try {
            controller.abort();
          } catch (_abortIgnored) {}
        }
        reject(new Error("cart-clear-timeout"));
      }, CART_CLEAR_TIMEOUT_MS);
    });

    return Promise.race([fetchPromise, timeoutPromise]).then(
      function () {
        if (timeoutId != null) clearTimeout(timeoutId);
        if (timedOut) throw new Error("cart-clear-timeout");
      },
      function (err) {
        if (timeoutId != null) clearTimeout(timeoutId);
        if (timedOut) throw new Error("cart-clear-timeout");
        throw err || new Error("cart-clear-failed");
      },
    );
  }

  function navigateToBank(destination) {
    try {
      transportDebug("bank redirect navigation started");
      global.location.assign(destination);
    } catch (_ignored) {
      // Synchronous assign failure only — fall back to normal close lifecycle.
      transportDebug("bank redirect navigation failed; falling back to close");
      if (typeof state.closeImpl === "function") {
        closeActive();
      } else if (state.flow) {
        end(state.flow);
      } else {
        resetContainmentState();
      }
    }
  }

  /**
   * Trusted uni:bank-redirect → top-level SmartUCF navigation.
   * Keep Step 3 / modal visible until the browser leaves (no storefront flash).
   * Cart source: clear Shopify cart first (non-blocking hygiene).
   * Product source: navigate immediately; cart untouched.
   * Never navigates the iframe. Invalid destination → ignore (no navigation).
   */
  function handleBankRedirect(rawUrl) {
    if (state.bankRedirectHandled) {
      transportDebug("bank redirect ignored: already handled");
      return;
    }

    var validated = validateSmartUcfUrl(rawUrl);
    transportDebug("bank redirect URL check", {
      urlOk: !!validated,
      diag: safeBankUrlDiag(rawUrl),
    });
    if (!validated) {
      transportDebug("bank redirect ignored: invalid destination");
      return;
    }

    // Accept once after validation — prevents duplicate clear/navigation.
    state.bankRedirectHandled = true;
    var destination = validated;
    var flow = state.flow;

    // Non-visual only: suppress ghost timeout/error. Do NOT close/remove modal.
    clearReadyTimeout();
    state.readyReceived = true;
    transportDebug("bank redirect accepted");

    function finishNavigate() {
      navigateToBank(destination);
    }

    // Product (and any non-cart flow): immediate SmartUCF redirect.
    if (flow !== "cart") {
      finishNavigate();
      return;
    }

    // Cart P1 success: clear cart, then navigate. Clear failure must not block.
    transportDebug("cart_clear_started");
    Promise.resolve()
      .then(function () {
        return clearShopifyCartBounded();
      })
      .then(function () {
        transportDebug("cart_clear_success");
      })
      .catch(function (err) {
        var code =
          err && err.message === "cart-clear-timeout"
            ? "cart_clear_timeout"
            : "cart_clear_failed";
        transportDebug(code);
      })
      .then(function () {
        finishNavigate();
      })
      .catch(function () {
        // Contain any unexpected finishNavigate failure; still attempt assign.
        try {
          finishNavigate();
        } catch (_finalIgnored) {}
      });
  }

  function onMessage(event) {
    if (!isConfigured()) return;

    var data = event.data;
    var type =
      data && typeof data === "object" && !Array.isArray(data)
        ? data.type
        : null;
    if (
      type !== "uni:ready" &&
      type !== "uni:close" &&
      type !== "uni:bank-redirect"
    ) {
      return;
    }

    var originOk = event.origin === CP_ORIGIN;
    var sourceOk = !!(
      state.iframe &&
      state.iframe.contentWindow &&
      event.source === state.iframe.contentWindow
    );

    transportDebug("financing message", {
      type: type,
      origin: event.origin,
      expectedOrigin: CP_ORIGIN,
      originOk: originOk,
      sourceOk: sourceOk,
    });

    if (!originOk) {
      if (type === "uni:bank-redirect") {
        transportDebug("bank redirect ignored: wrong origin");
      }
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    if (!sourceOk) {
      if (type === "uni:bank-redirect") {
        transportDebug("bank redirect ignored: wrong source");
      }
      return;
    }

    if (type === "uni:ready") {
      revealIframeOnReady();
      return;
    }
    if (type === "uni:bank-redirect") {
      handleBankRedirect(data.url);
      return;
    }
    if (type === "uni:close") {
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
    validateSmartUcfUrl: validateSmartUcfUrl,
    isActive: isActive,
    getFlow: getFlow,
    getIframe: getIframe,
    begin: begin,
    setIframe: setIframe,
    end: end,
    closeActive: closeActive,
  };
})(typeof window !== "undefined" ? window : globalThis);
