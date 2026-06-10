# Truzo

A peer-to-peer lending app for teens, backed by a parent safety pool. Teens build a trust score by borrowing from friends and repaying on time. Parents maintain oversight and fund a safety net that covers every loan.

## What it does

- **Kids** request money from their friend circle, fund each other's requests, repay on time to climb the trust score tiers (Risky → Unproven → Reliable → Trusted → Elite), and earn rewards points redeemable for gift cards.
- **Parents** top up a safety pool, set a weekly allowance, send money directly to their child's wallet, and monitor all activity. If a child misses a repayment, the parent's safety pool covers it and the child's account is frozen until they repay.
- **Trust score** drives everything — limits, leaderboard rank, and unlock of higher-value requests are all tied to repayment history.

## Tech stack

- [Expo](https://expo.dev) SDK 54 (managed workflow)
- React Native 0.81.5
- TypeScript
- React Navigation (native stack + bottom tabs)
- `expo-linear-gradient`, `react-native-svg`, `@expo/vector-icons` (Ionicons)
- All state in a single React Context — no backend, no persistence

## Getting started

```bash
npm install
npm start        # opens Expo dev server — scan QR with Expo Go
npm run ios      # iOS Simulator
npm run android  # Android emulator
```

Requires [Node.js](https://nodejs.org) and the [Expo Go](https://expo.dev/go) app on your device, or a configured iOS/Android emulator.

## App structure

```
src/
  context/        # AppContext — all global state (child, parent, circle, transactions)
  navigation/     # Root stack + ChildTabNavigator + ParentTabNavigator
  screens/
    onboarding/   # Carousel, Email, Password, Mobile, Address, Identity…
    auth/         # WhoIsLoggingIn, ParentPasscode, ChildLogin
    child/        # Home, Circle, Wallet, Profile, TrustStats, RequestMoney…
    parent/       # ParentHome, ParentAccount, PaymentMethods, AccountDetails
    shared/       # RateTruzo
  components/     # ConfirmSheet, MoneySheet, PaymentSheet, TrustScoreRing…
  theme/          # colors.ts — colour palette + getTierInfo()
```

## User flows

**New parent signup:** Carousel → Email → Password → Mobile → Home address → Display name → Identity → Address → Verifying → Child details → Parent dashboard

**Returning login:** Who's logging in → Parent passcode → Parent dashboard (or child PIN → Child dashboard)
