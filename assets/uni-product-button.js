(function () {
  "use strict";

  var transport = window.__UniTransport;
  if (!transport) return;

  var MODAL_ID = "uni-product-modal";
  var IFRAME_NAME = "uni-product-frame";
  var MAX_QUANTITY = 9999;
  var GLOBALS_KEY = "__uniProductButtonGlobalsBound";
  var requestInProgress = false;

  /**
   * Local financing minimum (uni_min_price).
   * Merchants configure whole major units; Liquid renders minor units.
   * Missing/invalid configuration falls back to 50 (5000 minor units).
   */
  var DEFAULT_MIN_PRICE_MAJOR = 50;
  var MINOR_UNITS_FACTOR = 100;
  var DEFAULT_MIN_PRICE_MINOR = DEFAULT_MIN_PRICE_MAJOR * MINOR_UNITS_FACTOR;

  /** One-tick deferral so theme variant handlers settle before re-checking. */
  var scheduleTick =
    typeof setTimeout === "function"
      ? function (fn) {
          setTimeout(fn, 0);
        }
      : function (fn) {
          fn();
        };

  /**
   * Coalesce bursts of variant/quantity events into a single re-check
   * per slot (no polling: the timer only fires once per burst).
   */
  function scheduleEligibilitySync(container) {
    if (container.uniEligibilitySyncPending) return;
    container.uniEligibilitySyncPending = true;
    scheduleTick(function () {
      container.uniEligibilitySyncPending = false;
      syncSlotVisibility(container);
    });
  }

  function positiveInteger(value) {
    var text = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return null;
    var number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  /** Non-negative integer — prices may legitimately be 0 (below any minimum). */
  function nonNegativeInteger(value) {
    var text = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return null;
    var number = Number(text);
    return Number.isSafeInteger(number) ? number : null;
  }

  function isAddToCartForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    var action = form.getAttribute("action") || "";
    if (/\/cart\/add/.test(action) || /cart\/add/.test(action)) return true;
    var type = form.getAttribute("data-type") || "";
    if (type === "add-to-cart-form") return true;
    if (form.classList && form.classList.contains("product-form")) return true;
    return false;
  }

  /**
   * Resolve current add-to-cart form using platform conventions first.
   * Theme section wrappers are only a last-resort scope hint.
   */
  function findProductForm(container) {
    var local = container.closest("form");
    if (isAddToCartForm(local)) return local;

    var formSelector =
      'form[action*="/cart/add"], form[action*="cart/add"], form[data-type="add-to-cart-form"], form.product-form';

    // Walk ancestors: prefer a uniquely determined add-to-cart form in the subtree.
    var node = container.parentElement;
    while (
      node &&
      node !== document.body &&
      node !== document.documentElement
    ) {
      var nested = node.querySelectorAll(formSelector);
      var addForms = [];
      for (var i = 0; i < nested.length; i++) {
        if (isAddToCartForm(nested[i])) addForms.push(nested[i]);
      }
      if (addForms.length === 1) return addForms[0];
      for (var j = 0; j < addForms.length; j++) {
        if (addForms[j].contains(container)) return addForms[j];
      }
      node = node.parentElement;
    }

    // Theme-section fallback only (not primary architectural contract).
    var section = container.closest(
      ".shopify-section, [id^='shopify-section'], [data-section-id]",
    );
    if (section) {
      var sectionForms = section.querySelectorAll(formSelector);
      if (sectionForms.length === 1 && isAddToCartForm(sectionForms[0])) {
        return sectionForms[0];
      }
      for (var k = 0; k < sectionForms.length; k++) {
        if (
          sectionForms[k].contains(container) &&
          isAddToCartForm(sectionForms[k])
        ) {
          return sectionForms[k];
        }
      }
    }

    return null;
  }

  function resolveScope(container, form) {
    if (form) return form;
    return (
      container.closest(
        ".shopify-section, [id^='shopify-section'], [data-section-id]",
      ) || container
    );
  }

  function findProductSection(container) {
    return (
      container.closest(
        ".shopify-section, [id^='shopify-section'], [data-section-id]",
      ) || null
    );
  }

  // JET-compatible generic Shopify quantity selectors (theme-agnostic).
  var QUANTITY_SELECTOR =
    'input[name="quantity"], input[type="number"][name*="quantity"]';

  function parseQuantityControl(control) {
    if (!control) return { found: false, value: null };
    var quantity = positiveInteger(control.value);
    if (quantity && quantity <= MAX_QUANTITY) {
      return { found: true, value: quantity };
    }
    // Control exists but value is invalid — reject (do not silently use 1).
    return { found: true, value: null };
  }

  function isUsableQuantityControl(control) {
    if (
      !control ||
      !control.tagName ||
      control.tagName.toLowerCase() !== "input"
    ) {
      return false;
    }
    if (control.disabled) return false;
    if (control.getAttribute && control.getAttribute("disabled") != null) {
      return false;
    }
    return true;
  }

  /**
   * Visibility as ranking/disambiguation signal only — not an absolute requirement.
   * Themes may drive a visually hidden native input from custom UI.
   */
  function isPresentedQuantityControl(control) {
    if (!control) return false;
    if (control.type === "hidden") return false;
    if (control.hidden) return false;
    if (
      control.getAttribute &&
      control.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    var inline = (control.getAttribute && control.getAttribute("style")) || "";
    if (/display\s*:\s*none/i.test(inline)) return false;
    if (/visibility\s*:\s*hidden/i.test(inline)) return false;
    try {
      if (typeof window !== "undefined" && window.getComputedStyle) {
        var cs = window.getComputedStyle(control);
        if (cs && (cs.display === "none" || cs.visibility === "hidden")) {
          return false;
        }
      }
    } catch (_ignored) {}
    return true;
  }

  function getControlForm(control) {
    if (!control) return null;
    if (control.form instanceof HTMLFormElement) return control.form;
    var formAttr = control.getAttribute && control.getAttribute("form");
    if (formAttr && document.getElementById) {
      var byId = document.getElementById(formAttr);
      if (byId instanceof HTMLFormElement) return byId;
    }
    var closest = control.closest && control.closest("form");
    return closest instanceof HTMLFormElement ? closest : null;
  }

  function associationRank(control, form) {
    if (!control || !form) return 0;
    var linked = getControlForm(control);
    if (linked === form) return 4;
    var formAttr = control.getAttribute("form");
    if (formAttr && form.id && formAttr === form.id) return 3;
    if (form.contains(control)) return 2;
    return 0;
  }

  function collectGenericQuantityCandidates() {
    var nodes = document.querySelectorAll(QUANTITY_SELECTOR);
    var usable = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isUsableQuantityControl(nodes[i])) usable.push(nodes[i]);
    }
    if (!usable.length) return usable;

    // Drop obviously stale/hidden duplicates when a presented control exists.
    // If ALL candidates are visually hidden (custom UI wrappers), keep them.
    var presented = [];
    for (var p = 0; p < usable.length; p++) {
      if (isPresentedQuantityControl(usable[p])) presented.push(usable[p]);
    }
    return presented.length ? presented : usable;
  }

  function pickUniqueByAssociation(candidates, form) {
    if (!form || !candidates.length) return null;
    var bestRank = 0;
    var winners = [];
    for (var i = 0; i < candidates.length; i++) {
      var rank = associationRank(candidates[i], form);
      if (rank > bestRank) {
        bestRank = rank;
        winners = [candidates[i]];
      } else if (rank > 0 && rank === bestRank) {
        winners.push(candidates[i]);
      }
    }
    if (bestRank === 0) return null;
    if (winners.length === 1) return winners[0];

    var visibleWinners = [];
    for (var v = 0; v < winners.length; v++) {
      if (isPresentedQuantityControl(winners[v])) {
        visibleWinners.push(winners[v]);
      }
    }
    if (visibleWinners.length === 1) return visibleWinners[0];
    return null;
  }

  /**
   * Quantity resolution — JET-compatible generic discovery FIRST.
   * findProductForm() is used only to disambiguate multiple candidates.
   *
   * 1) collect generic Shopify quantity candidates
   * 2) exactly one candidate → use it (JET behavior)
   * 3) multiple → associate/rank via current add-to-cart form
   * 4) visible tie-break among remaining same-rank duplicates
   * 5) genuine ambiguity → no single control
   *
   * resolveQuantity() reuses this exact policy, so local visibility and the
   * CP payload can never read two different quantity definitions.
   * @returns {Element|null} the one proven quantity control, if any
   */
  function resolveQuantityControl(container) {
    var candidates = collectGenericQuantityCandidates();

    // A — exactly one generic candidate (proven JET path)
    if (candidates.length === 1) {
      return candidates[0];
    }

    if (candidates.length === 0) {
      return null;
    }

    // B — multiple candidates: form association only as disambiguation
    var form = findProductForm(container);
    var associated = pickUniqueByAssociation(candidates, form);
    if (associated) {
      return associated;
    }

    // C — visible/interactive tie-break when one presented remains
    var presented = [];
    for (var i = 0; i < candidates.length; i++) {
      if (isPresentedQuantityControl(candidates[i]))
        presented.push(candidates[i]);
    }
    if (presented.length === 1) {
      return presented[0];
    }

    // D — genuine multi-product ambiguity: do not pick arbitrary first
    return null;
  }

  /**
   * Quantity value for the existing Product behavior.
   * Invalid explicit selected value → null (fail safely);
   * no control or genuine ambiguity → 1.
   */
  function resolveQuantity(container) {
    var control = resolveQuantityControl(container);
    if (control) return parseQuantityControl(control).value;
    return 1;
  }

  function resolveVariantId(container) {
    var form = findProductForm(container);
    if (form) {
      var control = form.querySelector('[name="id"]');
      var fromControl = control && positiveInteger(control.value);
      if (fromControl) return fromControl;

      var radioInForm = form.querySelector(
        'input[type="radio"][data-variant-id]:checked',
      );
      var fromRadioForm =
        radioInForm &&
        positiveInteger(radioInForm.getAttribute("data-variant-id"));
      if (fromRadioForm) return fromRadioForm;
    }

    var scope = resolveScope(container, form);
    var selectedJson = scope.querySelector(
      'script[type="application/json"][data-selected-variant]',
    );
    if (selectedJson) {
      try {
        var selected = JSON.parse(selectedJson.textContent || "null");
        var fromJson = selected && positiveInteger(selected.id);
        if (fromJson) return fromJson;
      } catch (_ignored) {}
    }

    var radio = scope.querySelector(
      'input[type="radio"][data-variant-id]:checked',
    );
    var fromRadio =
      radio && positiveInteger(radio.getAttribute("data-variant-id"));
    if (fromRadio) return fromRadio;

    // Deterministic Liquid fallback for this product container only.
    return positiveInteger(container.dataset.initialVariantId);
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
   * Selected variant price in minor units, taken from the variant price map
   * Liquid already rendered for this product. Local data only — no Shopify
   * request, no polling.
   * @returns {number|null} null when no local price is available
   */
  function resolveVariantPriceMinor(container, variantId) {
    var raw =
      container && container.dataset ? container.dataset.uniVariantPrices : null;
    if (typeof raw !== "string" || !raw.trim()) return null;
    var map = null;
    try {
      map = JSON.parse(raw);
    } catch (_ignored) {
      return null;
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) return null;
    var key = String(variantId);
    if (!Object.prototype.hasOwnProperty.call(map, key)) return null;
    return nonNegativeInteger(map[key]);
  }

  /**
   * Product amount for the local gate: selected variant price × selected
   * quantity, in minor units. Integer arithmetic only — no floating point
   * money math, no extra Shopify request.
   * @returns {number|null} null when no local price is available
   */
  function resolveProductAmountMinor(container, variantId, quantity) {
    var price = resolveVariantPriceMinor(container, variantId);
    if (price == null) return null;
    var count = positiveInteger(quantity) || 1;
    return price * count;
  }

  /**
   * Local minimum gate: financing continues only when the selected variant is
   * known and variant price × quantity is at or above the configured minimum.
   * An unavailable local price keeps the pre-existing eligibility behavior.
   */
  function isAmountAboveMinimum(container, variantId, quantity) {
    if (!variantId) return false;
    var amount = resolveProductAmountMinor(container, variantId, quantity);
    if (amount == null) return true;
    return amount >= resolveMinimumMinor(container);
  }

  /**
   * Quantity used for local visibility only. An invalid/absent quantity falls
   * back to 1 (the existing safe Shopify behavior); the click-time gate still
   * rejects an explicitly invalid quantity before any CP request.
   */
  function resolveVisibilityQuantity(container) {
    return positiveInteger(resolveQuantity(container)) || 1;
  }

  /**
   * Keep the slot visible only while the current product amount (variant
   * price × quantity) passes the local minimum. The server-rendered hidden
   * state is the initial value; this only re-syncs the same slot in place.
   */
  function syncSlotVisibility(container) {
    var variantId = resolveVariantId(container);
    var quantity = resolveVisibilityQuantity(container);
    var eligible = variantId
      ? isAmountAboveMinimum(container, variantId, quantity)
      : true;
    container.hidden = !eligible;
    return eligible;
  }

  /**
   * Drop this slot's previously bound change/input listeners so repeated
   * initialization (or a replaced form) can never stack handlers.
   */
  function unbindProductChange(container) {
    var previous = container.uniChangeBindings;
    if (!previous || !previous.length) return;
    for (var i = 0; i < previous.length; i++) {
      var binding = previous[i];
      if (
        binding.target &&
        typeof binding.target.removeEventListener === "function"
      ) {
        binding.target.removeEventListener(binding.type, binding.handler);
      }
    }
    container.uniChangeBindings = [];
  }

  /**
   * Variant and quantity changes: listeners scoped to the current add-to-cart
   * form (proven Shopify variant control container), falling back to the theme
   * section, plus the one resolved quantity control so themes that dispatch
   * non-bubbling change/input on the control itself are still observed.
   * No document-level listeners, no polling.
   */
  function bindProductChange(container) {
    unbindProductChange(container);
    var scope = findProductForm(container) || findProductSection(container);
    var targets = [];
    if (scope && typeof scope.addEventListener === "function") {
      targets.push(scope);
    }
    var control = resolveQuantityControl(container);
    if (
      control &&
      typeof control.addEventListener === "function" &&
      targets.indexOf(control) === -1
    ) {
      targets.push(control);
    }
    if (!targets.length) return;

    function onControlChange() {
      // Defer one tick so theme handlers settle the selection/value first.
      scheduleEligibilitySync(container);
    }

    var bound = [];
    for (var i = 0; i < targets.length; i++) {
      targets[i].addEventListener("change", onControlChange);
      targets[i].addEventListener("input", onControlChange);
      bound.push({
        target: targets[i],
        type: "change",
        handler: onControlChange,
      });
      bound.push({
        target: targets[i],
        type: "input",
        handler: onControlChange,
      });
    }
    container.uniChangeBindings = bound;
  }

  function buildPayload(container, variantId, quantity) {
    return {
      payload_version: 2,
      source: "product",
      unicid: container.dataset.unicid || "",
      shop_domain: container.dataset.shopDomain || window.location.hostname,
      shop_permanent_domain: container.dataset.shopPermanentDomain || "",
      variant_id: variantId,
      quantity: quantity,
    };
  }

  function showError(container, message) {
    var error = container.querySelector(".uni-product-error");
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  function clearError(container) {
    var error = container.querySelector(".uni-product-error");
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
    modal.className = "uni-product-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="uni-product-modal__overlay"></div>' +
      '<div class="uni-product-modal__dialog" role="dialog" aria-modal="true" aria-label="UniCredit финансиране">' +
      '<button type="button" class="uni-product-modal__close" aria-label="Затвори">&times;</button>' +
      '<div class="uni-product-modal__frame-wrap"></div>' +
      "</div>";

    modal
      .querySelector(".uni-product-modal__close")
      .addEventListener("click", closeModal);
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    if (transport.getFlow() !== "product") return;

    // End flow first so ready timeout cannot fire into a closing modal.
    transport.end("product");

    var modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      var wrap = modal.querySelector(".uni-product-modal__frame-wrap");
      if (wrap) wrap.replaceChildren();
    }
  }

  function postToIframe(payload) {
    if (!transport.isConfigured() || !transport.CP_URL) {
      throw new Error("invalid-cp-config");
    }
    if (
      !transport.begin("product", {
        modalId: MODAL_ID,
        closeImpl: closeModal,
      })
    ) {
      throw new Error("flow-busy");
    }

    var modal = ensureModal();
    var wrap = modal.querySelector(".uni-product-modal__frame-wrap");
    wrap.innerHTML =
      '<div class="uni-product-modal__status" data-uni-frame-status role="status">Зареждане…</div>';

    var iframe = document.createElement("iframe");
    iframe.name = IFRAME_NAME;
    iframe.className = "uni-product-modal__frame";
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

      var variantId = resolveVariantId(container);
      if (!variantId) throw new Error("invalid-variant");

      var quantity = resolveQuantity(container);
      if (!quantity) throw new Error("invalid-quantity");

      var payload = buildPayload(container, variantId, quantity);

      if (!payload.shop_permanent_domain) throw new Error("invalid-context");

      // Local minimum gate: variant price × quantity below uni_min_price
      // never reaches CP.
      if (!isAmountAboveMinimum(container, variantId, quantity)) {
        container.hidden = true;
        return;
      }

      postToIframe(payload);
    } catch (_error) {
      showError(
        container,
        "Финансирането не може да бъде заредено в момента. Моля, опитайте отново.",
      );
    } finally {
      requestInProgress = false;
      button.disabled = false;
    }
  }

  function initialize() {
    document
      .querySelectorAll("[data-uni-product-button]")
      .forEach(function (container) {
        if (container.dataset.uniInitialized === "true") return;
        var button = container.querySelector(".uni-product-button");
        if (!(button instanceof HTMLButtonElement)) return;
        if (container.dataset.uniInitialized !== "true") {
          container.dataset.uniInitialized = "true";
          button.addEventListener("click", function () {
            handleClick(container, button);
          });
        }
        // Re-sync and re-bind on every (re)initialization: a replaced form or
        // quantity control must not leave stale listeners behind, and binding
        // always unbinds first so no duplicates accumulate.
        syncSlotVisibility(container);
        bindProductChange(container);
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

  if (typeof window !== "undefined" && window.__UNI_ENABLE_PRODUCT_TEST_API) {
    window.__UniProductTestApi = {
      resolveQuantity: resolveQuantity,
      resolveVariantId: resolveVariantId,
      buildPayload: buildPayload,
      findProductForm: findProductForm,
      findProductSection: findProductSection,
      resolveMinimumMinor: resolveMinimumMinor,
      resolveVariantPriceMinor: resolveVariantPriceMinor,
      resolveProductAmountMinor: resolveProductAmountMinor,
      isAmountAboveMinimum: isAmountAboveMinimum,
      resolveVisibilityQuantity: resolveVisibilityQuantity,
      resolveQuantityControl: resolveQuantityControl,
      syncSlotVisibility: syncSlotVisibility,
      bindProductChange: bindProductChange,
      handleClick: handleClick,
    };
  }
})();
