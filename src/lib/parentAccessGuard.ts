import { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';

export async function navigateToParentDash(
  navigation: NavigationProp<RootStackParamList>,
  userId: string | null,
): Promise<void> {
  if (!userId) {
    navigation.navigate('ParentEmailLogin');
    return;
  }

  navigation.navigate('ParentTabs');
}
