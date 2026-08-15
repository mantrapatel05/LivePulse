import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollTo — ChatDock/ControlRoom call it to keep the
// feed pinned to the latest message, which is harmless to no-op in tests.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
