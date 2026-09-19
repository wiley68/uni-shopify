(function () {
  "use strict";

  var transport = window.__UniTransport;
  if (!transport) return;

  var MODAL_ID = "uni-product-modal";
  var IFRAME_NAME = "uni-product-frame";
  var MAX_QUANTITY = 9999;
  var GLOBALS_KEY = "__uniProductButtonGlobalsBound";
  var requestInProgress = false;

  function positiveInteger(value) {
    var text = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return null;
    var number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
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
   * 5) genuine ambiguity → safe fallback 1
   * Invalid explicit selected value → null (fail safely)
   */
  function resolveQuantity(container) {
    var candidates = collectGenericQuantityCandidates();

    // A — exactly one generic candidate (proven JET path)
    if (candidates.length === 1) {
      return parseQuantityControl(candidates[0]).value;
    }

    if (candidates.length === 0) {
      return 1;
    }

    // B — multiple candidates: form association only as disambiguation
    var form = findProductForm(container);
    var associated = pickUniqueByAssociation(candidates, form);
    if (associated) {
      return parseQuantityControl(associated).value;
    }

    // C — visible/interactive tie-break when one presented remains
    var presented = [];
    for (var i = 0; i < candidates.length; i++) {
      if (isPresentedQuantityControl(candidates[i]))
        presented.push(candidates[i]);
    }
    if (presented.length === 1) {
      return parseQuantityControl(presented[0]).value;
    }

    // D — genuine multi-product ambiguity: do not pick arbitrary first
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

  async function fetchVariant(variantId) {
    var response = await fetch(
      transport.shopifyRoot() +
        "variants/" +
        encodeURIComponent(String(variantId)) +
        ".js",
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) throw new Error("variant-request-failed");
    var variant = await response.json();
    if (positiveInteger(variant.id) !== variantId)
      throw new Error("variant-mismatch");
    if (!Number.isSafeInteger(variant.price) || variant.price <= 0)
      throw new Error("invalid-price");
    if (variant.available === false) throw new Error("variant-unavailable");
    return variant;
  }

  /**
   * Prove variant belongs to the Liquid product via products/{handle}.js.
   */
  async function assertVariantBelongsToProduct(
    productId,
    productHandle,
    variantId,
  ) {
    if (!productHandle) throw new Error("missing-handle");
    var response = await fetch(
      transport.shopifyRoot() +
        "products/" +
        encodeURIComponent(productHandle) +
        ".js",
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) throw new Error("product-request-failed");
    var product = await response.json();
    if (positiveInteger(product.id) !== productId)
      throw new Error("product-id-mismatch");
    var variants = Array.isArray(product.variants) ? product.variants : [];
    var belongs = variants.some(function (entry) {
      return positiveInteger(entry.id) === variantId;
    });
    if (!belongs) throw new Error("variant-not-in-product");
  }

  /**
   * Presentment currency matching Ajax monetary values.
   * Prefer Shopify.currency.active; fallback cart.js currency.
   */
  async function resolvePresentmentCurrency() {
    var fromShopify =
      window.Shopify &&
      window.Shopify.currency &&
      window.Shopify.currency.active;
    var validated = transport.validateCurrency(fromShopify);
    if (validated) return validated;

    var response = await fetch(transport.shopifyRoot() + "cart.js", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("currency-request-failed");
    var cart = await response.json();
    validated = transport.validateCurrency(cart.currency);
    if (validated) return validated;
    throw new Error("invalid-currency");
  }

  function optionNames(container) {
    var node = container.querySelector("[data-uni-option-names]");
    try {
      var names = JSON.parse((node && node.textContent) || "[]");
      return Array.isArray(names) ? names : [];
    } catch (_ignored) {
      return [];
    }
  }

  function buildPayload(container, variant, quantity, currency) {
    var unitPrice = variant.price;
    var lineTotal = unitPrice * quantity;
    if (!Number.isSafeInteger(lineTotal)) throw new Error("invalid-total");

    var names = optionNames(container);
    var values = Array.isArray(variant.options) ? variant.options : [];
    var productId = positiveInteger(container.dataset.productId);
    var variantId = positiveInteger(variant.id);
    if (!productId || !variantId) throw new Error("invalid-ids");

    var products = [
      {
        product_id: productId,
        product_title: container.dataset.productTitle || "",
        product_handle: container.dataset.productHandle || "",
        variant_id: variantId,
        variant_title: typeof variant.title === "string" ? variant.title : "",
        selected_options: values.map(function (value, index) {
          return {
            name: names[index] || "Option " + (index + 1),
            value: String(value),
          };
        }),
        quantity: quantity,
        unit_price_cents: unitPrice,
        total_price_cents: lineTotal,
      },
    ];

    return {
      source: "product",
      shop_domain: container.dataset.shopDomain || window.location.hostname,
      shop_permanent_domain: container.dataset.shopPermanentDomain || "",
      unicid: container.dataset.unicid || "",
      currency: currency,
      products: JSON.stringify(products),
      total_price_cents: lineTotal,
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

    var modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      var wrap = modal.querySelector(".uni-product-modal__frame-wrap");
      if (wrap) wrap.replaceChildren();
    }
    transport.end("product");
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
      '<div class="uni-product-modal__status" role="status">Зареждане…</div>';

    var iframe = document.createElement("iframe");
    iframe.name = IFRAME_NAME;
    iframe.className = "uni-product-modal__frame";
    iframe.title = "UniCredit финансиране";
    iframe.allow = "payment";

    var submitted = false;
    iframe.addEventListener("load", function () {
      if (!submitted) return;
      var status = wrap.querySelector(".uni-product-modal__status");
      if (status) status.remove();
    });
    iframe.addEventListener("error", function () {
      wrap.innerHTML =
        '<div class="uni-product-modal__status" role="alert">Услугата не може да бъде заредена. Моля, опитайте отново.</div>';
    });

    wrap.appendChild(iframe);
    transport.setIframe(iframe);
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
    submitted = true;
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

      var productId = positiveInteger(container.dataset.productId);
      var productHandle = container.dataset.productHandle || "";
      if (!productId || !productHandle)
        throw new Error("invalid-product-context");

      var variantId = resolveVariantId(container);
      if (!variantId) throw new Error("invalid-variant");

      var quantity = resolveQuantity(container);
      if (!quantity) throw new Error("invalid-quantity");

      var variant = await fetchVariant(variantId);
      await assertVariantBelongsToProduct(productId, productHandle, variantId);

      var currency = await resolvePresentmentCurrency();
      var payload = buildPayload(container, variant, quantity, currency);

      if (!payload.shop_permanent_domain) throw new Error("invalid-context");

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
        container.dataset.uniInitialized = "true";
        button.addEventListener("click", function () {
          handleClick(container, button);
        });
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
      findProductForm: findProductForm,
      findProductSection: findProductSection,
    };
  }
})();
