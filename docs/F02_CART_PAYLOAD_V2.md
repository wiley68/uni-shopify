# F02-5: Cart payload v2

The Cart financing POST now carries only a Cart capability and merchant binding.

## Before and after

The old payload sent `source`, `unicid`, `shop_domain`,
`shop_permanent_domain`, `currency`, `products`, `total_price_cents`, and (after
F02-4A) `cart_identity`. Each serialized product included product/variant IDs,
titles, handle, options, quantity, prices, line total, and collection IDs.

Cart v2 sends exactly:

```text
payload_version=2
source=cart
unicid
shop_domain
shop_permanent_domain
cart_identity
```

The dedicated collection Section Rendering request and all browser-side Cart
product, quantity, price, total, and currency serialization have been removed.
CP reconstructs lines, quantities, catalog metadata, collections, final money,
currency, and frozen context authoritatively through Storefront Cart lookup.

## Cart identity contract

`cart_identity` is the unmodified `cart.token` from the final stable `/cart.js`
snapshot. The full token, including its `?key=...` suffix, is sent without
parsing, stripping, encoding round trips, GID prefixing, or candidate generation.
A missing, null, empty, whitespace-only, or non-string token blocks the POST and
uses the existing safe error path. The capability is not logged, displayed, or
persisted.

## Product versus Cart

Product v2 remains the seven-field intent contract: `payload_version`, `source`,
`unicid`, `shop_domain`, `shop_permanent_domain`, `variant_id`, and `quantity`.
Cart sends neither variant nor quantity because CP obtains current Cart state.

## Runtime verification

Test a normal Cart, an updated quantity, a discounted Cart (including the known
641.21 EUR case), and a multi-line Cart. Step 1 must show the latest Shopify
amount, currency, and schemes. In DevTools Network, inspect the Form Data for
`POST /shopify/financing`: it must contain only the six Cart v2 keys above.
