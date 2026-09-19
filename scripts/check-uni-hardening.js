/**
 * Lightweight static fixtures for UniCredit Product/Cart hardening.
 * Run: node scripts/check-uni-hardening.js
 */
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.join(__dirname, "..");
var transportPath = path.join(root, "assets", "uni-transport.js");
var productPath = path.join(root, "assets", "uni-product-button.js");

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
var cartJs = fs.readFileSync(
  path.join(root, "assets", "uni-cart-button.js"),
  "utf8",
);

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
assert.ok(cartJs.indexOf("validateCurrency(cart.currency)") !== -1);
assert.ok(cartJs.indexOf("dataset.currency") === -1);
assert.ok(cartJs.indexOf("cart/clear") === -1);

assert.ok(fs.existsSync(path.join(root, "assets", "uni-transport.js")));

assert.ok(T.isConfigured(), "CP config must resolve");
assert.strictEqual(T.CP_ORIGIN, new URL(T.CP_BASE_URL).origin);
assert.strictEqual(
  T.CP_URL,
  new URL(T.CP_BASE_URL).origin + "/shopify/product-test",
);
assert.ok(productJs.indexOf("uni.avalonbg.com") === -1);
assert.ok(cartJs.indexOf("uni.avalonbg.com") === -1);
assert.ok(productJs.indexOf("/shopify/product-test") === -1);
assert.ok(cartJs.indexOf("/shopify/product-test") === -1);
assert.ok(productJs.indexOf("isConfigured") !== -1);
assert.ok(cartJs.indexOf("isConfigured") !== -1);

/* Portability: primary quantity uses JET-compatible generic selectors */
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
  productJs.indexOf("theme-section compatibility fallback") !== -1 ||
    productJs.indexOf("Theme-section compatibility fallback") !== -1,
  "section path must be labeled fallback",
);
assert.ok(
  productJs.indexOf("Step 3 — generic Shopify quantity candidates") !== -1,
  "generic step must be primary before theme fallback",
);

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
    get id() {
      return this.attrs.id;
    },
    set id(v) {
      this.attrs.id = v;
    },
    get value() {
      return this.attrs.value != null ? String(this.attrs.value) : "";
    },
    set value(v) {
      this.attrs.value = v;
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
    getElementById: function () {
      return null;
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

function caseA_quantityInsideForm() {
  var wrap = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var qty = createEl("input", { name: "quantity", value: "2" });
  var uni = createEl("div", { "data-uni-product-button": "" });
  form.appendChild(qty);
  form.appendChild(uni);
  wrap.appendChild(form);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    2,
    "Case A: quantity inside form",
  );
}

function caseB_quantityFormLinked() {
  // No shopify-section — page-level form= association
  var wrap = createEl("div", {});
  var form = createEl("form", {
    id: "product-form-id",
    action: "/cart/add",
    class: "product-form",
  });
  var qty = createEl("input", {
    name: "quantity",
    value: "2",
    form: "product-form-id",
  });
  var uni = createEl("div", { "data-uni-product-button": "" });
  wrap.appendChild(form);
  wrap.appendChild(qty);
  wrap.appendChild(uni);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    2,
    "Case B: form-linked quantity",
  );
}

function caseC_singleGenericPageQuantity() {
  // No section wrapper; quantity outside form; exactly one generic candidate
  var wrap = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var qty = createEl("input", { name: "quantity", value: "2" });
  var uni = createEl("div", { "data-uni-product-button": "" });
  wrap.appendChild(form);
  wrap.appendChild(qty);
  wrap.appendChild(uni);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    2,
    "Case C: exactly one generic page quantity",
  );
}

function caseD_multipleCandidatesOneAssociated() {
  var page = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var uni = createEl("div", { "data-uni-product-button": "" });
  // Associated via explicit form="<id>" (outside form body)
  var mainQty = createEl("input", {
    name: "quantity",
    value: "2",
    form: "product-form",
  });
  form.appendChild(uni);

  var qForm = createEl("form", {
    id: "quick-form",
    action: "/cart/add",
    class: "product-form",
  });
  var qQty = createEl("input", { name: "quantity", value: "9" });
  qForm.appendChild(qQty);

  page.appendChild(form);
  page.appendChild(mainQty);
  page.appendChild(qForm);
  installDom(page);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    2,
    "Case D: only associated product quantity selected",
  );
}

function caseE_ambiguousMultipleNoArbitrary() {
  // Two unassociated generic quantities + form without qty → do not pick first
  var page = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var uni = createEl("div", { "data-uni-product-button": "" });
  var qtyA = createEl("input", { name: "quantity", value: "2" });
  var qtyB = createEl("input", { name: "quantity", value: "5" });
  // Separate forms own each qty so neither is uniquely "the only page qty",
  // and neither is associated with product-form.
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
  formA.appendChild(qtyA);
  formB.appendChild(qtyB);
  page.appendChild(form);
  page.appendChild(uni);
  page.appendChild(formA);
  page.appendChild(formB);
  installDom(page);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    1,
    "Case E: ambiguous multiples → no arbitrary selection (fallback 1)",
  );
}

function caseF_noQuantityDefaultsToOne() {
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
  assert.strictEqual(
    api.resolveQuantity(uni),
    1,
    "Case F: missing quantity → 1",
  );
}

function caseG_invalidExplicitFailsSafely() {
  var wrap = createEl("div", {});
  var form = createEl("form", {
    id: "product-form",
    action: "/cart/add",
    class: "product-form",
  });
  var qty = createEl("input", { name: "quantity", value: "0" });
  var uni = createEl("div", { "data-uni-product-button": "" });
  form.appendChild(qty);
  form.appendChild(uni);
  wrap.appendChild(form);
  installDom(wrap);
  var api = loadProductApi();
  assert.strictEqual(
    api.resolveQuantity(uni),
    null,
    "Case G: invalid explicit quantity → fail safely",
  );
}

caseA_quantityInsideForm();
caseB_quantityFormLinked();
caseC_singleGenericPageQuantity();
caseD_multipleCandidatesOneAssociated();
caseE_ambiguousMultipleNoArbitrary();
caseF_noQuantityDefaultsToOne();
caseG_invalidExplicitFailsSafely();

console.log("check-uni-hardening: OK");
