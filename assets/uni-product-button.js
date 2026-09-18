(function () {
  "use strict";

  // TODO(Phase 6): replace with the contract-approved UniCredit CP Product URL.
  const UNI_CP_PRODUCT_URL = "";
  const MODAL_ID = "uni-product-modal";
  const MAX_QUANTITY = 9999;
  let requestInProgress = false;
  let previousBodyOverflow = "";

  function findProductForm(container) {
    var local = container.closest("form");
    if (local && /\/cart\/add/.test(local.getAttribute("action") || "")) return local;
    var form = document.querySelector('form[action*="/cart/add"], form[action*="cart/add"], form[data-type="add-to-cart-form"], form.product-form');
    return form instanceof HTMLFormElement ? form : null;
  }

  function positiveInteger(value) {
    var text = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return null;
    var number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function resolveVariantId(container) {
    var form = findProductForm(container);
    var control = form && form.querySelector('[name="id"]');
    var fromControl = control && positiveInteger(control.value);
    if (fromControl) return fromControl;

    var selectedJson = document.querySelector('script[type="application/json"][data-selected-variant]');
    if (selectedJson) {
      try {
        var selected = JSON.parse(selectedJson.textContent || "null");
        var fromJson = selected && positiveInteger(selected.id);
        if (fromJson) return fromJson;
      } catch (_ignored) {}
    }

    var radio = document.querySelector('input[type="radio"][data-variant-id]:checked');
    var fromRadio = radio && positiveInteger(radio.getAttribute("data-variant-id"));
    if (fromRadio) return fromRadio;
    return positiveInteger(container.dataset.initialVariantId);
  }

  function resolveQuantity(container) {
    var form = findProductForm(container);
    var control = (form && form.querySelector('[name="quantity"]')) || document.querySelector('[name="quantity"]');
    if (!control) return 1;
    var quantity = positiveInteger(control.value);
    return quantity && quantity <= MAX_QUANTITY ? quantity : null;
  }

  function shopifyRoot() {
    var root = window.Shopify && window.Shopify.routes && window.Shopify.routes.root;
    root = typeof root === "string" && root ? root : "/";
    return root.endsWith("/") ? root : root + "/";
  }

  async function fetchVariant(variantId) {
    var response = await fetch(shopifyRoot() + "variants/" + encodeURIComponent(String(variantId)) + ".js", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("variant-request-failed");
    var variant = await response.json();
    if (positiveInteger(variant.id) !== variantId) throw new Error("variant-mismatch");
    if (!Number.isSafeInteger(variant.price) || variant.price <= 0) throw new Error("invalid-price");
    if (variant.available === false) throw new Error("variant-unavailable");
    return variant;
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

  function buildPayload(container, variant, quantity) {
    var total = variant.price * quantity;
    if (!Number.isSafeInteger(total)) throw new Error("invalid-total");
    var names = optionNames(container);
    var values = Array.isArray(variant.options) ? variant.options : [];
    return {
      shop_domain: container.dataset.shopDomain || window.location.hostname,
      shop_permanent_domain: container.dataset.shopPermanentDomain || "",
      unicid: container.dataset.unicid || "",
      product_id: positiveInteger(container.dataset.productId),
      product_title: container.dataset.productTitle || "",
      product_handle: container.dataset.productHandle || "",
      variant_id: positiveInteger(variant.id),
      variant_title: typeof variant.title === "string" ? variant.title : "",
      selected_options: values.map(function (value, index) {
        return { name: names[index] || "Option " + (index + 1), value: String(value) };
      }),
      quantity: quantity,
      unit_price_cents: variant.price,
      total_price_cents: total,
      currency: container.dataset.currency || "",
      source: "product"
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
    if (error) { error.textContent = ""; error.hidden = true; }
  }

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;
    var modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "uni-product-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '<div class="uni-product-modal__overlay"></div><div class="uni-product-modal__dialog" role="dialog" aria-modal="true" aria-label="UniCredit финансиране"><button type="button" class="uni-product-modal__close" aria-label="Затвори">&times;</button><div class="uni-product-modal__frame-wrap"></div></div>';
    modal.querySelector(".uni-product-modal__overlay").addEventListener("click", closeModal);
    modal.querySelector(".uni-product-modal__close").addEventListener("click", closeModal);
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    var wrap = modal.querySelector(".uni-product-modal__frame-wrap");
    if (wrap) wrap.replaceChildren();
    document.body.style.overflow = previousBodyOverflow;
  }

  function postToIframe(payload) {
    var modal = ensureModal();
    var wrap = modal.querySelector(".uni-product-modal__frame-wrap");
    wrap.innerHTML = '<div class="uni-product-modal__status" role="status">Зареждане…</div>';
    var iframe = document.createElement("iframe");
    iframe.name = "uni-product-frame";
    iframe.className = "uni-product-modal__frame";
    iframe.title = "UniCredit финансиране";
    iframe.allow = "payment";
    var submitted = false;
    iframe.addEventListener("load", function () {
      if (submitted) {
        var status = wrap.querySelector(".uni-product-modal__status");
        if (status) status.remove();
      }
    });
    iframe.addEventListener("error", function () {
      wrap.innerHTML = '<div class="uni-product-modal__status" role="alert">Услугата не може да бъде заредена. Моля, опитайте отново.</div>';
    });
    wrap.appendChild(iframe);
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    var form = document.createElement("form");
    form.method = "POST";
    form.action = UNI_CP_PRODUCT_URL;
    form.target = iframe.name;
    form.hidden = true;
    Object.keys(payload).forEach(function (key) {
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = typeof payload[key] === "object" ? JSON.stringify(payload[key]) : String(payload[key]);
      form.appendChild(input);
    });
    document.body.appendChild(form);
    submitted = true;
    form.submit();
    form.remove();
  }

  async function handleClick(container, button) {
    if (requestInProgress) return;
    requestInProgress = true;
    button.disabled = true;
    clearError(container);
    try {
      var variantId = resolveVariantId(container);
      if (!variantId) throw new Error("invalid-variant");
      var quantity = resolveQuantity(container);
      if (!quantity) throw new Error("invalid-quantity");
      var variant = await fetchVariant(variantId);
      var payload = buildPayload(container, variant, quantity);
      if (!payload.unicid || !payload.product_id || !payload.currency) throw new Error("invalid-context");
      if (!UNI_CP_PRODUCT_URL) throw new Error("missing-cp-url");
      postToIframe(payload);
    } catch (_error) {
      showError(container, "Финансирането не може да бъде заредено в момента. Моля, опитайте отново.");
    } finally {
      requestInProgress = false;
      button.disabled = false;
    }
  }

  function initialize() {
    document.querySelectorAll("[data-uni-product-button]").forEach(function (container) {
      if (container.dataset.uniInitialized === "true") return;
      var button = container.querySelector(".uni-product-button");
      if (!(button instanceof HTMLButtonElement)) return;
      container.dataset.uniInitialized = "true";
      button.addEventListener("click", function () { handleClick(container, button); });
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeModal();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
  document.addEventListener("shopify:section:load", initialize);
})();
