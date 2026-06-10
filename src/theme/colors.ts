export const colors = {
  primary: '#7C3AED',
  primaryDark: '#5B21B6',
  primaryLight: '#EDE9FE',
  primaryXLight: '#F5F3FF',
  background: '#FFFFFF',
  surface: '#F8F7FF',
  text: '#1F2937',
  textSecondary: '#6B7280',
  textLight: '#9CA3AF',
  success: '#10B981',
  successLight: '#D1FAE5',
  error: '#EF4444',
  errorLight: '#FEE2E2',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  gold: '#F59E0B',
  silver: '#9CA3AF',
  bronze: '#B87333',
  cyan: '#06B6D4',
  border: '#E5E7EB',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const getTierInfo = (score: number) => {
  if (score < 30) return { tier: 'Risky', emoji: '⚠️', color: colors.error, description: 'People avoid lending' };
  if (score < 50) return { tier: 'Unproven', emoji: '🔄', color: colors.warning, description: 'New or inconsistent' };
  if (score < 70) return { tier: 'Reliable', emoji: '👍', color: colors.primary, description: 'Building trust. Consistent repayments unlock higher limits.' };
  if (score < 85) return { tier: 'Trusted', emoji: '⭐', color: colors.success, description: 'Strong reputation in your circle' };
  return { tier: 'Elite', emoji: '🏆', color: colors.gold, description: 'Top user — the circle trusts you completely' };
};

export const getTierPercentile = (score: number) => {
  if (score < 30) return 'Bottom 30%';
  if (score < 50) return 'Top 70%';
  if (score < 70) return 'Top 100%';
  if (score < 85) return 'Top 30%';
  return 'Top 5%';
};
