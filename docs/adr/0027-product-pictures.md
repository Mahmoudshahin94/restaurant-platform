# ADR 0027: Product pictures on every screen

- Status: Accepted (2026-10-30)

## Context

M5 ([ADR 0021](0021-retail-catalog.md)) let a product and each of its variants store up to ten
pictures (`ProductImage`, files of kind `PRODUCT_IMAGE`), but only through the API:

- The admin had no way to add them.
- The POS, the kiosk and the customer website never showed them.
- Pictures stayed in the cloud, so the location hub could not serve them offline.

Customers choose by picture at a kiosk and on a menu website, and cashiers find items faster on a
picture grid. Pictures are also the biggest thing a menu carries. A snapshot that resent every
picture on every menu edit would cost each hub megabytes per change.

## Decision

### One cover per product and per variant

- The published menu gains `imageFileId`: the product's first picture (lowest `sortOrder`) as its
  cover, and on each variant that variant's own first picture, or `null` (screens then show the
  product's cover).
- The same domain function (`resolveLocationMenu`) computes it in the cloud and on the hub. The
  catalog's `images` are optional, so callers without pictures are unchanged.
- The remaining pictures stay in the catalog for later uses, such as a website gallery.

### Upload in the admin

- `POST /tenants/:tid/products/images` takes the image bytes and requires `products.update`.
  Whoever edits products may add pictures; branding files keep requiring `settings.manage`.
- The same checks as every tenant file apply:
  - PNG, JPEG or WebP only, verified by their bytes;
  - at most 2 MB;
  - stored in the tenant's folder.
- A picture is attached by listing its id in the product's (or a variant's) `imageFileIds`; the
  existing rule refuses another tenant's files.
- The admin's product editor uploads pictures and reorders them; the first is the cover, shown
  with a "Cover" badge. Removing a picture only detaches it.
- Pictures are made smaller in the browser before upload: at most 1200 px on the longest side,
  re-encoded as WebP (JPEG where WebP encoding is unavailable). The original is kept when it is
  already smaller.

### Pictures reach the hub without riding the snapshot

- The snapshot (format 8) carries `productImages`: the cover rows only, for each product and
  variant.
- Their `tenantFiles` rows travel too, but **without bytes**. `files` still carries only the
  branding files, as before. So a menu edit resends rows, not pictures.
- After applying a snapshot, the hub fetches each cover it lacks from `GET /sync/files/:fileId`.
  This route needs the device credential, and serves only pictures that a product of the hub's
  tenant shows.
- The hub checks every download against the row's SHA-256, size and image type before storing it.
  A failed or rejected download is retried after the next snapshot, including a `304 Not Modified`
  one.
- Screens refresh their menu (`menu.updated`) once new pictures arrive.
- A trigger on `product_images` records a `CONFIG` change, so changing only a product's pictures
  reaches the hubs like any other edit.

### Serving

- **POS and kiosk:** the hub serves `GET /hub/media/:fileId` publicly on the location network,
  like its branding files. It serves only pictures of the hub's products, and only once the bytes
  are there.
- **Website:** `GET /public/site/files/:fileId` also serves product pictures of the host's
  tenant, and nothing another tenant uploaded.
- **Admin:** reads through the signed-in file route, as before.

### Screens

- **Everywhere:** pictures are decorative. The name is always written, so `alt` is empty. A
  picture that cannot load disappears and leaves the text tile.
- **POS:** a picture at the top of each tile. A per-till setting, "Show product pictures" (on by
  default), gives a fast text-only grid.
- **Kiosk:** large picture cards. The item dialog shows the chosen variant's picture (a colour,
  say) or the product's cover.
- **Website:** a thumbnail on menu cards, a picture on featured products, and a banner in the
  product dialog.

## Consequences

- Product pictures work offline on the POS and the kiosk, at the cost of a one-time download per
  picture per hub.
- Only covers reach the hub. Showing more pictures offline would mean adding their rows to the
  snapshot; the download path is already there.
- The admin has no picture picker per variant yet. Variant pictures are set through the API, for
  example from an import, and every screen already shows them.
- A picture a hub has not fetched yet shows as a text tile until it arrives.
