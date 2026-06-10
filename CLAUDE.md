# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm start          # start Expo dev server (scan QR with Expo Go)
npm run ios        # open in iOS Simulator
npm run android    # open in Android emulator
npm run web        # open in browser
```

There is no test runner and no lint script configured.

## Architecture

**Entry point:** `App.tsx` wraps the app in `SafeAreaProvider` → `AppProvider` → `AppNavigator`.

**State:** All global state lives in a single React Context at `src/context/AppContext.tsx`. No external state library. Two primary profiles exist: `child: ChildProfile` and `parent: ParentProfile`, both default-initialised with placeholder data — the app has no backend and no persistence between sessions.

Key context types:
- `ActivityItem` uses `emoji: string` (not `icon`) — all `addActivity()` calls must pass an `emoji` field
- `getTierInfo(score)` in `src/theme/colors.ts` returns `{ tier, emoji, color, description }` — use `.emoji` not `.icon`

**Navigation:** Single root `NativeStackNavigator` in `src/navigation/index.tsx` with `initialRouteName="Carousel"`. The two tab navigators are mounted as regular stack screens:
- `ChildTabs` → `ChildTabNavigator` (Home, Circle, Wallet, Profile)
- `ParentTabs` → `ParentTabNavigator` (Home, Account)

User flows:
- **New parent:** Carousel → Email → Password → Mobile → Notifications → HomeAddress → DisplayName → Identity → Address → Verifying → ChildDetails → ParentTabs
- **Returning:** WhoIsLoggingIn → ParentPasscode → ParentTabs (parent) or ChildLogin → ChildTabs (child)

**Screens** are organised under `src/screens/{onboarding,auth,child,parent,shared}`.

**Theme:** All colours and trust tier logic are in `src/theme/colors.ts`. Use the `colors` object for all colour values.

**Shared components** (`src/components/`):
- `ConfirmSheet` — bottom-sheet confirmation modal; takes `emoji: string` prop
- `MoneySheet` — amount-entry bottom sheet
- `PaymentSheet` — simulates Apple Pay confirmation
- `TrustScoreRing` — SVG ring rendered via `react-native-svg`

## Key constraints

**`expo-linear-gradient` v15** requires the `colors` prop to be a typed tuple `readonly [ColorValue, ColorValue, ...ColorValue[]]`. Passing a runtime-looked-up array (e.g. from a `Record`) causes a type mismatch and runtime crash — use inline literal arrays only.

**No TypeScript strict mode** (`tsconfig.json` extends `expo/tsconfig.base`). The project compiles with `tsc` via Expo's managed workflow — type errors surface at build time via `expo start`.
