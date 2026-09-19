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
    if (!control) return false;
    if (control.disabled) return false;
    if (control.getAttribute && control.getAttribute("disabled") != null) {
      return false;
    }
    return true;
  }

  function isAssociatedWithForm(control, form) {
    if (!control || !form) return false;
    if (form.contains(control)) return true;
    var formAttr = control.getAttribute("form");
    if (formAttr && form.id && formAttr === form.id) return true;
    var owning = control.closest("form");
    return !!(owning && owning === form);
  }

  function collectGenericQuantityCandidates() {
    var nodes = document.querySelectorAll(QUANTITY_SELECTOR);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isUsableQuantityControl(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  /**
   * Quantity resolution — platform / generic first, theme-section last:
   * 1) quantity inside current add-to-cart form
   * 2) page-level input[form="<form-id>"] association
   * 3) generic Shopify quantity candidates (JET-compatible), filtered
   * 4) theme-section compatibility fallback
   * else → 1 (only when no control is associated)
   */
  function resolveQuantity(container) {
    var form = findProductForm(container);

    // Step 1 — explicit current product form
    if (form) {
      var inForm = form.querySelector(QUANTITY_SELECTOR);
      if (inForm) {
        return parseQuantityControl(inForm).value;
      }
    }

    // Step 2 — explicit HTML form association (page-level, not section-bound)
    if (form && form.id) {
      var formId = form.id;
      var linked = document.querySelectorAll(
        'input[name="quantity"][form], input[type="number"][name*="quantity"][form]',
      );
      for (var i = 0; i < linked.length; i++) {
        if (
          linked[i].getAttribute("form") === formId &&
          isUsableQuantityControl(linked[i])
        ) {
          return parseQuantityControl(linked[i]).value;
        }
      }
    }

    // Step 3 — generic Shopify quantity candidates (validated, never arbitrary first)
    var candidates = collectGenericQuantityCandidates();
    var associated = [];
    for (var a = 0; a < candidates.length; a++) {
      if (isAssociatedWithForm(candidates[a], form)) {
        associated.push(candidates[a]);
      }
    }

    // Case A / C — exactly one candidate associated with current product form
    if (associated.length === 1) {
      return parseQuantityControl(associated[0]).value;
    }

    // Case B — exactly one plausible generic quantity on the page
    if (candidates.length === 1) {
      var only = candidates[0];
      var owningForm = only.closest("form");
      var formAttr = only.getAttribute("form");
      var linkedElsewhere = formAttr && form && form.id && formAttr !== form.id;
      var ownedByOther =
        owningForm &&
        isAddToCartForm(owningForm) &&
        form &&
        owningForm !== form;
      if (!linkedElsewhere && !ownedByOther) {
        return parseQuantityControl(only).value;
      }
    }

    // Case D — multiple candidates with no unique association → do not guess

    // Step 4 — theme-section compatibility fallback ONLY
    var section = findProductSection(container);
    if (section) {
      var sectionNodes = section.querySelectorAll(QUANTITY_SELECTOR);
      var sectionPlausible = [];
      for (var s = 0; s < sectionNodes.length; s++) {
        var control = sectionNodes[s];
        if (!isUsableQuantityControl(control)) continue;
        var sFormAttr = control.getAttribute("form");
        var sOwning = control.closest("form");
        if (form) {
          if (isAssociatedWithForm(control, form)) {
            sectionPlausible.push(control);
            continue;
          }
          if (sFormAttr && form.id && sFormAttr !== form.id) continue;
          if (sOwning && isAddToCartForm(sOwning) && sOwning !== form) continue;
          if (!sFormAttr) sectionPlausible.push(control);
        } else if (!sFormAttr) {
          if (sOwning && isAddToCartForm(sOwning)) continue;
          sectionPlausible.push(control);
        }
      }
      if (sectionPlausible.length === 1) {
        return parseQuantityControl(sectionPlausible[0]).value;
      }
    }

    // Missing quantity control for this product context.
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
