// Minimal react-native stub for Jest node environment.
// theme.ts imports Platform from react-native to select font families.
// We only need Platform.select to resolve to a default value.
const Platform = {
  OS: 'android',
  select: (obj) => obj.android ?? obj.default ?? Object.values(obj)[0],
};
module.exports = { Platform };
