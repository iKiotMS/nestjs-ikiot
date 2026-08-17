// `jose` is ESM-only and reached only through firebase-admin → jwks-rsa, i.e. only when
// verifying a real Google ID token — which no e2e test does. The e2e run needs
// --experimental-vm-modules for Prisma 7's WASM query compiler, and under that flag the
// CJS `require('jose')` inside jwks-rsa throws. Stubbing it here keeps the whole ESM
// interop problem out of the test setup; delete this the day an e2e test actually
// exercises /auth/firebase-login (it would need a mocked Google JWKS endpoint anyway).
module.exports = new Proxy(
  {},
  {
    get() {
      throw new Error('jose is stubbed in e2e tests (see test/jose.stub.js)');
    },
  },
);
