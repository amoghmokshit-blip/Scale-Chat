/**
 * Global Jest setup — intentionally empty.
 *
 * Our current unit tests (format-time, phone, dto-to-message, copy snapshot)
 * are pure-logic and do not import RN runtime / native modules / MMKV. If a
 * future test pulls one of those in, add a `jest.mock(...)` here rather than
 * scattering mocks across individual test files.
 */
export {};
