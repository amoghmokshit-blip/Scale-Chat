const { withGradleProperties } = require('@expo/config-plugins');

/**
 * K2 (docs/progress/1-on-1-chat-expansion.md): the RN template's default Gradle
 * JVM heap (2 GB) is tight once @livekit/react-native-webrtc's multi-ABI native
 * libs are packaged. Bump to 4 GB so the (gitignored, CNG-regenerated) Android
 * build doesn't OOM. Set via a config plugin because expo-build-properties has
 * no jvmargs option and `android/gradle.properties` is a build artifact.
 */
module.exports = function withAndroidGradleHeap(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const set = (key, value) => {
      const existing = props.find((p) => p.type === 'property' && p.key === key);
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };
    set('org.gradle.jvmargs', '-Xmx4096m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8');
    return cfg;
  });
};
