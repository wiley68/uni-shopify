/**
 * Lightweight static fixtures for UniCredit Product/Cart hardening.
 * Run: node scripts/check-uni-hardening.js
 */
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

function assertDeepEqual(actual, expected, message) {
  assert.strictEqual(
    JSON.stringify(actual),
    JSON.stringify(expected),
    message || undefined,
  );
}

var root = path.join(__dirname, "..");
var transportPath = path.join(root, "assets", "uni-transport.js");
var productPath = path.join(root, "assets", "uni-product-button.js");
var cartPath = path.join(root, "assets", "uni-cart-button.js");

/* -------------------------------------------------------------------------- */
/* Transport / config checks                                                  */
/* -------------------------------------------------------------------------- */

var sandbox = {
  globalThis: null,
  URL: URL,
  document: {
    body: { style: { overflow: "" } },
    addEventListener: function () {},
    readyState: "complete",
    querySelectorAll: function () {
      return [];
    },
  },
  addEventListener: function () {},
  setTimeout: function (fn) {
    if (typeof fn === "function") fn();
    return 0;
  },
  Shopify: { routes: { root: "/" }, currency: { active: "eur" } },
  __UNI_ENABLE_PRODUCT_TEST_API: true,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync(transportPath, "utf8"), sandbox, {
  filename: "uni-transport.js",
});

var T = sandbox.__UniTransport;
assert.ok(T, "transport exported");

assert.strictEqual(T.validateCurrency("eur"), "EUR");
assert.strictEqual(T.validateCurrency("EUR"), "EUR");
assert.strictEqual(T.validateCurrency(" euro "), null);
assert.strictEqual(T.validateCurrency("EU"), null);
assert.strictEqual(T.validateCurrency("EURO"), null);
assert.strictEqual(T.validateCurrency(""), null);
assert.strictEqual(T.validateCurrency(null), null);
assert.strictEqual(T.validateCurrency(123), null);

assert.strictEqual(
  T.begin("product", { modalId: "m", closeImpl: function () {} }),
  true,
);
assert.strictEqual(T.isActive(), true);
assert.strictEqual(T.getFlow(), "product");
assert.strictEqual(
  T.begin("cart", { modalId: "c", closeImpl: function () {} }),
  false,
);
assert.strictEqual(sandbox.document.body.style.overflow, "hidden");
assert.strictEqual(T.end("cart"), false);
assert.strictEqual(T.isActive(), true);
assert.strictEqual(T.end("product"), true);
assert.strictEqual(T.isActive(), false);
assert.strictEqual(sandbox.document.body.style.overflow, "");

var productJs = fs.readFileSync(productPath, "utf8");
var cartJs = fs.readFileSync(cartPath, "utf8");
var cartPayloadBuilder = cartJs.slice(
  cartJs.indexOf("function buildPayload"),
  cartJs.indexOf("function showError"),
);
var productLiquid = fs.readFileSync(
  path.join(root, "snippets", "uni-product-button.liquid"),
  "utf8",
);

assert.ok(
  productJs.indexOf("document.querySelector('[name=\"quantity\"]')") === -1,
);
assert.ok(
  productJs.indexOf("document.querySelector(\n      'form[action*") === -1,
);
assert.ok(productJs.indexOf("payload_version: 2") !== -1);
assert.ok(productJs.indexOf('source: "product"') !== -1);
assert.ok(productJs.indexOf("variant_id: variantId") !== -1);
assert.ok(productJs.indexOf("quantity: quantity") !== -1);
assert.ok(productJs.indexOf("dataset.currency") === -1);

assert.ok(cartJs.indexOf("fetchStableCart") !== -1);
assert.ok(cartJs.indexOf("payload_version: 2") !== -1);
assert.ok(cartJs.indexOf('source: "cart"') !== -1);
assert.ok(
  cartJs.indexOf("cart_identity: cartIdentity") !== -1,
  "Cart payload includes cart_identity",
);
assert.ok(
  cartJs.indexOf("var cartIdentity = cart && cart.token") !== -1,
  "Cart identity comes from the current cart.js snapshot token",
);
assert.ok(cartJs.indexOf("dataset.currency") === -1);
assert.ok(cartJs.indexOf("cart/clear") === -1);
assert.strictEqual(
  /console\.(?:log|debug)\s*\([^)]*(?:cartIdentity|cart\.token)/.test(cartJs),
  false,
  "Cart identity must not be logged",
);
assert.strictEqual(
  /alert\s*\([^)]*(?:cartIdentity|cart\.token)/.test(cartJs),
  false,
  "Cart identity must not be displayed in alert",
);

[
  "unit_price_cents",
  "total_price_cents",
  "currency",
  "collection_ids",
  "product_title",
  "product_handle",
  "variant_title",
  "selected_options",
  "product_id",
  "products",
].forEach(function (field) {
  assert.strictEqual(
    productJs.indexOf(field),
    -1,
    "Product v2 must not contain authority field: " + field,
  );
});
assert.strictEqual(productLiquid.indexOf("data-uni-option-names"), -1);
assert.strictEqual(productLiquid.indexOf("data-uni-collection-ids"), -1);
assert.strictEqual(productLiquid.indexOf("data-product-id"), -1);
assert.strictEqual(productLiquid.indexOf("data-product-title"), -1);
assert.strictEqual(productLiquid.indexOf("data-product-handle"), -1);

[
  "product_id",
  "product_title",
  "product_handle",
  "variant_id",
  "variant_title",
  "selected_options",
  "quantity",
  "unit_price_cents",
  "total_price_cents",
  "collection_ids",
  "currency",
  "products",
].forEach(function (field) {
  assert.strictEqual(
    cartPayloadBuilder.indexOf(field),
    -1,
    "Cart v2 must not contain authority field: " + field,
  );
});

assert.strictEqual(
  fs.existsSync(path.join(root, "sections", "uni-cart-collections.liquid")),
  false,
  "dead Cart collection serialization section removed",
);
assert.ok(fs.existsSync(path.join(root, "assets", "uni-transport.js")));

assert.ok(typeof T.normalizeCollectionIds === "function");
assertDeepEqual(T.normalizeCollectionIds([10, 20, 30]), [10, 20, 30]);
assertDeepEqual(T.normalizeCollectionIds([10, 20, 10]), [10, 20]);
assertDeepEqual(
  T.normalizeCollectionIds([10, "20", 0, -1, "x", 1.5, null, "30"]),
  [10, 20, 30],
);
assertDeepEqual(T.normalizeCollectionIds(null), []);
assertDeepEqual(T.normalizeCollectionIds({}), []);
assertDeepEqual(T.normalizeCollectionIds("10"), []);
assertDeepEqual(T.normalizeCollectionIds([]), []);

assert.ok(T.isConfigured(), "CP config must resolve");
assert.strictEqual(T.CP_ORIGIN, new URL(T.CP_BASE_URL).origin);
assert.strictEqual(
  T.CP_URL,
  new URL(T.CP_BASE_URL).origin + "/shopify/financing",
);
assert.ok(productJs.indexOf("uni.avalonbg.com") === -1);
assert.ok(cartJs.indexOf("uni.avalonbg.com") === -1);
assert.ok(productJs.indexOf("/shopify/financing") === -1);
assert.ok(cartJs.indexOf("/shopify/financing") === -1);
assert.ok(productJs.indexOf("/shopify/product-test") === -1);
assert.ok(cartJs.indexOf("/shopify/product-test") === -1);
assert.ok(productJs.indexOf("isConfigured") !== -1);
assert.ok(cartJs.indexOf("isConfigured") !== -1);

/* Phase 8.2 iframe containment — transport owns ready/timeout; load ≠ reveal */
var transportJs = fs.readFileSync(transportPath, "utf8");
assert.ok(transportJs.indexOf("uni:ready") !== -1, "ready message handled");
assert.ok(transportJs.indexOf("READY_TIMEOUT_MS") !== -1, "timeout constant");
assert.ok(transportJs.indexOf("10000") !== -1, "10s timeout");
assert.ok(
  transportJs.indexOf("event.origin === CP_ORIGIN") !== -1 ||
    transportJs.indexOf("event.origin !== CP_ORIGIN") !== -1,
  "ready/close origin check",
);
assert.ok(
  transportJs.indexOf("event.source === state.iframe.contentWindow") !== -1 ||
    transportJs.indexOf("event.source !== state.iframe.contentWindow") !== -1,
  "ready/close source check",
);
assert.ok(
  transportJs.indexOf("revealIframeOnReady") !== -1,
  "reveal only via trusted ready",
);
assert.ok(
  transportJs.indexOf("showSafeLoadError") !== -1,
  "safe timeout error state",
);
assert.ok(
  transportJs.indexOf("iframe.hidden = true") !== -1,
  "iframe hidden before ready",
);
assert.ok(
  transportJs.indexOf("clearReadyTimeout") !== -1,
  "timeout cleared on close/ready",
);
assert.strictEqual(T.READY_TIMEOUT_MS, 10000);
assert.ok(
  productJs.indexOf("setIframe(iframe, { wrap: wrap })") !== -1,
  "product arms containment via transport",
);
assert.ok(
  cartJs.indexOf("setIframe(iframe, { wrap: wrap })") !== -1,
  "cart arms containment via transport",
);
assert.ok(
  productJs.indexOf("status.remove()") === -1,
  "product must not reveal on iframe load",
);
assert.ok(
  cartJs.indexOf("status.remove()") === -1,
  "cart must not reveal on iframe load",
);
assert.ok(
  transportJs.indexOf("Финансирането временно не може да бъде заредено") !== -1,
  "safe timeout copy",
);

/* Phase 9.1 — trusted uni:bank-redirect → top-level SmartUCF (not iframe) */
assert.ok(
  transportJs.indexOf("uni:bank-redirect") !== -1,
  "bank-redirect message handled",
);
assert.ok(
  transportJs.indexOf("validateSmartUcfUrl") !== -1,
  "SmartUCF URL validation exists",
);
assert.ok(
  transportJs.indexOf("location.assign") !== -1,
  "top-level window.location.assign exists",
);
assert.ok(
  transportJs.indexOf("handleBankRedirect") !== -1,
  "bank redirect handler present",
);
assert.ok(
  transportJs.indexOf("onlinetest.ucfin.bg") !== -1 &&
    transportJs.indexOf("online.ucfin.bg") !== -1,
  "trusted SmartUCF hosts listed",
);
assert.ok(
  transportJs.indexOf("/sucf-online/Request/Start/") !== -1,
  "expected SmartUCF start path",
);
assert.ok(
  productJs.indexOf("uni:bank-redirect") === -1 &&
    cartJs.indexOf("uni:bank-redirect") === -1,
  "bank-redirect must stay in shared transport only",
);
assert.ok(
  productJs.indexOf("location.assign") === -1 &&
    cartJs.indexOf("location.assign") === -1,
  "Product/Cart must not navigate for SmartUCF",
);
assert.ok(
  /iframe\.(src|location)\s*=/.test(transportJs) === false &&
    transportJs.indexOf("contentWindow.location") === -1,
  "iframe must not be used for SmartUCF navigation",
);
assert.ok(typeof T.validateSmartUcfUrl === "function");
(function assertSmartUcfUrlValidation() {
  assert.ok(
    T.validateSmartUcfUrl(
      "https://onlinetest.ucfin.bg/sucf-online/Request/Start/ABC123",
    ),
    "test SmartUCF URL with session accepted",
  );
  assert.ok(
    T.validateSmartUcfUrl(
      "https://online.ucfin.bg/sucf-online/Request/Start/ABC123",
    ),
    "prod SmartUCF URL with session accepted",
  );
  assert.ok(
    T.validateSmartUcfUrl(
      "https://online.ucfin.bg/sucf-online/Request/Start/95F5DC/?x=1",
    ),
    "session + query accepted",
  );
  assert.strictEqual(
    T.validateSmartUcfUrl(
      "http://onlinetest.ucfin.bg/sucf-online/Request/Start/ABC123",
    ),
    null,
    "http rejected",
  );
  assert.strictEqual(
    T.validateSmartUcfUrl(
      "https://evil.example/sucf-online/Request/Start/ABC123",
    ),
    null,
    "foreign host rejected",
  );
  assert.strictEqual(
    T.validateSmartUcfUrl(
      "https://onlinetest.ucfin.bg.evil.example/sucf-online/Request/Start/ABC123",
    ),
    null,
    "suffix-host trick rejected",
  );
  assert.strictEqual(
    T.validateSmartUcfUrl(
      "https://onlinetest.ucfin.bg/sucf-online/Request/Start/",
    ),
    null,
    "missing session segment rejected",
  );
  assert.strictEqual(
    T.validateSmartUcfUrl(
      "https://onlinetest.ucfin.bg/sucf-online/Request/Start/A/B",
    ),
    null,
    "deeper path rejected",
  );
  assert.strictEqual(
    T.validateSmartUcfUrl("https://online.ucfin.bg/other/path"),
    null,
    "wrong path rejected",
  );
  assert.strictEqual(
    T.validateSmartUcfUrl("javascript:alert(1)"),
    null,
    "javascript: rejected",
  );
  assert.strictEqual(T.validateSmartUcfUrl(""), null, "empty rejected");
  assert.strictEqual(T.validateSmartUcfUrl(null), null, "null rejected");
})();

assert.ok(
  transportJs.indexOf("SMARTUCF_START_PREFIX") !== -1 ||
    transportJs.indexOf("/sucf-online/Request/Start/") !== -1,
  "SmartUCF start prefix still present",
);
assert.ok(
  transportJs.indexOf("bank redirect ignored: invalid destination") !== -1,
  "invalid destination diagnostic present",
);
assert.ok(
  transportJs.indexOf("bank redirect accepted") !== -1,
  "accepted diagnostic present",
);
(function assertBankRedirectKeepsModalVisible() {
  var start = transportJs.indexOf("function handleBankRedirect");
  assert.ok(start !== -1, "handleBankRedirect present");
  var end = transportJs.indexOf("\n  function onMessage", start);
  assert.ok(end !== -1, "handleBankRedirect bounded");
  var body = transportJs.slice(start, end);
  assert.ok(
    body.indexOf("location.assign") !== -1 ||
      body.indexOf("navigateToBank") !== -1,
    "bank redirect reaches top-level navigation",
  );
  assert.ok(
    body.indexOf("clearReadyTimeout()") !== -1,
    "bank redirect suppresses ready timeout",
  );
  assert.ok(
    body.indexOf("readyReceived = true") !== -1,
    "bank redirect marks redirect accepted",
  );
  assert.ok(
    transportJs.indexOf("Keep Step 3 / modal visible") !== -1,
    "bank redirect documents keep-modal-visible behavior",
  );
  // Happy path must not visually close before navigate; closeActive only in catch/fallback.
  var navFnStart = transportJs.indexOf("function navigateToBank");
  assert.ok(navFnStart !== -1, "navigateToBank helper present");
  var navFnEnd = transportJs.indexOf(
    "\n  function handleBankRedirect",
    navFnStart,
  );
  if (navFnEnd === -1) {
    navFnEnd = transportJs.indexOf("\n  function onMessage", navFnStart);
  }
  var navBody = transportJs.slice(navFnStart, navFnEnd);
  var assignAt = navBody.indexOf("location.assign");
  var closeBeforeAssign = navBody.lastIndexOf("closeActive()", assignAt);
  var catchAt = navBody.indexOf("catch");
  assert.ok(
    closeBeforeAssign === -1 || (catchAt !== -1 && closeBeforeAssign > catchAt),
    "bank redirect must not call visual closeActive before location.assign",
  );
  assert.ok(
    body.indexOf("closeActive()") === -1,
    "handleBankRedirect itself must not call closeActive on happy path",
  );
})();

/* Phase 11.1 — Cart P1 success: clear Shopify cart before SmartUCF (Product untouched) */
assert.ok(
  transportJs.indexOf("cart/clear.js") !== -1,
  "Shopify cart clear endpoint used",
);
assert.ok(
  transportJs.indexOf('shopifyRoot() + "cart/clear.js"') !== -1 ||
    transportJs.indexOf("shopifyRoot() + 'cart/clear.js'") !== -1,
  "locale-aware Shopify.routes.root used for cart clear",
);
assert.ok(
  transportJs.indexOf("clearShopifyCartBounded") !== -1,
  "bounded cart clear helper present",
);
assert.ok(
  transportJs.indexOf("CART_CLEAR_TIMEOUT_MS") !== -1,
  "cart clear timeout constant present",
);
assert.ok(
  transportJs.indexOf("AbortController") !== -1,
  "AbortController used to bound cart clear",
);
assert.ok(
  transportJs.indexOf("cart_clear_started") !== -1 &&
    transportJs.indexOf("cart_clear_success") !== -1 &&
    transportJs.indexOf("cart_clear_failed") !== -1 &&
    transportJs.indexOf("cart_clear_timeout") !== -1,
  "safe cart-clear diagnostics present",
);
assert.ok(
  transportJs.indexOf("bankRedirectHandled") !== -1,
  "redirect-once guard present",
);
(function assertCartClearOnlyForCartSource() {
  var start = transportJs.indexOf("function handleBankRedirect");
  assert.ok(start !== -1);
  var end = transportJs.indexOf("\n  function onMessage", start);
  var body = transportJs.slice(start, end);
  assert.ok(
    body.indexOf('flow !== "cart"') !== -1 ||
      body.indexOf("flow !== 'cart'") !== -1,
    "Product/non-cart skips cart clear",
  );
  assert.ok(
    body.indexOf("clearShopifyCartBounded") !== -1,
    "Cart path attempts clearShopifyCartBounded",
  );
  var clearAt = body.indexOf("clearShopifyCartBounded");
  var validateAt = body.indexOf("validateSmartUcfUrl");
  assert.ok(
    validateAt !== -1 && clearAt !== -1 && validateAt < clearAt,
    "cart clear happens only after trusted destination validation",
  );
  var productImmediate =
    body.indexOf("finishNavigate") !== -1 ||
    body.indexOf("navigateToBank") !== -1;
  assert.ok(productImmediate, "navigation helper used after clear path");
  // Failure/timeout still navigate: catch then finishNavigate
  assert.ok(
    body.indexOf("cart_clear_failed") !== -1 &&
      body.indexOf("cart_clear_timeout") !== -1,
    "clear failure/timeout paths diagnosed",
  );
  var catchClear = body.indexOf(".catch");
  var finishAfterCatch = body.lastIndexOf("finishNavigate");
  assert.ok(
    catchClear !== -1 && finishAfterCatch > catchClear,
    "navigation still reached after clear failure catch",
  );
})();
assert.ok(
  productJs.indexOf("cart/clear") === -1 && cartJs.indexOf("cart/clear") === -1,
  "Product/Cart assets must not clear cart themselves",
);

/* Portability: primary quantity uses JET-compatible generic discovery FIRST */
assert.ok(
  productJs.indexOf(
    'input[name="quantity"], input[type="number"][name*="quantity"]',
  ) !== -1,
  "generic Shopify quantity selector required",
);
assert.ok(
  productJs.indexOf("collectGenericQuantityCandidates") !== -1,
  "generic candidate collection required",
);
assert.ok(
  productJs.indexOf("JET-compatible generic discovery FIRST") !== -1,
  "generic-first priority required",
);
(function assertGenericBeforeFormDisambiguation() {
  var fn = productJs.indexOf("function resolveQuantityControl");
  assert.ok(fn !== -1, "resolveQuantityControl present");
  var next = productJs.indexOf("function resolveQuantity(", fn);
  assert.ok(next !== -1, "resolveQuantity present");
  var body = productJs.slice(fn, next);
  var collectAt = body.indexOf("collectGenericQuantityCandidates()");
  var formAt = body.indexOf("findProductForm(container)");
  assert.ok(
    collectAt !== -1 && formAt !== -1,
    "collect + form used in quantity resolution",
  );
  assert.ok(
    collectAt < formAt,
    "generic candidates must be collected before findProductForm disambiguation",
  );
  assert.ok(
    productJs
      .slice(next, productJs.indexOf("function resolveVariantId", next))
      .indexOf("resolveQuantityControl(container)") !== -1,
    "resolveQuantity reuses the same single quantity policy",
  );
})();

/* -------------------------------------------------------------------------- */
/* Minimal DOM for Product quantity fixtures                                  */
/* -------------------------------------------------------------------------- */

function matchesSimple(el, selector) {
  if (!el || !el.attrs) return false;
  if (selector === "form") return el.tagName === "FORM";
  if (selector === ".shopify-section") {
    return (
      (el.attrs.class || "").split(/\s+/).indexOf("shopify-section") !== -1
    );
  }
  if (selector.indexOf("[id^='") === 0) {
    var prefix = selector.slice("[id^='".length, -2);
    return typeof el.attrs.id === "string" && el.attrs.id.indexOf(prefix) === 0;
  }
  if (selector === "[data-section-id]")
    return el.attrs["data-section-id"] != null;
  if (selector === '[name="id"]') return el.attrs.name === "id";
  if (selector === 'input[name="quantity"]') {
    return el.tagName === "INPUT" && el.attrs.name === "quantity";
  }
  if (selector === 'input[type="number"][name*="quantity"]') {
    return (
      el.tagName === "INPUT" &&
      el.attrs.type === "number" &&
      typeof el.attrs.name === "string" &&
      el.attrs.name.indexOf("quantity") !== -1
    );
  }
  if (selector === 'input[name="quantity"][form]') {
    return (
      el.tagName === "INPUT" &&
      el.attrs.name === "quantity" &&
      el.attrs.form != null
    );
  }
  if (selector === 'input[type="number"][name*="quantity"][form]') {
    return (
      el.tagName === "INPUT" &&
      el.attrs.type === "number" &&
      typeof el.attrs.name === "string" &&
      el.attrs.name.indexOf("quantity") !== -1 &&
      el.attrs.form != null
    );
  }
  if (selector === '[name="quantity"]') return el.attrs.name === "quantity";
  if (selector === '[name="quantity"][form]') {
    return el.attrs.name === "quantity" && el.attrs.form != null;
  }
  if (selector === 'form[action*="/cart"]') {
    return (
      el.tagName === "FORM" &&
      typeof el.attrs.action === "string" &&
      el.attrs.action.indexOf("/cart") !== -1
    );
  }
  if (
    selector.indexOf('form[action*="/cart/add"]') === 0 ||
    selector.indexOf("form[action*") === 0
  ) {
    return (
      el.tagName === "FORM" &&
      typeof el.attrs.action === "string" &&
      el.attrs.action.indexOf("/cart/add") !== -1
    );
  }
  if (selector === 'form[action*="cart/add"]') {
    return (
      el.tagName === "FORM" &&
      typeof el.attrs.action === "string" &&
      el.attrs.action.indexOf("cart/add") !== -1
    );
  }
  if (selector === 'form[data-type="add-to-cart-form"]') {
    return (
      el.tagName === "FORM" && el.attrs["data-type"] === "add-to-cart-form"
    );
  }
  if (selector === "form.product-form") {
    return (
      el.tagName === "FORM" &&
      (el.attrs.class || "").split(/\s+/).indexOf("product-form") !== -1
    );
  }
  if (selector === "[data-uni-product-button]") {
    return el.attrs["data-uni-product-button"] != null;
  }
  return false;
}

function matchesCompound(el, selector) {
  return selector.split(",").some(function (part) {
    return matchesSimple(el, part.trim());
  });
}

function createEl(tagName, attrs) {
  attrs = attrs || {};
  var listeners = {};
  var el = {
    tagName: String(tagName).toUpperCase(),
    attrs: attrs,
    children: [],
    parentNode: null,
    disabled: !!attrs.disabled,
    hidden: !!attrs.hidden,
    __listeners: listeners,
    get id() {
      return this.attrs.id;
    },
    set id(v) {
      this.attrs.id = v;
    },
    get type() {
      return this.attrs.type != null ? String(this.attrs.type) : "text";
    },
    get value() {
      return this.attrs.value != null ? String(this.attrs.value) : "";
    },
    set value(v) {
      this.attrs.value = v;
    },
    get form() {
      if (
        this.attrs.form &&
        sandbox.document &&
        sandbox.document.getElementById
      ) {
        return sandbox.document.getElementById(this.attrs.form);
      }
      return this.closest("form");
    },
    get classList() {
      var self = this;
      return {
        contains: function (name) {
          return (self.attrs.class || "").split(/\s+/).indexOf(name) !== -1;
        },
      };
    },
    get dataset() {
      var out = {};
      Object.keys(el.attrs).forEach(function (key) {
        if (key.indexOf("data-") !== 0) return;
        var parts = key.slice(5).split("-");
        var name = parts[0];
        for (var i = 1; i < parts.length; i++) {
          name += parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
        }
        out[name] = String(el.attrs[key]);
      });
      return out;
    },
    addEventListener: function (type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener: function (type, fn) {
      var list = listeners[type] || [];
      var index = list.indexOf(fn);
      if (index !== -1) list.splice(index, 1);
    },
    getAttribute: function (name) {
      var key = String(name);
      if (key === "disabled" && this.disabled) return "";
      if (this.attrs[key] == null) return null;
      return String(this.attrs[key]);
    },
    appendChild: function (child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    contains: function (other) {
      if (other === this) return true;
      for (var i = 0; i < this.children.length; i++) {
        if (this.children[i].contains(other)) return true;
      }
      return false;
    },
    closest: function (selector) {
      var node = this;
      while (node) {
        if (matchesCompound(node, selector)) return node;
        node = node.parentNode;
      }
      return null;
    },
    querySelector: function (selector) {
      var all = this.querySelectorAll(selector);
      return all[0] || null;
    },
    querySelectorAll: function (selector) {
      var parts = selector.split(",").map(function (p) {
        return p.trim();
      });
      var out = [];
      function walk(node) {
        for (var i = 0; i < node.children.length; i++) {
          var child = node.children[i];
          for (var p = 0; p < parts.length; p++) {
            if (matchesSimple(child, parts[p])) {
              out.push(child);
              break;
            }
          }
          walk(child);
        }
      }
      walk(this);
      return out;
    },
  };
  return el;
}

function installDom(rootEl) {
  function HTMLFormElement() {}
  sandbox.HTMLFormElement = HTMLFormElement;
  sandbox.HTMLButtonElement = function HTMLButtonElement() {};

  function markForms(node) {
    if (node.tagName === "FORM") {
      Object.setPrototypeOf(node, HTMLFormElement.prototype);
    }
    node.children.forEach(markForms);
  }
  markForms(rootEl);

  sandbox.document = {
    body: { style: { overflow: "" }, appendChild: function () {} },
    documentElement: rootEl,
    readyState: "complete",
    addEventListener: function () {},
    querySelectorAll: function (selector) {
      return rootEl.querySelectorAll(selector);
    },
    querySelector: function (selector) {
      return rootEl.querySelector(selector);
    },
    createElement: function () {
      return createEl("div", {});
    },
    getElementById: function (id) {
      function walk(node) {
        if (node.attrs && node.attrs.id === id) return node;
        for (var i = 0; i < node.children.length; i++) {
          var found = walk(node.children[i]);
          if (found) return found;
        }
        return null;
      }
      return walk(rootEl);
    },
  };
}

function loadProductApi(transportImpl) {
  delete sandbox.__UniProductTestApi;
  sandbox.__UNI_ENABLE_PRODUCT_TEST_API = true;
  sandbox.__UniTransport = transportImpl || T;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(productPath, "utf8"), sandbox, {
    filename: "uni-product-button.js",
  });
  assert.ok(sandbox.__UniProductTestApi, "product test API exported");
  return sandbox.__UniProductTestApi;
}

function caseA_oneGenericCandidate() {
  var wrap = createEl("div", {});
  var qty = createEl("input", { name: "quantity", value: "2", type: "number" });
  var uni = createEl("div", { "data-uni-product-button": "" });
  wrap.appendChild(qty);
  wrap.appendChild(uni);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    2,
    "Case A: one generic candidate → 2",
  );
}

function caseB_quantityOutsideFormOnlyGeneric() {
  var wrap = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var qty = createEl("input", { name: "quantity", value: "2", type: "number" });
  var uni = createEl("div", { "data-uni-product-button": "" });
  wrap.appendChild(form);
  wrap.appendChild(qty);
  wrap.appendChild(uni);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    2,
    "Case B: quantity outside form, only generic → 2",
  );
}

function caseC_staleFormOneDoesNotBeatCurrentTwo() {
  // Form has stale/hidden default 1; page has current visible quantity 2.
  var wrap = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var stale = createEl("input", {
    name: "quantity",
    value: "1",
    type: "hidden",
  });
  var current = createEl("input", {
    name: "quantity",
    value: "2",
    type: "number",
  });
  var uni = createEl("div", { "data-uni-product-button": "" });
  form.appendChild(stale);
  form.appendChild(uni);
  wrap.appendChild(form);
  wrap.appendChild(current);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    2,
    "Case C: stale form 1 must not beat current generic 2",
  );
}

function caseD_multipleOneAssociated() {
  var page = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var uni = createEl("div", { "data-uni-product-button": "" });
  var mainQty = createEl("input", {
    name: "quantity",
    value: "2",
    type: "number",
    form: "product-form",
  });
  form.appendChild(uni);

  var qForm = createEl("form", {
    id: "quick-form",
    action: "/cart/add",
    class: "product-form",
  });
  var qQty = createEl("input", {
    name: "quantity",
    value: "9",
    type: "number",
  });
  qForm.appendChild(qQty);

  page.appendChild(form);
  page.appendChild(mainQty);
  page.appendChild(qForm);
  installDom(page);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    2,
    "Case D: multiple candidates, one associated → 2",
  );
}

function caseE_visibleBeatsHiddenDuplicate() {
  var wrap = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var hiddenDup = createEl("input", {
    name: "quantity",
    value: "1",
    type: "number",
    style: "display:none",
    form: "product-form",
  });
  var visible = createEl("input", {
    name: "quantity",
    value: "2",
    type: "number",
    form: "product-form",
  });
  var uni = createEl("div", { "data-uni-product-button": "" });
  form.appendChild(uni);
  wrap.appendChild(form);
  wrap.appendChild(hiddenDup);
  wrap.appendChild(visible);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    2,
    "Case E: visible current control beats hidden duplicate",
  );
}

function caseF_genuineAmbiguityNoArbitrary() {
  var page = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var uni = createEl("div", { "data-uni-product-button": "" });
  var formA = createEl("form", {
    id: "a",
    action: "/cart/add",
    class: "product-form",
  });
  var formB = createEl("form", {
    id: "b",
    action: "/cart/add",
    class: "product-form",
  });
  formA.appendChild(
    createEl("input", { name: "quantity", value: "2", type: "number" }),
  );
  formB.appendChild(
    createEl("input", { name: "quantity", value: "5", type: "number" }),
  );
  page.appendChild(form);
  page.appendChild(uni);
  page.appendChild(formA);
  page.appendChild(formB);
  installDom(page);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    1,
    "Case F: genuine ambiguity → no arbitrary first match",
  );
}

function caseG_noQuantityDefaultsToOne() {
  var wrap = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var uni = createEl("div", { "data-uni-product-button": "" });
  wrap.appendChild(form);
  wrap.appendChild(uni);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(api.resolveQuantity(uni), 1, "Case G: no quantity → 1");
}

function caseH_invalidExplicitFailsSafely() {
  var wrap = createEl("div", {});
  var qty = createEl("input", { name: "quantity", value: "0", type: "number" });
  var uni = createEl("div", { "data-uni-product-button": "" });
  wrap.appendChild(qty);
  wrap.appendChild(uni);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    null,
    "Case H: invalid explicit quantity → fail safely",
  );
}

caseA_oneGenericCandidate();
caseB_quantityOutsideFormOnlyGeneric();
caseC_staleFormOneDoesNotBeatCurrentTwo();
caseD_multipleOneAssociated();
caseE_visibleBeatsHiddenDuplicate();
caseF_genuineAmbiguityNoArbitrary();
caseG_noQuantityDefaultsToOne();
caseH_invalidExplicitFailsSafely();

function caseProductPayloadV2IsMinimal() {
  var api = loadProductApi();
  var payload = api.buildPayload(
    {
      dataset: {
        unicid: "merchant-1",
        shopDomain: "shop.example",
        shopPermanentDomain: "shop.myshopify.com",
      },
    },
    123456,
    3,
  );
  assertDeepEqual(Object.keys(payload).sort(), [
    "payload_version",
    "quantity",
    "shop_domain",
    "shop_permanent_domain",
    "source",
    "unicid",
    "variant_id",
  ]);
  assert.strictEqual(payload.payload_version, 2);
  assert.strictEqual(payload.source, "product");
  assert.strictEqual(payload.variant_id, 123456);
  assert.strictEqual(payload.quantity, 3);
}

caseProductPayloadV2IsMinimal();

/* -------------------------------------------------------------------------- */
/* Collection IDs — Cart legacy fixtures                                     */
/* -------------------------------------------------------------------------- */

function loadCartApi(transportImpl) {
  delete sandbox.__UniCartTestApi;
  sandbox.__UNI_ENABLE_CART_TEST_API = true;
  sandbox.__UniTransport = transportImpl || T;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.DOMParser = function DOMParser() {
    this.parseFromString = function (html) {
      var match = String(html).match(
        /data-uni-cart-collections[^>]*>\s*([\s\S]*?)\s*<\/script>/i,
      );
      var text = match ? match[1] : "";
      var node = {
        textContent: text,
      };
      return {
        querySelector: function (selector) {
          if (selector === "[data-uni-cart-collections]") {
            return match ? node : null;
          }
          return null;
        },
      };
    };
  };
  vm.runInNewContext(fs.readFileSync(cartPath, "utf8"), sandbox, {
    filename: "uni-cart-button.js",
  });
  assert.ok(sandbox.__UniCartTestApi, "cart test API exported");
  return sandbox.__UniCartTestApi;
}

function caseCartOneProductCollections() {
  var api = loadCartApi();
  var html =
    '<div id="shopify-section-uni-cart-collections">' +
    '<script type="application/json" data-uni-cart-collections>' +
    '{"100":[10,20]}' +
    "</script></div>";
  var map = api.parseCollectionMapHtml(html);
  assertDeepEqual(map["100"], [10, 20]);
  var line = api.normalizeCartItem(
    {
      product_id: 100,
      product_title: "A",
      handle: "a",
      variant_id: 1001,
      variant_title: "Default",
      quantity: 1,
      final_price: 10000,
      final_line_price: 10000,
      options_with_values: [],
    },
    map,
  );
  assert.strictEqual(line.product_id, 100);
  assertDeepEqual(line.collection_ids, [10, 20]);
}

function caseCartTwoProductsOwnCollections() {
  var api = loadCartApi();
  var map = api.parseCollectionMapHtml(
    '<script type="application/json" data-uni-cart-collections>' +
      '{"100":[10,20],"200":[30]}</script>',
  );
  var line100 = api.normalizeCartItem(
    {
      product_id: 100,
      product_title: "A",
      handle: "a",
      variant_id: 1,
      variant_title: "",
      quantity: 1,
      final_price: 1000,
      final_line_price: 1000,
    },
    map,
  );
  var line200 = api.normalizeCartItem(
    {
      product_id: 200,
      product_title: "B",
      handle: "b",
      variant_id: 2,
      variant_title: "",
      quantity: 1,
      final_price: 2000,
      final_line_price: 2000,
    },
    map,
  );
  assertDeepEqual(line100.collection_ids, [10, 20]);
  assertDeepEqual(line200.collection_ids, [30]);
}

function caseCartSameProductMultipleVariants() {
  var api = loadCartApi();
  var map = { 100: [10, 20] };
  var lineA = api.normalizeCartItem(
    {
      product_id: 100,
      product_title: "A",
      handle: "a",
      variant_id: 11,
      variant_title: "S",
      quantity: 1,
      final_price: 1000,
      final_line_price: 1000,
    },
    map,
  );
  var lineB = api.normalizeCartItem(
    {
      product_id: 100,
      product_title: "A",
      handle: "a",
      variant_id: 22,
      variant_title: "L",
      quantity: 2,
      final_price: 1000,
      final_line_price: 2000,
    },
    map,
  );
  assertDeepEqual(lineA.collection_ids, [10, 20]);
  assertDeepEqual(lineB.collection_ids, [10, 20]);
}

function caseCartMissingMapEntry() {
  var api = loadCartApi();
  var map = { 100: [10, 20] };
  var line = api.normalizeCartItem(
    {
      product_id: 999,
      product_title: "X",
      handle: "x",
      variant_id: 9,
      variant_title: "",
      quantity: 1,
      final_price: 500,
      final_line_price: 500,
    },
    map,
  );
  assertDeepEqual(
    line.collection_ids,
    [],
    "Missing map entry → [] (no unrelated IDs)",
  );
  assertDeepEqual(api.collectionIdsForProduct({}, 100), [], "Empty map → []");
  assertDeepEqual(
    api.parseCollectionMapHtml("<div>no json</div>"),
    {},
    "Bad HTML → empty map",
  );
}

function caseCartClickUsesSectionRenderingNotInitialLiquid() {
  assert.ok(
    cartJs.indexOf("?sections=") !== -1,
    "Cart collections use Section Rendering API",
  );
  assert.ok(
    cartJs.indexOf("fetchCartCollectionMap") !== -1,
    "Collections fetched at financing time",
  );
  assert.ok(
    cartJs.indexOf("fetchCartContextForFinancing") !== -1,
    "Cart+collections consistency wrapper present",
  );
  var section = fs.readFileSync(
    path.join(root, "sections", "uni-cart-collections.liquid"),
    "utf8",
  );
  assert.ok(section.indexOf("data-uni-cart-collections") !== -1);
  assert.ok(section.indexOf("cart.items") !== -1);
  assert.ok(section.indexOf("item.product.collections") !== -1);
}

function cartPayloadFixture(token) {
  var api = loadCartApi();
  return api.buildPayload(
    {
      dataset: {
        unicid: "merchant-1",
        shopDomain: "shop.example",
        shopPermanentDomain: "shop.myshopify.com",
      },
    },
    {
      token: token,
      items: [{}],
    },
  );
}

function caseCartPayloadIncludesExactIdentity() {
  var token = "hWNH2Wed-XFI3?key=complete-secret-value";
  var payload = cartPayloadFixture(token);
  assertDeepEqual(Object.keys(payload).sort(), [
    "cart_identity",
    "payload_version",
    "shop_domain",
    "shop_permanent_domain",
    "source",
    "unicid",
  ]);
  assert.strictEqual(payload.payload_version, 2);
  assert.strictEqual(payload.cart_identity, token, "Full cart token is preserved");
  assert.strictEqual(payload.source, "cart");
  assert.strictEqual(payload.unicid, "merchant-1");
  assert.strictEqual(payload.shop_domain, "shop.example");
  assert.strictEqual(payload.shop_permanent_domain, "shop.myshopify.com");
}

function caseCartPayloadRejectsMissingIdentity() {
  [undefined, null, "", "   ", 123].forEach(function (token) {
    assert.throws(
      function () {
        cartPayloadFixture(token);
      },
      /invalid-cart-identity/,
      "Missing or invalid cart token blocks payload construction",
    );
  });
}

caseCartPayloadIncludesExactIdentity();
caseCartPayloadRejectsMissingIdentity();

/* -------------------------------------------------------------------------- */
/* uni_min_price — minimal local financing threshold (Product + Cart)         */
/* -------------------------------------------------------------------------- */

var procedureText = fs.readFileSync(
  path.join(root, "shopify-theme-procedure.txt"),
  "utf8",
);
var cartLiquid = fs.readFileSync(
  path.join(root, "snippets", "uni-cart-button.liquid"),
  "utf8",
);
var productCss = fs.readFileSync(
  path.join(root, "assets", "uni-product-button.css"),
  "utf8",
);
var cartCss = fs.readFileSync(
  path.join(root, "assets", "uni-cart-button.css"),
  "utf8",
);

/* C — canonical UniCredit settings block (manual Shopify deployment) */
assert.ok(
  procedureText.indexOf("uni_min_price") !== -1,
  "uni_min_price documented",
);
var minSettingAt = procedureText.indexOf('"id": "uni_min_price"');
assert.ok(minSettingAt !== -1, "uni_min_price schema entry present");
var minSettingBlock = procedureText.slice(
  Math.max(0, minSettingAt - 200),
  minSettingAt + 300,
);
assert.ok(
  minSettingBlock.indexOf('"type": "number"') !== -1,
  "uni_min_price uses the number setting type",
);
assert.ok(
  minSettingBlock.indexOf('"default": 50') !== -1,
  "uni_min_price default is 50",
);
assert.ok(
  procedureText.indexOf(
    "\u041c\u0438\u043d\u0438\u043c\u0430\u043b\u043d\u0430 \u0441\u0443\u043c\u0430 \u0437\u0430 \u043a\u0440\u0435\u0434\u0438\u0442",
  ) !== -1,
  "Bulgarian label present",
);
assert.ok(
  procedureText.indexOf(
    "\u041c\u0438\u043d\u0438\u043c\u0430\u043b\u043d\u043e \u0432\u044a\u0437\u043c\u043e\u0436\u043d\u0430 \u0441\u0443\u043c\u0430 \u043d\u0430 \u0441\u0442\u043e\u043a\u0438\u0442\u0435 \u0437\u0430 \u0437\u0430\u043a\u0443\u043f\u0443\u0432\u0430\u043d\u0435 \u043d\u0430 \u043a\u0440\u0435\u0434\u0438\u0442 \u0441 \u0423\u043d\u0438\u041a\u0440\u0435\u0434\u0438\u0442",
  ) !== -1,
  "Bulgarian info present",
);
assert.ok(
  procedureText.indexOf("cannot enforce positive integers") !== -1,
  "documented: Shopify number settings cannot enforce positive integers",
);
assert.ok(
  procedureText.indexOf(
    "config/settings_schema.json is intentionally NOT committed",
  ) !== -1,
  "documented: manual settings_schema.json deployment",
);
assert.strictEqual(
  fs.existsSync(path.join(root, "config", "settings_schema.json")),
  false,
  "settings_schema.json must stay uncommitted",
);

/* Money units: Liquid renders minor units, JS compares integers only */
assert.ok(productLiquid.indexOf("times: 100") !== -1, "product major to minor");
assert.ok(cartLiquid.indexOf("times: 100") !== -1, "cart major to minor");
assert.ok(
  productLiquid.indexOf("data-uni-min-price") !== -1 &&
    cartLiquid.indexOf("data-uni-min-price") !== -1,
  "both slots carry the configured minimum",
);
assert.ok(
  productLiquid.indexOf("data-uni-variant-prices") !== -1,
  "product slot carries locally rendered variant prices",
);
assert.ok(
  productLiquid.indexOf("hidden") !== -1 && cartLiquid.indexOf("hidden") !== -1,
  "server-rendered initial hidden gate",
);
assert.ok(
  productLiquid.indexOf(
    "{% if uni_initial_amount < uni_min_minor %}hidden{% endif %}",
  ) !== -1,
  "product initial gate hidden only below the minimum (equality allowed)",
);
assert.ok(
  cartLiquid.indexOf(
    "{% if uni_cart_total < uni_min_minor %}hidden{% endif %}",
  ) !== -1,
  "cart initial gate hidden only below the minimum (equality allowed)",
);
assert.ok(
  cartLiquid.indexOf("cart.total_price") !== -1,
  "cart Liquid uses the cart amount",
);
assert.ok(
  productCss.indexOf(".uni-product-slot[hidden]") !== -1 &&
    cartCss.indexOf(".uni-cart-slot[hidden]") !== -1,
  "hidden slot CSS wins over display:block",
);

/* Scope audit: no polling, no new endpoints, no document-level listeners */
assert.strictEqual(
  /setInterval\s*\(/.test(productJs),
  false,
  "no polling (product)",
);
assert.strictEqual(/setInterval\s*\(/.test(cartJs), false, "no polling (cart)");
assert.strictEqual(
  /document\.addEventListener\(\s*["']change/.test(productJs),
  false,
  "no document-level change listener (product)",
);
assert.strictEqual(
  /document\.addEventListener\(\s*["']change/.test(cartJs),
  false,
  "no document-level change listener (cart)",
);
assert.strictEqual(
  productJs.indexOf("variants/"),
  -1,
  "no variant Ajax endpoint (product)",
);
assert.strictEqual(
  cartJs.indexOf("variants/"),
  -1,
  "no variant Ajax endpoint (cart)",
);
assert.strictEqual(
  /parseFloat/.test(productJs),
  false,
  "integer-only money comparison (product)",
);
assert.strictEqual(
  /parseFloat/.test(cartJs),
  false,
  "integer-only money comparison (cart)",
);
assert.ok(
  productJs.indexOf("DEFAULT_MIN_PRICE_MINOR") !== -1 &&
    cartJs.indexOf("DEFAULT_MIN_PRICE_MINOR") !== -1,
  "documented fallback constant in both assets",
);

/* Cart dynamic observation must stay scoped, coalesced and loop-free */
assert.strictEqual(
  (cartJs.match(/new MutationObserver/g) || []).length,
  1,
  "exactly one Cart MutationObserver is constructed",
);
assert.ok(
  /observe\(\s*[^,]+,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\s*\)/.test(
    cartJs,
  ),
  "Cart observer watches childList + subtree only",
);
assert.strictEqual(
  /observe\(\s*(?:document|document\.body|document\.documentElement)/.test(
    cartJs,
  ),
  false,
  "Cart observer never targets document/body/documentElement",
);
assert.ok(
  cartJs.indexOf("isObservableScope") !== -1,
  "document/body observation guard present",
);
assert.ok(
  cartJs.indexOf("cartWatch.scheduled") !== -1,
  "Cart update bursts are coalesced",
);
assert.ok(
  cartJs.indexOf("unbindCartScopeEvents") !== -1 &&
    cartJs.indexOf("removeEventListener") !== -1,
  "scoped Cart listeners are unbound before rebinding",
);
assert.ok(
  cartJs.indexOf("CART_FORM_SELECTOR") !== -1,
  "Cart scope comes from the storefront Cart form convention",
);

(function assertProductChangeListenerScoped() {
  var fn = productJs.indexOf("function bindProductChange");
  assert.ok(fn !== -1, "bindProductChange present");
  var next = productJs.indexOf("\n  function ", fn + 10);
  var body = productJs.slice(fn, next === -1 ? productJs.length : next);
  assert.ok(
    body.indexOf("findProductForm(container)") !== -1,
    "product form scope preferred",
  );
  assert.ok(
    body.indexOf("findProductSection(container)") !== -1,
    "theme section fallback scope",
  );
  assert.ok(
    body.indexOf('addEventListener("change"') !== -1,
    "change listener bound on the resolved target",
  );
  assert.ok(
    body.indexOf('addEventListener("input"') !== -1,
    "input listener bound for quantity widgets",
  );
  assert.ok(
    body.indexOf("resolveQuantityControl(container)") !== -1,
    "resolved quantity control is part of the bound targets",
  );
  assert.ok(body.indexOf("document") === -1, "no document-level binding");
  assert.ok(
    body.indexOf("querySelectorAll") === -1,
    "no per-control listener sweep",
  );
  assert.ok(
    body.indexOf("setInterval") === -1,
    "no polling in the product change binding",
  );
})();

(function assertInitializeAppliesGate() {
  var fn = productJs.indexOf("function initialize");
  var body = productJs.slice(
    fn,
    productJs.indexOf("function registerGlobalsOnce", fn),
  );
  assert.ok(
    body.indexOf("syncSlotVisibility(container)") !== -1,
    "initialize applies the local gate",
  );
  assert.ok(
    body.indexOf("bindProductChange(container)") !== -1,
    "initialize binds variant/quantity changes",
  );
})();

(function assertLocalGatePrecedesCpPost() {
  var pStart = productJs.indexOf("async function handleClick");
  var pBody = productJs.slice(
    pStart,
    productJs.indexOf("function initialize", pStart),
  );
  var pGate = pBody.indexOf("isAmountAboveMinimum");
  var pPost = pBody.indexOf("postToIframe");
  assert.ok(
    pGate !== -1 && pPost !== -1 && pGate < pPost,
    "product amount gate precedes CP POST",
  );

  assert.ok(
    /isAmountAboveMinimum\(container,\s*variantId,\s*quantity\)/.test(pBody),
    "product click-time gate uses variant x quantity",
  );

  var cStart = cartJs.indexOf("async function handleClick");
  var cBody = cartJs.slice(
    cStart,
    cartJs.indexOf("function initialize", cStart),
  );
  var cGate = cBody.indexOf("isCartAboveMinimum");
  var cPost = cBody.indexOf("postToIframe");
  assert.ok(
    cGate !== -1 && cPost !== -1 && cGate < cPost,
    "cart local gate precedes CP POST",
  );
})();

var productPayloadBuilder = productJs.slice(
  productJs.indexOf("function buildPayload"),
  productJs.indexOf("function showError"),
);
assert.ok(
  productPayloadBuilder.indexOf("MinPrice") === -1 &&
    cartPayloadBuilder.indexOf("MinPrice") === -1,
  "minimum gate is never part of the CP payload",
);

/* -------------------------------------------------------------------------- */
/* Fixtures: Liquid-rendered attributes only (no live Shopify)                */
/* -------------------------------------------------------------------------- */

function dispatchBubblingEvent(target, type) {
  var node = target;
  while (node) {
    var list = (node.__listeners && node.__listeners[type]) || [];
    for (var i = 0; i < list.length; i++) {
      list[i].call(node, { type: type, target: target });
    }
    node = node.parentNode;
  }
}

function createProductFixture(options) {
  options = options || {};
  var wrap = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var slotAttrs = {
    id: "uni-product-slot",
    "data-uni-product-button": "",
    "data-unicid": "merchant-1",
    "data-shop-domain": "shop.example",
    "data-shop-permanent-domain": "shop.myshopify.com",
    "data-initial-variant-id": options.variantId || "11",
  };
  if (options.minMinor != null) {
    slotAttrs["data-uni-min-price"] = String(options.minMinor);
  }
  if (options.prices != null) {
    slotAttrs["data-uni-variant-prices"] = options.prices;
  }
  var slot = createEl("div", slotAttrs);
  var variantInput = createEl("input", {
    id: "product-variant-id",
    name: "id",
    type: "hidden",
    value: options.variantId || "11",
  });
  var quantityInput = null;
  if (options.quantity != null) {
    quantityInput = createEl("input", {
      id: "product-quantity",
      name: "quantity",
      type: "number",
      value: String(options.quantity),
    });
  }
  form.appendChild(slot);
  form.appendChild(variantInput);
  if (quantityInput) form.appendChild(quantityInput);
  wrap.appendChild(form);
  installDom(wrap);
  return {
    slot: slot,
    form: form,
    variantInput: variantInput,
    quantityInput: quantityInput,
  };
}

/** Theme-style variant change: update the selected id, then dispatch change. */
function chooseVariant(fixture, variantId) {
  fixture.variantInput.value = String(variantId);
  dispatchBubblingEvent(fixture.variantInput, "change");
}

/** Theme-style quantity change: update the control, then dispatch the event. */
function chooseQuantity(fixture, quantity, eventType) {
  fixture.quantityInput.value = String(quantity);
  var target = fixture.quantityInput;
  if (eventType === "input") {
    dispatchBubblingEvent(target, "input");
    return;
  }
  if (eventType === "control-only") {
    // Some themes dispatch on the control itself without bubbling.
    dispatchEventOnNode(target, "change");
    return;
  }
  dispatchBubblingEvent(target, "change");
}

function dispatchEventOnNode(node, type) {
  var list = (node.__listeners && node.__listeners[type]) || [];
  for (var i = 0; i < list.length; i++) {
    list[i].call(node, { type: type, target: node });
  }
}

function createCartSlot(minMinor) {
  var attrs = {
    id: "uni-cart-slot",
    "data-uni-cart-button": "",
    "data-unicid": "merchant-1",
    "data-shop-domain": "shop.example",
    "data-shop-permanent-domain": "shop.myshopify.com",
  };
  if (minMinor != null) attrs["data-uni-min-price"] = String(minMinor);
  return createEl("div", attrs);
}

/**
 * Cart fixture shaped like a storefront Cart page: theme section > cart form
 * > (line items) and the UniCredit slot.
 */
function createCartFixture(minMinor) {
  var section = createEl("div", {
    id: "shopify-section-main-cart",
    class: "shopify-section",
  });
  var form = createEl("form", { id: "cart", action: "/cart", method: "post" });
  var lineItems = createEl("div", { id: "cart-items" });
  var quantity = createEl("input", {
    id: "cart-quantity",
    name: "updates[]",
    type: "number",
    value: "1",
  });
  var slot = createCartSlot(minMinor);
  form.appendChild(lineItems);
  form.appendChild(quantity);
  form.appendChild(slot);
  section.appendChild(form);
  installDom(section);
  return { section: section, form: form, slot: slot, quantity: quantity };
}

/** Records observer instances so tests can prove none accumulate. */
function createMutationObserverStub() {
  var instances = [];
  function MutationObserverStub(callback) {
    this.callback = typeof callback === "function" ? callback : function () {};
    this.observed = [];
    instances.push(this);
  }
  MutationObserverStub.prototype.observe = function (target, options) {
    this.observed.push({ target: target, options: options });
  };
  MutationObserverStub.prototype.disconnect = function () {
    this.disconnected = true;
  };
  MutationObserverStub.instances = instances;
  return MutationObserverStub;
}

function triggerCartRedraw(observerStub) {
  for (var i = 0; i < observerStub.instances.length; i++) {
    observerStub.instances[i].callback([], observerStub.instances[i]);
  }
}

/** Let the coalesced cart.js re-check (microtask chain) settle. */
function settle() {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  }).then(function () {
    return new Promise(function (resolve) {
      setImmediate(resolve);
    });
  });
}

/**
 * Deterministic timer queue: replaces the host timer so burst coalescing can
 * be asserted exactly (the default stub fires synchronously).
 */
function useQueuedTimers() {
  var previous = sandbox.setTimeout;
  var queue = [];
  sandbox.setTimeout = function (fn) {
    queue.push(fn);
    return queue.length;
  };
  return {
    queue: queue,
    flush: function () {
      var guard = 0;
      while (queue.length && guard < 100) {
        guard += 1;
        var fn = queue.shift();
        fn();
      }
    },
    restore: function () {
      sandbox.setTimeout = previous;
    },
  };
}

/** Counts transport entry: begin() is only reached when the gate allows CP. */
function createTransportSpy() {
  var calls = { begin: 0 };
  return {
    CP_BASE_URL: "https://cp.example",
    CP_ORIGIN: "https://cp.example",
    CP_URL: "https://cp.example/shopify/financing",
    calls: calls,
    shopifyRoot: function () {
      return "/";
    },
    isConfigured: function () {
      return true;
    },
    isActive: function () {
      return false;
    },
    getFlow: function () {
      return null;
    },
    begin: function () {
      calls.begin += 1;
      return true;
    },
    setIframe: function () {},
    end: function () {
      return true;
    },
    closeActive: function () {},
  };
}

/* -------------------------------------------------------------------------- */
/* Product fixtures                                                           */
/* -------------------------------------------------------------------------- */

function caseProductMinimumBoundaries() {
  var fixture = createProductFixture({
    minMinor: 5000,
    prices: '{"11":4999,"22":5000,"33":5001}',
    quantity: 1,
  });
  var api = loadProductApi();
  fixture.variantInput.value = "11";
  assert.strictEqual(
    api.syncSlotVisibility(fixture.slot),
    false,
    "49.99 x 1 < 50 → ineligible",
  );
  assert.strictEqual(fixture.slot.hidden, true, "49.99 x 1 < 50 → hidden");
  fixture.variantInput.value = "22";
  assert.strictEqual(
    api.syncSlotVisibility(fixture.slot),
    true,
    "50.00 x 1 = 50 → eligible",
  );
  assert.strictEqual(fixture.slot.hidden, false, "50.00 x 1 = 50 → visible");
  fixture.variantInput.value = "33";
  assert.strictEqual(
    api.syncSlotVisibility(fixture.slot),
    true,
    "50.01 x 1 > 50 → eligible",
  );
  assert.strictEqual(fixture.slot.hidden, false, "50.01 x 1 > 50 → visible");
}

/** Price x quantity boundaries, including the equality edge cases. */
function caseProductAmountBoundaries() {
  var prices = '{"11":2499,"22":2500,"33":2501}';

  [
    { variantId: "11", quantity: 2, expected: false, label: "24.99 x 2 = 49.98" },
    { variantId: "22", quantity: 2, expected: true, label: "25.00 x 2 = 50.00" },
    { variantId: "33", quantity: 2, expected: true, label: "25.01 x 2 = 50.02" },
  ].forEach(function (testCase) {
    var fixture = createProductFixture({
      minMinor: 5000,
      prices: prices,
      variantId: testCase.variantId,
      quantity: testCase.quantity,
    });
    // Re-load per fixture so the api resolves this fixture's DOM.
    var scopedApi = loadProductApi();
    assert.strictEqual(
      scopedApi.syncSlotVisibility(fixture.slot),
      testCase.expected,
      testCase.label + " → eligible=" + testCase.expected,
    );
    assert.strictEqual(
      fixture.slot.hidden,
      !testCase.expected,
      testCase.label + " → hidden=" + !testCase.expected,
    );
  });

  [
    { price: 5000, quantity: 1, expected: true, label: "50.00 x 1" },
    { price: 4900, quantity: 1, expected: false, label: "49.00 x 1" },
  ].forEach(function (testCase) {
    var fixture = createProductFixture({
      minMinor: 5000,
      prices: '{"11":' + testCase.price + "}",
      variantId: "11",
      quantity: testCase.quantity,
    });
    var scopedApi = loadProductApi();
    assert.strictEqual(
      scopedApi.syncSlotVisibility(fixture.slot),
      testCase.expected,
      testCase.label + " → eligible=" + testCase.expected,
    );
  });

  // Integer arithmetic only: 24.99 x 2 must be 4998, not a rounded float.
  assert.strictEqual(
    loadProductApi().resolveProductAmountMinor(
      { dataset: { uniMinPrice: "5000", uniVariantPrices: '{"11":2499}' } },
      11,
      2,
    ),
    4998,
    "minor-unit amount is exact integer math",
  );
}

function caseProductVariantAndQuantityTransitions() {
  var fixture = createProductFixture({
    minMinor: 5000,
    prices: '{"11":3000,"22":2000}',
    variantId: "11",
    quantity: 1,
  });
  var api = loadProductApi();
  api.bindProductChange(fixture.slot);

  assert.strictEqual(
    api.syncSlotVisibility(fixture.slot),
    false,
    "30.00 x 1 = 30 → hidden",
  );
  assert.strictEqual(fixture.slot.hidden, true, "30.00 x 1 = 30 → hidden");

  chooseQuantity(fixture, 2);
  assert.strictEqual(
    fixture.slot.hidden,
    false,
    "30.00 x 2 = 60 → visible after quantity change",
  );

  chooseVariant(fixture, 22);
  assert.strictEqual(
    fixture.slot.hidden,
    true,
    "variant change to 20.00 with quantity 2 → 40 → hidden",
  );

  chooseQuantity(fixture, 3);
  assert.strictEqual(
    fixture.slot.hidden,
    false,
    "20.00 x 3 = 60 → visible again",
  );

  chooseVariant(fixture, 11);
  assert.strictEqual(
    fixture.slot.hidden,
    false,
    "30.00 x 3 = 90 → visible",
  );
  chooseQuantity(fixture, 1);
  assert.strictEqual(
    fixture.slot.hidden,
    true,
    "back to 30.00 x 1 = 30 → hidden",
  );
}

/** Repeated Product initialization must not stack change/input listeners. */
function caseProductRebindDoesNotDuplicate() {
  var fixture = createProductFixture({
    minMinor: 5000,
    prices: '{"11":3000}',
    variantId: "11",
    quantity: 1,
  });
  var api = loadProductApi();
  api.bindProductChange(fixture.slot);
  api.bindProductChange(fixture.slot);
  api.bindProductChange(fixture.slot);
  assert.ok(
    fixture.slot.uniChangeBindings.length >= 2,
    "form change + input listeners are recorded for unbinding",
  );
  assert.strictEqual(
    fixture.form.__listeners.change.length,
    1,
    "the product form keeps exactly one change listener",
  );
  assert.strictEqual(
    fixture.form.__listeners.input.length,
    1,
    "the product form keeps exactly one input listener",
  );
  assert.strictEqual(
    fixture.quantityInput.__listeners.change.length,
    1,
    "the quantity control keeps exactly one change listener",
  );
  assert.strictEqual(
    fixture.quantityInput.__listeners.input.length,
    1,
    "the quantity control keeps exactly one input listener",
  );

  api.syncSlotVisibility(fixture.slot);
  assert.strictEqual(fixture.slot.hidden, true, "30.00 x 1 → hidden");
  var timers = useQueuedTimers();
  chooseQuantity(fixture, 2);
  assert.strictEqual(timers.queue.length, 1, "one re-check per event burst");
  timers.flush();
  timers.restore();
  assert.strictEqual(
    fixture.slot.hidden,
    false,
    "re-bound listeners still re-sync visibility",
  );
}

/** Two product slots on one page must re-sync independently. */
function caseProductTwoSlotsStayIndependent() {
  var page = createEl("div", {});

  function buildSlot(letter, prices, variantId) {
    var form = createEl("form", {
      id: "form-" + letter,
      action: "/cart/add",
      class: "product-form",
    });
    var slot = createEl("div", {
      id: "slot-" + letter,
      "data-uni-product-button": "",
      "data-unicid": "merchant-1",
      "data-shop-domain": "shop.example",
      "data-shop-permanent-domain": "shop.myshopify.com",
      "data-uni-min-price": "5000",
      "data-uni-variant-prices": prices,
      "data-initial-variant-id": variantId,
    });
    var variantInput = createEl("input", {
      name: "id",
      type: "hidden",
      value: variantId,
    });
    var quantityInput = createEl("input", {
      name: "quantity",
      type: "number",
      value: "1",
    });
    form.appendChild(slot);
    form.appendChild(variantInput);
    form.appendChild(quantityInput);
    page.appendChild(form);
    return { slot: slot, variantInput: variantInput, quantityInput: quantityInput };
  }

  var first = buildSlot("a", '{"11":3000}', "11"); // 30.00 → hidden
  var second = buildSlot("b", '{"22":6000,"33":2000}', "22"); // 60.00 → visible
  installDom(page);
  var api = loadProductApi();
  api.bindProductChange(first.slot);
  api.bindProductChange(second.slot);
  api.syncSlotVisibility(first.slot);
  api.syncSlotVisibility(second.slot);
  assert.strictEqual(first.slot.hidden, true, "slot A: 30.00 x 1 → hidden");
  assert.strictEqual(second.slot.hidden, false, "slot B: 60.00 x 1 → visible");

  var timers = useQueuedTimers();
  first.quantityInput.value = "2"; // 30.00 x 2 = 60 → visible
  second.variantInput.value = "33"; // 20.00 x 1 = 20 → hidden
  dispatchBubblingEvent(first.quantityInput, "change");
  dispatchBubblingEvent(second.variantInput, "change");
  assert.strictEqual(
    timers.queue.length,
    2,
    "each slot coalesces its own burst (per-slot pending flag)",
  );
  timers.flush();
  timers.restore();

  assert.strictEqual(
    first.slot.hidden,
    false,
    "slot A follows its own quantity change",
  );
  assert.strictEqual(
    second.slot.hidden,
    true,
    "slot B follows its own variant change",
  );
}

/** Quantity widgets: bubbling change, input, and non-bubbling control events. */
function caseProductQuantityEventSources() {
  ["change", "input", "control-only"].forEach(function (eventType) {
    var fixture = createProductFixture({
      minMinor: 5000,
      prices: '{"11":3000}',
      variantId: "11",
      quantity: 1,
    });
    var api = loadProductApi();
    api.bindProductChange(fixture.slot);
    api.syncSlotVisibility(fixture.slot);
    assert.strictEqual(fixture.slot.hidden, true, "starts hidden at qty 1");

    chooseQuantity(fixture, 2, eventType);
    assert.strictEqual(
      fixture.slot.hidden,
      false,
      eventType + " quantity event re-syncs to visible",
    );
  });

  // Quantity without a usable control counts as 1; invalid values too.
  var noQuantity = createProductFixture({
    minMinor: 5000,
    prices: '{"11":3000}',
    variantId: "11",
  });
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveVisibilityQuantity(noQuantity.slot),
    1,
    "no quantity control → 1",
  );
  assert.strictEqual(
    api.syncSlotVisibility(noQuantity.slot),
    false,
    "30.00 x 1 → hidden without a quantity control",
  );

  var invalidQuantity = createProductFixture({
    minMinor: 5000,
    prices: '{"11":3000}',
    variantId: "11",
    quantity: 0,
  });
  var invalidApi = loadProductApi();
  assert.strictEqual(
    invalidApi.resolveVisibilityQuantity(invalidQuantity.slot),
    1,
    "invalid quantity falls back to 1 for visibility",
  );
  assert.strictEqual(
    invalidApi.syncSlotVisibility(invalidQuantity.slot),
    false,
    "invalid quantity keeps the safe 1-unit visibility result",
  );
}

function caseProductPriceDataAndFallback() {
  var api = loadProductApi();

  [
    { dataset: {} },
    { dataset: null },
    { dataset: { uniMinPrice: "" } },
    { dataset: { uniMinPrice: "0" } },
    { dataset: { uniMinPrice: "-10" } },
    { dataset: { uniMinPrice: "49.5" } },
    { dataset: { uniMinPrice: "abc" } },
  ].forEach(function (container) {
    assert.strictEqual(
      api.resolveMinimumMinor(container),
      5000,
      "invalid/missing minimum → fallback 50",
    );
  });
  assert.strictEqual(
    api.resolveMinimumMinor({ dataset: { uniMinPrice: "100" } }),
    100,
    "Liquid-rendered 1 whole unit (100 minor) passes through",
  );
  assert.strictEqual(
    api.resolveMinimumMinor({ dataset: { uniMinPrice: "25000" } }),
    25000,
    "Liquid-rendered 250 whole units (25000 minor) passes through",
  );

  var freeVariant = {
    dataset: { uniMinPrice: "5000", uniVariantPrices: '{"11":0}' },
  };
  assert.strictEqual(
    api.resolveVariantPriceMinor(freeVariant, 11),
    0,
    "free variant price resolves",
  );
  assert.strictEqual(
    api.isAmountAboveMinimum(freeVariant, 11, 1),
    false,
    "free variant is below any positive minimum",
  );
  assert.strictEqual(
    api.resolveProductAmountMinor(freeVariant, 11, 0),
    0,
    "invalid quantity cannot inflate the local amount",
  );
  assert.strictEqual(
    api.resolveVariantPriceMinor(freeVariant, 99),
    null,
    "unknown variant price → null",
  );

  var noPriceData = { dataset: { uniMinPrice: "5000" } };
  assert.strictEqual(
    api.isAmountAboveMinimum(noPriceData, 123, 1),
    true,
    "missing local price keeps pre-existing eligibility",
  );
  var badPriceData = {
    dataset: { uniMinPrice: "5000", uniVariantPrices: "not json" },
  };
  assert.strictEqual(
    api.isAmountAboveMinimum(badPriceData, 123, 1),
    true,
    "unparsable local price keeps pre-existing eligibility",
  );
  assert.strictEqual(
    api.isAmountAboveMinimum(freeVariant, null, 1),
    false,
    "unresolved variant cannot be eligible",
  );
}

/* -------------------------------------------------------------------------- */
/* Cart fixtures                                                              */
/* -------------------------------------------------------------------------- */

function caseCartMinimumBoundaries() {
  installDom(createEl("div", {}));
  var api = loadCartApi();
  var slot = createCartSlot(5000);

  assert.strictEqual(
    api.isCartAboveMinimum(slot, { total_price: 4999 }),
    false,
    "cart 49.99 < 50 → ineligible",
  );
  assert.strictEqual(
    api.isCartAboveMinimum(slot, { total_price: 5000 }),
    true,
    "cart 50.00 = 50 → eligible",
  );
  assert.strictEqual(
    api.isCartAboveMinimum(slot, { total_price: 5001 }),
    true,
    "cart 50.01 > 50 → eligible",
  );
  assert.strictEqual(
    api.isCartAboveMinimum(slot, { total_price: null }),
    true,
    "unknown cart amount keeps pre-existing eligibility",
  );
  assert.strictEqual(
    api.isCartAboveMinimum(slot, null),
    true,
    "missing cart keeps pre-existing eligibility",
  );
  assert.strictEqual(
    api.resolveMinimumMinor(createCartSlot(null)),
    5000,
    "missing cart minimum → fallback 50",
  );
  assert.strictEqual(
    api.resolveMinimumMinor(createCartSlot("49.5")),
    5000,
    "invalid cart minimum → fallback 50",
  );
}

/** Liquid renders the initial state; the watcher must flip it either way. */
function caseCartInitialStateFromLiquid() {
  var fixture = createCartFixture(5000);
  var api = loadCartApi();
  api.ensureCartObservation(fixture.slot);

  fixture.slot.hidden = true; // Liquid rendered a below-minimum cart
  api.applyCartVisibility({ total_price: 6000 });
  assert.strictEqual(
    fixture.slot.hidden,
    false,
    "initial below minimum → above becomes visible",
  );
  api.applyCartVisibility({ total_price: 4999 });
  assert.strictEqual(
    fixture.slot.hidden,
    true,
    "above → below becomes hidden again",
  );

  fixture.slot.hidden = false; // Liquid rendered an at/above-minimum cart
  api.applyCartVisibility({ total_price: 4999 });
  assert.strictEqual(
    fixture.slot.hidden,
    true,
    "initial above minimum → below becomes hidden",
  );
  assert.ok(
    fixture.form.contains(fixture.slot),
    "the slot is toggled in place, never removed",
  );
}

/** Dynamic Cart visibility must never rely on broad observation. */
function caseCartScopeSafety() {
  var observerStub = createMutationObserverStub();
  sandbox.MutationObserver = observerStub;

  var loose = createEl("div", {});
  var looseSlot = createCartSlot(5000);
  loose.appendChild(looseSlot);
  installDom(loose);
  var looseApi = loadCartApi();
  assert.strictEqual(
    looseApi.resolveCartObservationScope(looseSlot),
    null,
    "no Cart form/section → no observation scope",
  );
  looseApi.ensureCartObservation(looseSlot);
  assert.strictEqual(
    observerStub.instances.length,
    0,
    "no observer is created without a safe narrow scope",
  );

  var fixture = createCartFixture(5000);
  var api = loadCartApi();
  var scope = api.resolveCartObservationScope(fixture.slot);
  assert.strictEqual(scope, fixture.form, "Cart form is the observation scope");
  assert.notStrictEqual(scope, sandbox.document);
  assert.notStrictEqual(scope, sandbox.document.body);
  assert.notStrictEqual(scope, sandbox.document.documentElement);
  assert.notStrictEqual(
    scope,
    fixture.section,
    "the narrower Cart form is preferred over the theme section",
  );
  assert.strictEqual(
    api.isObservableScope(sandbox.document),
    false,
    "document is never an observation target",
  );
  assert.strictEqual(
    api.isObservableScope(sandbox.document.body),
    false,
    "document.body is never an observation target",
  );
  assert.strictEqual(
    api.isObservableScope(sandbox.document.documentElement),
    false,
    "documentElement is never an observation target",
  );
  assert.strictEqual(
    api.isObservableScope(null),
    false,
    "a missing scope is never observable",
  );
  assert.strictEqual(
    api.isObservableScope(fixture.form),
    true,
    "the resolved Cart form is observable",
  );
}

/* Cart updates use the integration's real cart.js mechanism. */
function stubCartFetch(getCart) {
  sandbox.fetch = function () {
    return Promise.resolve({
      ok: true,
      json: function () {
        return Promise.resolve(getCart());
      },
    });
  };
}

function caseCartUpdateAcrossThreshold() {
  var cart = cartSnapshot(4999, 1);
  stubCartFetch(function () {
    return cart;
  });
  var fixture = createCartFixture(5000);
  var api = loadCartApi();
  var slot = fixture.slot;

  return api
    .fetchStableCart()
    .then(function (snapshot) {
      assert.strictEqual(
        api.isCartAboveMinimum(slot, snapshot),
        false,
        "cart 49.99 → below minimum",
      );
      // Quantity update raises the cart above the minimum.
      cart = cartSnapshot(5001, 2);
      return api.fetchStableCart();
    })
    .then(function (snapshot) {
      assert.strictEqual(
        api.isCartAboveMinimum(slot, snapshot),
        true,
        "cart 50.01 → eligible again",
      );
      assert.strictEqual(
        snapshot.token,
        "cart-token-1",
        "cart identity untouched by the gate",
      );
    });
}

function cartSnapshot(totalPrice, quantity) {
  return {
    token: "cart-token-1",
    item_count: quantity,
    total_price: totalPrice,
    currency: "BGN",
    items: [{ key: "1:abc", quantity: quantity, final_line_price: totalPrice }],
  };
}

/** 40 → 60 and 60 → 40 through the implemented observation mechanisms. */
function caseCartDynamicVisibility() {
  var observerStub = createMutationObserverStub();
  sandbox.MutationObserver = observerStub;
  var cart = cartSnapshot(4000, 1);
  stubCartFetch(function () {
    return cart;
  });
  var fixture = createCartFixture(5000);
  var api = loadCartApi();
  api.ensureCartObservation(fixture.slot);
  fixture.slot.hidden = true; // Liquid: below minimum

  return Promise.resolve()
    .then(function () {
      // Cart quantity raised to 60 → the theme redraws the Cart DOM.
      cart = cartSnapshot(6000, 2);
      fixture.form.appendChild(createEl("div", { id: "cart-line-2" }));
      triggerCartRedraw(observerStub);
      return settle();
    })
    .then(function () {
      assert.strictEqual(
        fixture.slot.hidden,
        false,
        "cart 40 → 60 shows the button without a page reload",
      );
      assert.strictEqual(
        observerStub.instances.length,
        1,
        "exactly one observer drives the Cart update",
      );
      var instance = observerStub.instances[0];
      assert.strictEqual(
        instance.observed[0].target,
        fixture.form,
        "the observer watches the resolved Cart form only",
      );
      assertDeepEqual(
        instance.observed[0].options,
        { childList: true, subtree: true },
        "childList + subtree only — never attributes (no hidden-toggle loop)",
      );

      // Cart quantity lowered back to 40 → scoped Cart control event.
      cart = cartSnapshot(4000, 1);
      dispatchBubblingEvent(fixture.quantity, "change");
      return settle();
    })
    .then(function () {
      assert.strictEqual(
        fixture.slot.hidden,
        true,
        "cart 60 → 40 hides the button again",
      );
    });
}

/** Repeated initialization and section redraws must not stack watchers. */
function caseCartNoDuplicateObservation() {
  var observerStub = createMutationObserverStub();
  sandbox.MutationObserver = observerStub;
  stubCartFetch(function () {
    return cartSnapshot(6000, 2);
  });
  var fixture = createCartFixture(5000);
  var api = loadCartApi();
  var created = observerStub.instances.length;

  api.ensureCartObservation(fixture.slot);
  api.ensureCartObservation(fixture.slot);
  api.ensureCartObservation(fixture.slot);
  assert.strictEqual(
    observerStub.instances.length,
    created + 1,
    "repeated initialization creates exactly one observer",
  );
  assert.strictEqual(
    observerStub.instances[created].observed.length,
    1,
    "the observer is armed once, not re-armed per initialization",
  );
  assert.strictEqual(
    api.cartWatch.bindings.length,
    3,
    "scoped Cart events (change/input/submit) are bound once",
  );
  assert.strictEqual(
    api.cartWatch.containers.length,
    1,
    "the slot is registered once",
  );

  // Theme replaces the Cart section: the old scope is gone.
  fixture.slot.isConnected = false;
  var redraw = createCartFixture(5000);
  api.ensureCartObservation(redraw.slot);
  var instance = observerStub.instances[created];
  assert.strictEqual(
    observerStub.instances.length,
    created + 1,
    "section redraw reuses the single observer",
  );
  assert.strictEqual(
    instance.observed.length,
    2,
    "the observer is re-armed once for the new scope",
  );
  assert.strictEqual(
    instance.observed[1].target,
    redraw.form,
    "the observer is rebound to the new Cart form",
  );
  assert.strictEqual(
    api.cartWatch.bindings.length,
    3,
    "scoped Cart events are rebound, not duplicated",
  );
  assert.strictEqual(
    api.cartWatch.containers.length,
    1,
    "the detached slot is dropped",
  );

  api.applyCartVisibility(cartSnapshot(6000, 2));
  assert.strictEqual(redraw.slot.hidden, false, "new slot follows the cart");
  return Promise.resolve();
}

/** One Cart redraw must collapse into a single cart.js stability round. */
async function caseCartCoalescedRechecks() {
  var observerStub = createMutationObserverStub();
  sandbox.MutationObserver = observerStub;
  var timers = useQueuedTimers();
  var reads = 0;
  sandbox.fetch = function () {
    reads += 1;
    return Promise.resolve({
      ok: true,
      json: function () {
        return Promise.resolve(cartSnapshot(6000, 2));
      },
    });
  };
  var fixture = createCartFixture(5000);
  var api = loadCartApi();
  api.ensureCartObservation(fixture.slot);
  reads = 0;

  // A single Cart redraw bursts into several mutations.
  for (var i = 0; i < 5; i++) {
    fixture.form.appendChild(createEl("div", { id: "cart-line-" + i }));
    triggerCartRedraw(observerStub);
  }
  assert.strictEqual(
    timers.queue.length,
    1,
    "mutation burst collapses into one scheduled re-check",
  );

  for (var round = 0; round < 6; round++) {
    timers.flush();
    await new Promise(function (resolve) {
      setImmediate(resolve);
    });
  }
  timers.restore();

  assert.strictEqual(
    reads,
    2,
    "one cart.js stability round (2 reads) for the whole burst",
  );
  assert.strictEqual(
    fixture.slot.hidden,
    false,
    "coalesced Cart update applied the visibility toggle",
  );
}

/** A failed cart.js read must never throw, hide wrongly, or start CP. */
function caseCartRefreshFailureIsSafe() {
  var transportSpy = createTransportSpy();
  sandbox.fetch = function () {
    return Promise.reject(new Error("cart-http-500"));
  };
  var fixture = createCartFixture(5000);
  var api = loadCartApi(transportSpy);
  api.ensureCartObservation(fixture.slot);
  fixture.slot.hidden = true;

  return api.refreshCartVisibility().then(function () {
    assert.strictEqual(
      fixture.slot.hidden,
      true,
      "failed Cart read keeps the current visibility",
    );
    assert.strictEqual(
      transportSpy.calls.begin,
      0,
      "failed Cart read never reaches CP",
    );
    assert.ok(
      fixture.form.contains(fixture.slot),
      "failed Cart read keeps the slot in the DOM",
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Click-time safety: below minimum must never reach CP                       */
/* -------------------------------------------------------------------------- */

function caseProductClickGateBlocksCpRequest() {
  var transportSpy = createTransportSpy();
  var fixture = createProductFixture({
    minMinor: 5000,
    prices: '{"11":3000,"22":2000}',
    variantId: "11",
    quantity: 1,
  });
  var api = loadProductApi(transportSpy);
  api.bindProductChange(fixture.slot);
  var button = { disabled: false };

  return api
    .handleClick(fixture.slot, button)
    .then(function () {
      assert.strictEqual(
        transportSpy.calls.begin,
        0,
        "30.00 x 1 below minimum → no CP request",
      );
      assert.strictEqual(
        fixture.slot.hidden,
        true,
        "below-minimum slot hidden at click time",
      );
      chooseQuantity(fixture, 2);
      assert.strictEqual(
        fixture.slot.hidden,
        false,
        "30.00 x 2 = 60 → visibility restored by the quantity change",
      );
      return api.handleClick(fixture.slot, button);
    })
    .then(function () {
      // The mock DOM cannot complete the modal, so begin() is the CP boundary.
      assert.ok(
        transportSpy.calls.begin >= 1,
        "eligible amount reaches CP transport",
      );
      assert.strictEqual(
        button.disabled,
        false,
        "button re-enabled after the attempt",
      );

      // Variant drops to 20.00 with quantity 2 → 40 → below minimum again.
      chooseVariant(fixture, 22);
      assert.strictEqual(
        fixture.slot.hidden,
        true,
        "variant + quantity combination below minimum hides the slot",
      );
      var before = transportSpy.calls.begin;
      return api.handleClick(fixture.slot, button).then(function () {
        assert.strictEqual(
          transportSpy.calls.begin,
          before,
          "20.00 x 2 = 40 adds no CP request",
        );
      });
    });
}

function caseCartClickGateBlocksCpRequest() {
  var cart = cartSnapshot(4999, 1);
  stubCartFetch(function () {
    return cart;
  });
  var transportSpy = createTransportSpy();
  var fixture = createCartFixture(5000);
  var api = loadCartApi(transportSpy);
  var slot = fixture.slot;
  var button = { disabled: false };

  return api
    .handleClick(slot, button)
    .then(function () {
      assert.strictEqual(
        transportSpy.calls.begin,
        0,
        "cart below minimum → no CP request",
      );
      assert.strictEqual(
        slot.hidden,
        true,
        "stale below-minimum cart slot hidden at click time",
      );
      // Cart grows through the same cart.js path the integration already uses.
      cart = cartSnapshot(6000, 2);
      return api.handleClick(slot, button);
    })
    .then(function () {
      assert.ok(
        transportSpy.calls.begin >= 1,
        "cart at/above minimum reaches CP transport",
      );
      assert.strictEqual(
        button.disabled,
        false,
        "button re-enabled after the attempt",
      );
      // Cart shrinks back below the minimum → no further CP request.
      cart = cartSnapshot(4000, 1);
      var before = transportSpy.calls.begin;
      return api.handleClick(slot, button).then(function () {
        assert.strictEqual(
          transportSpy.calls.begin,
          before,
          "cart below minimum adds no CP request",
        );
      });
    });
}

caseProductMinimumBoundaries();
caseProductAmountBoundaries();
caseProductVariantAndQuantityTransitions();
caseProductRebindDoesNotDuplicate();
caseProductTwoSlotsStayIndependent();
caseProductQuantityEventSources();
caseProductPriceDataAndFallback();
caseCartMinimumBoundaries();
caseCartInitialStateFromLiquid();
caseCartScopeSafety();

async function runAsyncThresholdChecks() {
  await caseCartUpdateAcrossThreshold();
  await caseCartDynamicVisibility();
  await caseCartNoDuplicateObservation();
  await caseCartCoalescedRechecks();
  await caseCartRefreshFailureIsSafe();
  await caseProductClickGateBlocksCpRequest();
  await caseCartClickGateBlocksCpRequest();
}

runAsyncThresholdChecks().then(
  function () {
    console.log("check-uni-hardening: OK");
  },
  function (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  },
);
