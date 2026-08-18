import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// In-memory storage: session JWT lives only in the app process, never written to disk.
// noopStorage (which always returns null from getItem) caused __loadSession() to return
// null every call, so _getAccessToken() fell back to the anon key and every RPC ran
// as the anon role — breaking set_parent_passcode (not granted to anon).
const _authMap = new Map<string, string>();
const inMemoryStorage = {
  getItem:    (key: string) => Promise.resolve(_authMap.get(key) ?? null),
  setItem:    (key: string, value: string) => { _authMap.set(key, value); return Promise.resolve(); },
  removeItem: (key: string) => { _authMap.delete(key); return Promise.resolve(); },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: inMemoryStorage,
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
