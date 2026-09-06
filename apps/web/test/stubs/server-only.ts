// Test-only stand-in for the real "server-only" package, which unconditionally throws when
// executed outside Next's bundler (it relies on Next stripping it from server bundles at build
// time — Vitest just runs the module directly in Node, so the real package would break every
// import of server-only code under test). Aliased in vitest.config.ts.
export {};
