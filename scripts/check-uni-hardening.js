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

assert.ok(
  productJs.indexOf("document.querySelector('[name=\"quantity\"]')") === -1,
);
assert.ok(
  productJs.indexOf("document.querySelector(\n      'form[action*") === -1,
);
assert.ok(productJs.indexOf("assertVariantBelongsToProduct") !== -1);
assert.ok(productJs.indexOf("resolvePresentmentCurrency") !== -1);
assert.ok(productJs.indexOf("dataset.currency") === -1);

assert.ok(cartJs.indexOf("fetchStableCart") !== -1);
assert.ok(cartJs.indexOf("fetchCartContextForFinancing") !== -1);
assert.ok(cartJs.indexOf("fetchCartCollectionMap") !== -1);
assert.ok(cartJs.indexOf("uni-cart-collections") !== -1);
assert.ok(cartJs.indexOf("collection_ids") !== -1);
assert.ok(cartJs.indexOf("validateCurrency(cart.currency)") !== -1);
assert.ok(cartJs.indexOf("dataset.currency") === -1);
assert.ok(cartJs.indexOf("cart/clear") === -1);

assert.ok(productJs.indexOf("data-uni-collection-ids") !== -1);
assert.ok(productJs.indexOf("collection_ids") !== -1);
assert.ok(productJs.indexOf("readProductCollectionIds") !== -1);

assert.ok(
  fs.existsSync(path.join(root, "sections", "uni-cart-collections.liquid")),
  "cart collections section required",
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
  var fn = productJs.indexOf("function resolveQuantity");
  assert.ok(fn !== -1, "resolveQuantity present");
  var collectAt = productJs.indexOf("collectGenericQuantityCandidates()", fn);
  var formAt = productJs.indexOf("findProductForm(container)", fn);
  assert.ok(
    collectAt !== -1 && formAt !== -1,
    "collect + form used in resolveQuantity",
  );
  assert.ok(
    collectAt < formAt,
    "generic candidates must be collected before findProductForm disambiguation",
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
  var el = {
    tagName: String(tagName).toUpperCase(),
    attrs: attrs,
    children: [],
    parentNode: null,
    disabled: !!attrs.disabled,
    hidden: !!attrs.hidden,
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
      return {};
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

function loadProductApi() {
  delete sandbox.__UniProductTestApi;
  sandbox.__UNI_ENABLE_PRODUCT_TEST_API = true;
  sandbox.__UniTransport = T;
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

/* -------------------------------------------------------------------------- */
/* Collection IDs — Product + Cart fixtures                                   */
/* -------------------------------------------------------------------------- */

function loadCartApi() {
  delete sandbox.__UniCartTestApi;
  sandbox.__UNI_ENABLE_CART_TEST_API = true;
  sandbox.__UniTransport = T;
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

function caseProductCollectionsPresent() {
  var wrap = createEl("div", {});
  var uni = createEl("div", { "data-uni-product-button": "" });
  var json = createEl("script", {
    type: "application/json",
    "data-uni-collection-ids": "",
  });
  json.textContent = "[10,20,30]";
  uni.appendChild(json);
  wrap.appendChild(uni);
  // Extend createEl for script textContent if needed
  json.getAttribute = function (name) {
    return this.attrs[name] != null ? String(this.attrs[name]) : null;
  };
  uni.querySelector = function (selector) {
    if (selector === "[data-uni-collection-ids]") return json;
    return null;
  };
  installDom(wrap);
  var api = loadProductApi();
  assertDeepEqual(
    api.readProductCollectionIds(uni),
    [10, 20, 30],
    "Product: collections 10,20,30",
  );
}

function caseProductCollectionsDedupe() {
  var wrap = createEl("div", {});
  var uni = createEl("div", { "data-uni-product-button": "" });
  var json = createEl("script", {
    type: "application/json",
    "data-uni-collection-ids": "",
  });
  json.textContent = "[10,20,10]";
  uni.querySelector = function (selector) {
    if (selector === "[data-uni-collection-ids]") return json;
    return null;
  };
  wrap.appendChild(uni);
  installDom(wrap);
  var api = loadProductApi();
  assertDeepEqual(
    api.normalizeCollectionIds([10, 20, 10]),
    [10, 20],
    "Product: duplicate IDs removed",
  );
  assertDeepEqual(
    api.readProductCollectionIds(uni),
    [10, 20],
    "Product: Liquid duplicates normalized",
  );
}

function caseProductCollectionsInvalidAndEmpty() {
  assertDeepEqual(
    T.normalizeCollectionIds([0, -5, "abc", 1.2, NaN, Infinity]),
    [],
    "Invalid IDs removed → []",
  );
  var wrap = createEl("div", {});
  var uni = createEl("div", { "data-uni-product-button": "" });
  uni.querySelector = function () {
    return null;
  };
  wrap.appendChild(uni);
  installDom(wrap);
  var api = loadProductApi();
  assertDeepEqual(
    api.readProductCollectionIds(uni),
    [],
    "Product: no collections → []",
  );
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

caseProductCollectionsPresent();
caseProductCollectionsDedupe();
caseProductCollectionsInvalidAndEmpty();
caseCartOneProductCollections();
caseCartTwoProductsOwnCollections();
caseCartSameProductMultipleVariants();
caseCartMissingMapEntry();
caseCartClickUsesSectionRenderingNotInitialLiquid();

console.log("check-uni-hardening: OK");
