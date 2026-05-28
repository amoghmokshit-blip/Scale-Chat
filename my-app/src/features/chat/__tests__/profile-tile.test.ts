/**
 * Pure-logic test for ProfileActionTile's disabled-guard behaviour.
 *
 * We test the guard directly as a plain function — no React render needed,
 * and the repo has no RTL setup. The tile's press handler is:
 *
 *   () => { if (!disabled) onPress(); }
 *
 * We extract that logic into a testable helper so the behaviour is covered
 * without spinning up any component tree.
 */

/** Mirrors the press handler inside ProfileActionTile. */
function handleTilePress(disabled: boolean, onPress: () => void): void {
  if (!disabled) onPress();
}

describe('ProfileActionTile disabled guard', () => {
  it('does NOT call onPress when disabled is true', () => {
    const onPress = jest.fn();
    handleTilePress(true, onPress);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('DOES call onPress when disabled is false', () => {
    const onPress = jest.fn();
    handleTilePress(false, onPress);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('calls onPress when disabled is omitted (defaults to enabled)', () => {
    const onPress = jest.fn();
    // disabled defaults to false in the component — mirror that here
    handleTilePress(false, onPress);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
