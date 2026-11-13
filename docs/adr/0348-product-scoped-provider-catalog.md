# ADR 0348: Product-scoped provider catalog for the Iterate fork

- Status: Accepted for implementation
- Date: 2026-11-14
- Deciders: PI-Desktop Iterate fork maintainers
- Related: [ADR 0347](0347-main-owned-iterate-account-integration.md) ·
  [ADR 0012](0012-universal-provider-model-coverage.md) ·
  [04-ux/06-settings-ia](../spec/04-ux/06-settings-ia.md)

## Context

The Iterate fork ships a first-party account flow (ADR 0347) whose recharge,
key creation and model binding all live on the dedicated account page. Upstream
PI-Desktop additionally offers every named endpoint preset, OAuth subscription
sign-in, custom base URLs, the TypeSafe Jev classifier, provider import from
other tools, and plugin-declared API-key services. In this fork those surfaces
compete with the first-party flow and re-expose third-party account sign-up
the product does not support.

Deleting the upstream catalog outright would fork the shared provider types and
break legacy rows, so the fork needs a scope that hides entry points without
removing the machinery that keeps existing connections editable.

## Decision

1. **One scope module, many readers.** `apps/desktop/src/lib/product-scope.ts`
   owns the flags: a preset allowlist (DeepSeek), and switches for OAuth
   subscriptions, custom base URLs, Jev, and provider import. Every surface
   that offers a new model connection reads these flags instead of keeping a
   private list.
2. **Hiding beats deletion.** The shared preset table, OAuth vendor plumbing,
   Jev form, and import workbench stay intact. The add-service chooser offers
   only the scoped presets, no custom-endpoint tile or no-match fallback, and
   the models page hides the Jev card, the import panel, and the subscription
   sign-in path. The settings search index drops keywords for hidden entries
   so search never surfaces a feature the page no longer offers.
3. **Legacy rows stay first-class.** Connections a user already configured —
   including third-party rows from before the scope change — keep working,
   stay in the service list, and remain editable through the full shared
   preset table. Only new entry points are scoped.
4. **Plugin-declared services keep their path.** Providers contributed by
   loaded plugins with the `provider.register` permission are product
   features, not third-party sign-up, and stay in the chooser.

## Consequences

- Re-enabling an entry point is a one-flag change; the chooser, page and
  search index follow together because they read the same module.
- A fresh install can only reach model access through Iterate or DeepSeek,
  which matches the fork's product story; the recharge and onboarding paths
  stay prominent instead of competing with a vendor wall.
- Upstream catalog work still merges cleanly: the shared table keeps gaining
  presets, and the scope filter — not a forked copy — decides visibility.
- Tests pin the scoped contract: the chooser tests assert third-party presets
  never reappear by accident, and the Jev user-path test pins that the add
  path offers no classifier while the dialog's own contract stays covered.
