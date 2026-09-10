module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        // react-native-reanimated v4: babel plugin is NOT required.
        // react-native-reanimated v3 users: add 'react-native-reanimated/plugin' here.
    };
};
