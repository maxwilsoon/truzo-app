import * as Crypto from 'expo-crypto';

/** Returns a SHA-256 hex hash of `userId:pin`, used for all passcode storage and comparison. */
export async function hashPasscode(userId: string, pin: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    userId + ':' + pin,
  );
}
