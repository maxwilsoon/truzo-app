import { NavigationProp } from '@react-navigation/native';
import { db } from './database';
import type { RootStackParamList } from '../navigation/types';

export async function navigateToParentDash(
  navigation: NavigationProp<RootStackParamList>,
  userId: string | null,
): Promise<void> {
  if (!userId) {
    navigation.navigate('ParentEmailLogin');
    return;
  }

  let poolOk = false;
  try {
    const status = await db.getSafetyPoolStatus(userId);
    const available = (status?.limit ?? 0) - (status?.used ?? 0);
    poolOk = available > 0;
  } catch {
    // Network failure — fail safe: require setup rather than grant access.
    poolOk = false;
  }

  if (!poolOk) {
    navigation.navigate('SafetyPool', { required: true });
    return;
  }

  navigation.navigate('ParentTabs');
}
