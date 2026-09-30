# F02-3: Product payload v2

The Product financing POST now carries customer intent and merchant binding only.

Previously, Product sent a serialized product line containing product and variant
metadata, selected options, collection IDs, unit/line pricing, currency, and the
browser-calculated total. Product v2 sends exactly:

```text
payload_version=2
source=product
unicid
shop_domain
shop_permanent_domain
variant_id
quantity
```

Price, currency, catalog metadata, collections, and variant ownership are
authoritatively reconstructed and validated by CP. The theme still resolves the
currently selected variant and customer-selected integer quantity, but performs
no financing price calculation or Product catalog lookup.

F02-5 subsequently moved Cart to its own six-field v2 capability contract. That
later Cart change does not alter this Product contract.

The Product button is shown only for exact EUR buyer presentment from
`localization.country.currency.iso_code` at initial render. Before POST, the
theme checks a fresh locale-aware `/cart.js` `cart.currency` for exact `EUR`;
an unavailable or noncanonical value hides the slot without POST. The Product
probe reads only presentment currency, so an empty cart is valid. The local
currency attribute is also rechecked, but neither currency is included in the
payload. CP separately requires exact `EUR` in authoritative Storefront
`MoneyV2.currencyCode`.

## Runtime verification

On a Product page, select a variant and quantity, open financing, and confirm
Step 1 shows the Storefront-derived amount and currency. Repeat after changing
the variant and quantity. In DevTools Network, inspect the POST to CP and confirm
its Form Data contains only the seven fields above.
