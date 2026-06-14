// Ready-made content for the Getting Started walkthrough's "try it" actions
// (jbMerge.openDemo / jbMerge.openDemoDiff). Self-contained so the demos work
// on a fresh install with no git setup: the merge body carries diff3 conflict
// markers that the merge editor reconstructs into base/ours/theirs, and the
// diff is two inline texts. Generated content — edit freely.

/** Sample side-by-side diff: shows modified, inserted, and deleted lines. */
export const DEMO_DIFF = {
  fileName: "checkout.ts",
  leftLabel: "HEAD",
  rightLabel: "Working Tree",
  leftText: "import { Cart, Money, PaymentResult } from \"./types\";\nimport { taxFor } from \"./tax\";\n\nconst FREE_SHIPPING_THRESHOLD = 50_00; // cents\n\nexport async function checkout(cart: Cart): Promise<PaymentResult> {\n  const subtotal = cart.items.reduce((sum, it) => sum + it.price * it.qty, 0);\n  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : 4_99;\n  const tax = taxFor(subtotal, cart.region);\n\n  const total: Money = subtotal + shipping + tax;\n  logger.debug(\"checkout total\", { subtotal, shipping, tax, total });\n\n  return gateway.charge(cart.paymentToken, total);\n}",
  rightText: "import { Cart, Money, PaymentResult } from \"./types\";\nimport { taxFor } from \"./tax\";\nimport { applyCoupon } from \"./coupons\";\n\nconst FREE_SHIPPING_THRESHOLD = 35_00; // cents\n\nexport async function checkout(cart: Cart): Promise<PaymentResult> {\n  const subtotal = cart.items.reduce((sum, it) => sum + it.price * it.qty, 0);\n  const discount = applyCoupon(subtotal, cart.coupon);\n  const discounted = subtotal - discount;\n  const shipping = discounted >= FREE_SHIPPING_THRESHOLD ? 0 : 4_99;\n  const tax = taxFor(discounted, cart.region);\n\n  const total: Money = discounted + shipping + tax;\n\n  return gateway.charge(cart.paymentToken, total);\n}",
} as const;

/** Sample 3-way merge: one true conflict + one auto-resolvable change. */
export const DEMO_MERGE = {
  fileName: "feature-flags.ts",
  body: "import { Flag, FlagRegistry } from \"./registry\";\n\n// Central feature-flag table. Edited concurrently on `main` and the\n// `release/2.5` branch, so a few values diverged during the merge.\n\nexport const RELEASE_CHANNEL = \"stable\";\n\nexport const flags: FlagRegistry = {\n  // Maximum number of conflicts Merge Studio will auto-resolve in one pass.\n<<<<<<< ours\n  autoResolveLimit: 64,\n||||||| base\n  autoResolveLimit: 32,\n=======\n  autoResolveLimit: 128,\n>>>>>>> theirs\n\n  // Debounce window (ms) for the live re-diff in the side-by-side view.\n  reDiffDebounceMs: 200,\n\n  // Retain webview context when the merge tab is hidden.\n  retainContextWhenHidden: true,\n\n  // Experimental: render conflict ribbons on a single full-width SVG stage.\n<<<<<<< ours\n  singleStageRibbons: true,\n||||||| base\n  singleStageRibbons: false,\n=======\n  singleStageRibbons: false,\n>>>>>>> theirs\n\n  // Shell out to a real JetBrains IDE instead of the embedded editor.\n  preferNativeIde: false,\n};\n\nexport function isEnabled(flag: keyof typeof flags): boolean {\n  return Boolean(flags[flag]);\n}",
} as const;
