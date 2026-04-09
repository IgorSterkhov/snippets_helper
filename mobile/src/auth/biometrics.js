import ReactNativeBiometrics from 'react-native-biometrics';

const rnBiometrics = new ReactNativeBiometrics();

export async function isBiometricAvailable() {
  const { available } = await rnBiometrics.isSensorAvailable();
  return available;
}

export async function authenticate(promptMessage = 'Подтвердите вход') {
  const { success } = await rnBiometrics.simplePrompt({ promptMessage });
  return success;
}
