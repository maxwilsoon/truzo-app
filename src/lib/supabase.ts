import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://biilrksornvoqtalftty.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_WFy3MKZimL3OcD35Tn6QBQ_jxzMaUCw';

// No-op storage — sessions are in-memory only; we manage our own persistence via cache.ts
const noopStorage = {
  getItem:    (_key: string) => Promise.resolve<string | null>(null),
  setItem:    (_key: string, _value: string) => Promise.resolve(),
  removeItem: (_key: string) => Promise.resolve(),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: noopStorage,
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
