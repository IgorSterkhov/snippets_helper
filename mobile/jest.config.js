module.exports = {
  preset: 'react-native',
  moduleFileExtensions: ['js', 'jsx', 'json'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-.*|@react-native-community|@react-native-firebase)/)',
  ],
};
