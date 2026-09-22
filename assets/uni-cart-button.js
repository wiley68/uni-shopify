(function () {
  "use strict";

  var transport = window.__UniTransport;
  if (!transport) return;

  var MODAL_ID = "uni-cart-modal";
  var IFRAME_NAME = "uni-cart-frame";
  var GLOBALS_KEY = "__uniCartButtonGlobalsBound";
  var requestInProgress = false;

  /**
   * Local financing minimum (uni_min_price).
   * Merchants configure whole major units; Liquid renders minor units.
   * Missing/invalid configuration falls back to 50 (5000 minor units).
   */
  var DEFAULT_MIN_PRICE_MAJOR = 50;
  var MINOR_UNITS_FACTOR = 100;
  var DEFAULT_MIN_PRICE_MINOR = DEFAULT_MIN_PRICE_MAJOR * MINOR_UNITS_FACTOR;

  function positiveInteger(value) {
    var text = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return null;
    var number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  /** Non-negative integer — a cart amount may legitimately be 0. */
  function nonNegativeInteger(value) {
    var text = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return null;
    var number = Number(text);
    return Number.isSafeInteger(number) ? number : null;
  }

  /**
   * Configured minimum in minor units (Liquid already applied the fallback).
   * Never falls back to zero/unlimited.
   */
  function resolveMinimumMinor(container) {
    var configured = positiveInteger(
      container && container.dataset ? container.dataset.uniMinPrice : null,
    );
    return configured ? configured : DEFAULT_MIN_PRICE_MINOR;
  }

  /**
   * Local minimum gate on the current cart amount. Uses the cart.js
   * total_price already fetched by fetchStableCart() — same minor-unit field
   * Liquid renders for the initial hidden state, not a second cart total.
   * An unavailable amount keeps the pre-existing eligibility behavior.
   */
  function isCartAboveMinimum(container, cart) {
    var total =
      cart && typeof cart === "object"
        ? nonNegativeInteger(cart.total_price)
        : null;
    if (total == null) return true;
    return total >= resolveMinimumMinor(container);
  }

  /**
   * Narrow Cart observation scope: the storefront Cart form (platform
   * convention) when present, otherwise the surrounding theme section.
   * document / document.body / documentElement are never observation targets.
   */
  var CART_FORM_SELECTOR = 'form[action*="/cart"]';
  var CART_RECHECK_DELAY_MS = 200;
  var CART_WATCH_EVENTS = ["change", "input", "submit"];

  /** One-shot timer that still works when the host has no timer. */
  var scheduleTimer =
    typeof setTimeout === "function"
      ? function (fn, delay) {
          setTimeout(fn, delay);
        }
      : function (fn) {
          fn();
        };

  function isCartForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    var action = form.getAttribute("action") || "";
    if (/cart\/add/.test(action)) return false;
    return /\bcart\b/.test(action);
  }

  function themeSectionFor(container) {
    if (!container || typeof container.closest !== "function") return null;
    return container.closest(
      ".shopify-section, [id^='shopify-section'], [data-section-id]",
    );
  }

  function findCartForm(container) {
    if (container && typeof container.closest === "function") {
      var own = container.closest("form");
      if (isCartForm(own)) return own;
    }
    var section = themeSectionFor(container);
    var root = section || (typeof document !== "undefined" ? document : null);
    if (!root || typeof root.querySelectorAll !== "function") return null;
    var nodes = root.querySelectorAll(CART_FORM_SELECTOR);
    var forms = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isCartForm(nodes[i])) forms.push(nodes[i]);
    }
    // Only a uniquely determined Cart form is a valid scope.
    return forms.length === 1 ? forms[0] : null;
  }

  function isObservableScope(node) {
    if (!node || typeof node !== "object") return false;
    if (typeof document === "undefined") return false;
    if (
      node === document ||
      node === document.body ||
      node === document.documentElement
    ) {
      return false;
    }
    return true;
  }

  function resolveCartObservationScope(container) {
    var scope = findCartForm(container) || themeSectionFor(container);
    return isObservableScope(scope) ? scope : null;
  }

  /**
   * One Cart watcher per page (idempotent): a MutationObserver scoped to the
   * resolved Cart form/section listening to childList + subtree only (never
   * attributes, so toggling `hidden` cannot re-trigger it) plus that same
   * scope's own Cart control events. All bursts are coalesced into one cart.js
   * read through the existing fetchStableCart() authority.
   */
  var cartWatch = {
    containers: [],
    scope: null,
    observer: null,
    bindings: [],
    scheduled: false,
    running: false,
    rerun: false,
  };

  function registerCartContainer(container) {
    if (!container || typeof container !== "object") return;
    for (var i = cartWatch.containers.length - 1; i >= 0; i--) {
      if (cartWatch.containers[i].isConnected === false) {
        cartWatch.containers.splice(i, 1);
      }
    }
    if (cartWatch.containers.indexOf(container) === -1) {
      cartWatch.containers.push(container);
    }
  }

  function bindCartScopeEvents(scope) {
    if (!scope || typeof scope.addEventListener !== "function") return;
    function onCartActivity() {
      scheduleCartRecheck();
    }
    for (var i = 0; i < CART_WATCH_EVENTS.length; i++) {
      scope.addEventListener(CART_WATCH_EVENTS[i], onCartActivity);
      cartWatch.bindings.push({
        scope: scope,
        type: CART_WATCH_EVENTS[i],
        handler: onCartActivity,
      });
    }
  }

  function unbindCartScopeEvents() {
    for (var i = 0; i < cartWatch.bindings.length; i++) {
      var binding = cartWatch.bindings[i];
      if (
        binding.scope &&
        typeof binding.scope.removeEventListener === "function"
      ) {
        binding.scope.removeEventListener(binding.type, binding.handler);
      }
    }
    cartWatch.bindings.length = 0;
  }

  function connectCartObserver(scope) {
    if (typeof MutationObserver !== "function") return;
    if (!cartWatch.observer) {
      cartWatch.observer = new MutationObserver(function () {
        scheduleCartRecheck();
      });
    }
    cartWatch.observer.observe(scope, { childList: true, subtree: true });
  }

  /**
   * Register this slot and (re)bind the single Cart watcher. Repeated
   * initialization is a no-op; a replaced Cart section is rebound after the
   * old scope is disconnected, so observers/listeners never accumulate.
   */
  function ensureCartObservation(container) {
    registerCartContainer(container);
    var scope = resolveCartObservationScope(container);
    if (!scope) return;
    if (cartWatch.scope === scope && scope.isConnected !== false) return;
    unbindCartScopeEvents();
    if (cartWatch.observer && cartWatch.scope && cartWatch.scope !== scope) {
      cartWatch.observer.disconnect();
    }
    cartWatch.scope = scope;
    bindCartScopeEvents(scope);
    connectCartObserver(scope);
  }

  function scheduleCartRecheck() {
    if (cartWatch.scheduled) return; // coalesce bursts of mutations/events
    cartWatch.scheduled = true;
    scheduleTimer(function () {
      cartWatch.scheduled = false;
      refreshCartVisibility();
    }, CART_RECHECK_DELAY_MS);
  }

  /**
   * Re-read the Cart through the existing authoritative mechanism and toggle
   * the existing slots in place (never removed, never recreated).
   * Never starts CP, never throws: a failed read keeps the current state.
   */
  function refreshCartVisibility() {
    if (!cartWatch.containers.length) return Promise.resolve();
    if (cartWatch.running) {
      cartWatch.rerun = true; // at most one queued re-run per burst
      return Promise.resolve();
    }
    cartWatch.running = true;
    return fetchStableCart()
      .then(function (cart) {
        applyCartVisibility(cart);
      })
      .catch(function () {
        // Transient cart.js failure: keep current visibility, no CP, no throw.
      })
      .then(function () {
        cartWatch.running = false;
        if (cartWatch.rerun) {
          cartWatch.rerun = false;
          refreshCartVisibility();
        }
      });
  }

  function applyCartVisibility(cart) {
    for (var i = 0; i < cartWatch.containers.length; i++) {
      var container = cartWatch.containers[i];
      if (!container || container.isConnected === false) continue;
      container.hidden = !isCartAboveMinimum(container, cart);
    }
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function fetchCartOnce() {
    return fetch(transport.shopifyRoot() + "cart.js", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(function (response) {
      if (!response.ok) throw new Error("cart-request-failed");
      return response.json();
    });
  }

  function cartFingerprint(cart) {
    var items = cart && Array.isArray(cart.items) ? cart.items : [];
    var lines = items
      .map(function (item) {
        return [
          item.key || item.variant_id || "",
          item.quantity || 0,
          item.final_line_price != null
            ? item.final_line_price
            : item.line_price || 0,
        ].join(":");
      })
      .join("|");
    return [
      cart.item_count || 0,
      cart.total_price || 0,
      cart.currency || "",
      lines,
    ].join(";");
  }

  /**
   * Theme-neutral stability check against Ajax cart update races.
   * Up to 3 cart.js reads; returns the latest snapshot if fingerprints differ.
   * No infinite polling; no Dawn-specific hooks.
   */
  async function fetchStableCart() {
    var first = await fetchCartOnce();
    await delay(120);
    var second = await fetchCartOnce();
    if (cartFingerprint(first) === cartFingerprint(second)) return second;
    await delay(180);
    return fetchCartOnce();
  }

  function buildPayload(container, cart) {
    var items = cart && Array.isArray(cart.items) ? cart.items : [];
    if (!items.length) throw new Error("empty-cart");

    var cartIdentity = cart && cart.token;
    if (typeof cartIdentity !== "string" || !cartIdentity.trim()) {
      throw new Error("invalid-cart-identity");
    }

    return {
      payload_version: 2,
      source: "cart",
      unicid: container.dataset.unicid || "",
      shop_domain: container.dataset.shopDomain || window.location.hostname,
      shop_permanent_domain: container.dataset.shopPermanentDomain || "",
      cart_identity: cartIdentity,
    };
  }

  function showError(container, message) {
    var error = container.querySelector(".uni-cart-error");
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  function clearError(container) {
    var error = container.querySelector(".uni-cart-error");
    if (error) {
      error.textContent = "";
      error.hidden = true;
    }
  }

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;

    var modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "uni-cart-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="uni-cart-modal__overlay"></div>' +
      '<div class="uni-cart-modal__dialog" role="dialog" aria-modal="true" aria-label="UniCredit финансиране">' +
      '<button type="button" class="uni-cart-modal__close" aria-label="Затвори">&times;</button>' +
      '<div class="uni-cart-modal__frame-wrap"></div>' +
      "</div>";

    modal
      .querySelector(".uni-cart-modal__close")
      .addEventListener("click", closeModal);
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    if (transport.getFlow() !== "cart") return;

    // End flow first so ready timeout cannot fire into a closing modal.
    transport.end("cart");

    var modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      var wrap = modal.querySelector(".uni-cart-modal__frame-wrap");
      if (wrap) wrap.replaceChildren();
    }
  }

  function postToIframe(payload) {
    if (!transport.isConfigured() || !transport.CP_URL) {
      throw new Error("invalid-cp-config");
    }
    if (
      !transport.begin("cart", {
        modalId: MODAL_ID,
        closeImpl: closeModal,
      })
    ) {
      throw new Error("flow-busy");
    }

    var modal = ensureModal();
    var wrap = modal.querySelector(".uni-cart-modal__frame-wrap");
    wrap.innerHTML =
      '<div class="uni-cart-modal__status" data-uni-frame-status role="status">Зареждане…</div>';

    var iframe = document.createElement("iframe");
    iframe.name = IFRAME_NAME;
    iframe.className = "uni-cart-modal__frame";
    iframe.title = "UniCredit финансиране";
    iframe.allow = "payment";
    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");

    wrap.appendChild(iframe);
    // Containment: iframe stays hidden until trusted uni:ready (transport).
    // iframe load is NOT authority to reveal.
    transport.setIframe(iframe, { wrap: wrap });
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    var form = document.createElement("form");
    form.method = "POST";
    form.action = transport.CP_URL;
    form.target = iframe.name;
    form.hidden = true;

    Object.keys(payload).forEach(function (key) {
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = String(payload[key]);
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

  async function handleClick(container, button) {
    if (requestInProgress || transport.isActive()) return;
    requestInProgress = true;
    button.disabled = true;
    clearError(container);

    try {
      var unicid = (container.dataset.unicid || "").trim();
      if (!unicid) {
        showError(
          container,
          "Финансирането не е конфигурирано. Моля, свържете се с магазина.",
        );
        return;
      }

      var cart = await fetchStableCart();
      var payload = buildPayload(container, cart);

      if (!payload.shop_permanent_domain) throw new Error("invalid-context");

      // Local minimum gate: a cart below uni_min_price never reaches CP.
      if (!isCartAboveMinimum(container, cart)) {
        container.hidden = true;
        return;
      }

      // Same authoritative snapshot also refreshes visibility that the scoped
      // watcher may have missed, and re-arms the watcher if the theme replaced
      // the Cart section without a section:load.
      ensureCartObservation(container);
      applyCartVisibility(cart);

      postToIframe(payload);
    } catch (error) {
      var code = error && error.message ? error.message : "";
      if (code === "empty-cart") {
        showError(
          container,
          "Количката е празна. Добавете продукти, за да продължите.",
        );
      } else {
        showError(
          container,
          "Финансирането не може да бъде заредено в момента. Моля, опитайте отново.",
        );
      }
    } finally {
      requestInProgress = false;
      button.disabled = false;
    }
  }

  function initialize() {
    document
      .querySelectorAll("[data-uni-cart-button]")
      .forEach(function (container) {
        if (container.dataset.uniInitialized === "true") return;
        var button = container.querySelector(".uni-cart-button");
        if (!(button instanceof HTMLButtonElement)) return;
        container.dataset.uniInitialized = "true";
        button.addEventListener("click", function () {
          handleClick(container, button);
        });
        ensureCartObservation(container);
      });
  }

  function registerGlobalsOnce() {
    if (window[GLOBALS_KEY]) return;
    window[GLOBALS_KEY] = true;
    document.addEventListener("shopify:section:load", initialize);
  }

  registerGlobalsOnce();
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize);
  else initialize();

  if (typeof window !== "undefined" && window.__UNI_ENABLE_CART_TEST_API) {
    window.__UniCartTestApi = {
      buildPayload: buildPayload,
      resolveMinimumMinor: resolveMinimumMinor,
      isCartAboveMinimum: isCartAboveMinimum,
      fetchStableCart: fetchStableCart,
      handleClick: handleClick,
      resolveCartObservationScope: resolveCartObservationScope,
      isObservableScope: isObservableScope,
      ensureCartObservation: ensureCartObservation,
      scheduleCartRecheck: scheduleCartRecheck,
      refreshCartVisibility: refreshCartVisibility,
      applyCartVisibility: applyCartVisibility,
      cartWatch: cartWatch,
    };
  }
})();
