/**
 * Jest config — pure-logic unit tests for the mobile app.
 *
 * Scope of this config is intentionally narrow:
 *   - src/lib/__tests__/             (time, phone helpers)
 *   - src/features/chat/data/__tests__/ (dto-to-message mapper)
 *   - src/features/chat/__tests__/   (copy snapshot)
 *
 * None of these tests touch React Native, expo-modules-core, or any native
 * module. So we sidestep the heavy `jest-expo` preset (which auto-installs
 * RN runtime + native polyfills that re-import raw `.ts` source files from
 * node_modules and break under Jest's default transformer) and go with a
 * minimal `babel-jest` + `babel-preset-expo` setup against the `node`
 * environment. Component-level RN tests, when they land later, should use
 * the `jest-expo/universal` preset with a separate config file.
 *
 * Per `my-app/AGENTS.md`, babel-preset-expo is pinned to the SDK 56 line
 * (matches `expo@~56.0.3` + `react-native@0.85.3`).
 */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    // CSS files (e.g. global.css imported by theme.ts via NativeWind) must be
    // stubbed before the @/ alias expansion so the pattern matches in time.
    '^@/global\\.css$': '<rootDir>/jest-stub-css.js',
    '\\.css$': '<rootDir>/jest-stub-css.js',
    // react-native is an ESM module that cannot be parsed in the node test env.
    // theme.ts imports Platform from it; stub with a minimal shim.
    '^react-native$': '<rootDir>/jest-stub-react-native.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@scalechat/shared$': '<rootDir>/../packages/shared/src/index.ts',
    '^@scalechat/shared/(.*)$': '<rootDir>/../packages/shared/src/$1',
  },
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': [
      'babel-jest',
      {
        presets: [
          ['babel-preset-expo', { jsxRuntime: 'automatic' }],
        ],
      },
    ],
  },
  // Mocks for native-only modules transitively imported by our test targets.
  // Pure helpers under test don't actually need these, but TS imports of
  // `@/lib/mmkv` from sibling modules can leak in via type-only chains.
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
