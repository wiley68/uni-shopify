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

console.log("check-uni-hardening: OK");
