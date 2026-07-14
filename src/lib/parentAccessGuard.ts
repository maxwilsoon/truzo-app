import { db } from './database';

/**
 * Central Parent Dashboard access guard.
 *
 * Fetches the parent's live Safety Pool status from Supabase and either
 * navigates to ParentTabs (pool funded) or redirects to SafetyPool setup
 * (pool at £0 — first-time or depleted).
 *
 * Call this instead of navigation.navigate('ParentTabs') at every entry
 * point so the check is always enforced, regardless of route.
 */
export async function navigateToParentDash(
  navigation: { navigate: (screen: string, params?: any) => void },
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
