# RetailOS White Label SaaS PWA

Production-style demo for a mobile-first, multi-tenant retail management and repair shop platform.

## Run The Shop App

```bash
node server.cjs 4174
```

Open `http://127.0.0.1:4174`.

## Run The Platform Admin

```bash
node platform-server.cjs 4180
```

Open `http://127.0.0.1:4180`.

## Included

- Multi-tenant SaaS structure with isolated tenant data.
- POS-first shop workflow with employee shift sales and assigned repair-ticket panels.
- Print-ready shift stats popup from the POS instead of always-visible shift reporting.
- Counter staff can create repair tickets directly from POS when the platform enables the repair module.
- Business Admin separated behind an Admin entry with modules selected from a back-office dropdown.
- Platform Console separated into its own app entry point and server for future separate CNAME deployment.
- Platform owner can access client POS/Admin through generated client links, manage branding, stop/start subscription status, and enable/disable repair tickets per tenant.
- Role-based access for Business Owner, Manager, Cashier, Technician, Inventory Staff, and platform owner workflows.
- White-label branding settings with logo upload, colors, currency, tax, and receipt footer.
- Offline-first IndexedDB storage and pending sync queue.
- Service worker, manifest, install prompt support, and cached app shell.
- Dashboard, POS, inventory, purchases, customers, repairs, reports, employees, subscriptions, and platform admin modules.
- Price overrides with original price, sold price, discount amount, and reason.
- Receipt print preview and realistic demo data.

## Architecture Notes

All persistence goes through repository/service functions in `app.js`. The UI does not call browser storage directly, so a Firebase adapter can replace the current IndexedDB-backed demo repository later.
