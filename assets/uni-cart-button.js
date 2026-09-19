(function () {
  "use strict";

  // Temporary DEV/TEST CP echo endpoint — not a production URL.
  // Shared with Product to prove the common Product/Cart protocol.
  var UNI_CP_URL = "https://uni.avalonbg.com/shopify/product-test";
  var UNI_CP_ORIGIN = "https://uni.avalonbg.com";
  var MODAL_ID = "uni-cart-modal";
  var IFRAME_NAME = "uni-cart-frame";
  var MAX_QUANTITY = 9999;
  var GLOBALS_KEY = "__uniCartButtonGlobalsBound";
  var requestInProgress = false;
  var previousBodyOverflow = "";

  function shopifyRoot() {
    var root =
      window.Shopify && window.Shopify.routes && window.Shopify.routes.root;
    root = typeof root === "string" && root ? root : "/";
    return root.endsWith("/") ? root : root + "/";
  }

  function isNonNegativeSafeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function positiveInteger(value) {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    }
    var text = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return null;
    var number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function fetchCart() {
    return fetch(shopifyRoot() + "cart.js", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(function (response) {
      if (!response.ok) throw new Error("cart-request-failed");
      return response.json();
    });
  }

  /**
   * Effective unit price after line-level discounts.
   * Prefer final_price; fall back to price.
   */
  function lineUnitPriceCents(item) {
    if (isNonNegativeSafeInteger(item.final_price)) return item.final_price;
    if (isNonNegativeSafeInteger(item.price)) return item.price;
    return null;
  }

  /**
   * Effective line total after line-level discounts.
   * Prefer final_line_price; fall back to line_price; else unit * quantity.
   */
  function lineTotalCents(item, quantity, unitCents) {
    if (isNonNegativeSafeInteger(item.final_line_price))
      return item.final_line_price;
    if (isNonNegativeSafeInteger(item.line_price)) return item.line_price;
    var computed = unitCents * quantity;
    return isNonNegativeSafeInteger(computed) ? computed : null;
  }

  /**
   * Authoritative cart total after cart-level discounts.
   * Prefer cart.total_price; do not silently replace with sum of lines.
   */
  function cartTotalCents(cart) {
    if (isNonNegativeSafeInteger(cart.total_price)) return cart.total_price;
    return null;
  }

  function normalizeSelectedOptions(item) {
    var withValues = item.options_with_values;
    if (Array.isArray(withValues) && withValues.length) {
      return withValues.map(function (option, index) {
        var name =
          option && typeof option.name === "string" && option.name
            ? option.name
            : "Option " + (index + 1);
        var value = option && option.value != null ? String(option.value) : "";
        return { name: name, value: value };
      });
    }

    var values = Array.isArray(item.variant_options)
      ? item.variant_options
      : [];
    return values.map(function (value, index) {
      return { name: "Option " + (index + 1), value: String(value) };
    });
  }

  function normalizeCartItem(item) {
    var productId = positiveInteger(item.product_id);
    var variantId = positiveInteger(item.variant_id);
    var quantity = positiveInteger(item.quantity);
    if (!productId || !variantId || !quantity || quantity > MAX_QUANTITY) {
      throw new Error("invalid-item");
    }

    var unitCents = lineUnitPriceCents(item);
    if (unitCents === null) throw new Error("invalid-price");

    var totalCents = lineTotalCents(item, quantity, unitCents);
    if (totalCents === null || totalCents <= 0)
      throw new Error("invalid-line-total");

    return {
      product_id: productId,
      product_title:
        typeof item.product_title === "string" ? item.product_title : "",
      product_handle: typeof item.handle === "string" ? item.handle : "",
      variant_id: variantId,
      variant_title:
        typeof item.variant_title === "string" ? item.variant_title : "",
      selected_options: normalizeSelectedOptions(item),
      quantity: quantity,
      unit_price_cents: unitCents,
      total_price_cents: totalCents,
    };
  }

  function buildPayload(container, cart) {
    var items = cart && Array.isArray(cart.items) ? cart.items : [];
    if (!items.length) throw new Error("empty-cart");

    var products = items.map(normalizeCartItem);
    var total = cartTotalCents(cart);
    if (total === null || total <= 0) throw new Error("invalid-cart-total");

    return {
      source: "cart",
      shop_domain: container.dataset.shopDomain || window.location.hostname,
      shop_permanent_domain: container.dataset.shopPermanentDomain || "",
      unicid: container.dataset.unicid || "",
      currency: container.dataset.currency || "",
      products: JSON.stringify(products),
      total_price_cents: total,
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

    // Overlay click intentionally does NOT close the modal.
    modal
      .querySelector(".uni-cart-modal__close")
      .addEventListener("click", closeModal);
    document.body.appendChild(modal);
    return modal;
  }

  function isModalOpen() {
    var modal = document.getElementById(MODAL_ID);
    return !!(modal && modal.classList.contains("is-open"));
  }

  function closeModal() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    var wrap = modal.querySelector(".uni-cart-modal__frame-wrap");
    if (wrap) wrap.replaceChildren();
    document.body.style.overflow = previousBodyOverflow;
  }

  function onMessage(event) {
    if (event.origin !== UNI_CP_ORIGIN) return;
    var data = event.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    if (data.type !== "uni:close") return;
    closeModal();
  }

  function postToIframe(payload) {
    var modal = ensureModal();
    var wrap = modal.querySelector(".uni-cart-modal__frame-wrap");
    wrap.innerHTML =
      '<div class="uni-cart-modal__status" role="status">Зареждане…</div>';

    var iframe = document.createElement("iframe");
    iframe.name = IFRAME_NAME;
    iframe.className = "uni-cart-modal__frame";
    iframe.title = "UniCredit финансиране";
    iframe.allow = "payment";

    var submitted = false;
    iframe.addEventListener("load", function () {
      if (!submitted) return;
      var status = wrap.querySelector(".uni-cart-modal__status");
      if (status) status.remove();
    });
    iframe.addEventListener("error", function () {
      wrap.innerHTML =
        '<div class="uni-cart-modal__status" role="alert">Услугата не може да бъде заредена. Моля, опитайте отново.</div>';
    });

    wrap.appendChild(iframe);
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    var form = document.createElement("form");
    form.method = "POST";
    form.action = UNI_CP_URL;
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
    if (requestInProgress || isModalOpen()) return;
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

      var cart = await fetchCart();
      var payload = buildPayload(container, cart);

      if (!payload.currency || !payload.shop_permanent_domain) {
        throw new Error("invalid-context");
      }

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
      });
  }

  function registerGlobalsOnce() {
    if (window[GLOBALS_KEY]) return;
    window[GLOBALS_KEY] = true;

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeModal();
    });
    window.addEventListener("message", onMessage);
    document.addEventListener("shopify:section:load", initialize);
  }

  registerGlobalsOnce();
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
