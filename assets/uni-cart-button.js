(function () {
  "use strict";

  var transport = window.__UniTransport;
  if (!transport) return;

  var MODAL_ID = "uni-cart-modal";
  var IFRAME_NAME = "uni-cart-frame";
  var MAX_QUANTITY = 9999;
  var GLOBALS_KEY = "__uniCartButtonGlobalsBound";
  var COLLECTIONS_SECTION = "uni-cart-collections";
  var requestInProgress = false;

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

  /**
   * Parse Section Rendering HTML for product_id → collection_ids map.
   * Uses data-uni-cart-collections only (no theme-specific selectors).
   * Failure → {} (callers assign [] per line; never invent IDs).
   */
  function parseCollectionMapHtml(html) {
    if (typeof html !== "string" || !html) return {};
    try {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var node = doc.querySelector("[data-uni-cart-collections]");
      if (!node) return {};
      var parsed = JSON.parse(node.textContent || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      var out = Object.create(null);
      Object.keys(parsed).forEach(function (key) {
        var productId = positiveInteger(key);
        if (!productId) return;
        out[String(productId)] = transport.normalizeCollectionIds(parsed[key]);
      });
      return out;
    } catch (_ignored) {
      return {};
    }
  }

  /**
   * Current-cart collection membership via Section Rendering API.
   * Reflects Ajax cart at request time — not initial Liquid page render.
   * Transient failure → {} (safe empty; do not abort financing).
   */
  async function fetchCartCollectionMap() {
    try {
      var url =
        transport.shopifyRoot() +
        "?sections=" +
        encodeURIComponent(COLLECTIONS_SECTION);
      var response = await fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return {};
      var data = await response.json();
      var html = data && data[COLLECTIONS_SECTION];
      return parseCollectionMapHtml(html);
    } catch (_ignored) {
      return {};
    }
  }

  /**
   * Stable cart.js snapshot + collection map for the same effective cart.
   * Preserves fetchStableCart race protection, then fetches collections, then
   * verifies cart fingerprint once more. One bounded retry on mismatch.
   * No infinite polling. Collection failures stay soft ([]), never invent IDs.
   */
  async function fetchCartContextForFinancing() {
    async function oneRound() {
      var cart = await fetchStableCart();
      var collectionMap = await fetchCartCollectionMap();
      var verify = await fetchCartOnce();
      return {
        cart: verify,
        collectionMap: collectionMap,
        consistent: cartFingerprint(cart) === cartFingerprint(verify),
      };
    }

    var first = await oneRound();
    if (first.consistent) {
      return { cart: first.cart, collectionMap: first.collectionMap };
    }

    var second = await oneRound();
    // After retry: use latest cart + map; missing entries → [] below.
    return { cart: second.cart, collectionMap: second.collectionMap };
  }

  /**
   * Look up product-level collection_ids. Missing map entry → [] (no inventing).
   */
  function collectionIdsForProduct(collectionMap, productId) {
    if (!collectionMap || typeof collectionMap !== "object") return [];
    var entry = collectionMap[String(productId)];
    if (entry === undefined) return [];
    return transport.normalizeCollectionIds(entry);
  }

  function lineUnitPriceCents(item) {
    if (isNonNegativeSafeInteger(item.final_price)) return item.final_price;
    if (isNonNegativeSafeInteger(item.price)) return item.price;
    return null;
  }

  function lineTotalCents(item, quantity, unitCents) {
    if (isNonNegativeSafeInteger(item.final_line_price))
      return item.final_line_price;
    if (isNonNegativeSafeInteger(item.line_price)) return item.line_price;
    var computed = unitCents * quantity;
    return isNonNegativeSafeInteger(computed) ? computed : null;
  }

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

  function normalizeCartItem(item, collectionMap) {
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
      // Untrusted shopping context for CP KOP filters — not auth/settlement.
      collection_ids: collectionIdsForProduct(collectionMap, productId),
    };
  }

  function buildPayload(container, cart, collectionMap) {
    var items = cart && Array.isArray(cart.items) ? cart.items : [];
    if (!items.length) throw new Error("empty-cart");

    var currency = transport.validateCurrency(cart.currency);
    if (!currency) throw new Error("invalid-currency");

    var products = items.map(function (item) {
      return normalizeCartItem(item, collectionMap);
    });
    var total = cartTotalCents(cart);
    if (total === null || total <= 0) throw new Error("invalid-cart-total");

    return {
      source: "cart",
      shop_domain: container.dataset.shopDomain || window.location.hostname,
      shop_permanent_domain: container.dataset.shopPermanentDomain || "",
      unicid: container.dataset.unicid || "",
      currency: currency,
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

      var context = await fetchCartContextForFinancing();
      var payload = buildPayload(
        container,
        context.cart,
        context.collectionMap,
      );

      if (!payload.shop_permanent_domain) throw new Error("invalid-context");

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
    document.addEventListener("shopify:section:load", initialize);
  }

  registerGlobalsOnce();
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize);
  else initialize();

  if (typeof window !== "undefined" && window.__UNI_ENABLE_CART_TEST_API) {
    window.__UniCartTestApi = {
      parseCollectionMapHtml: parseCollectionMapHtml,
      collectionIdsForProduct: collectionIdsForProduct,
      normalizeCartItem: normalizeCartItem,
      normalizeCollectionIds: function (raw) {
        return transport.normalizeCollectionIds(raw);
      },
    };
  }
})();
