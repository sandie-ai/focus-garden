// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  runtimeConfig: {
    supabaseToken: process.env.SUPABASE_TOKEN || 'sbp_2feae4f3fd6ed28f6777be024857d03a2cb45e8a',
    supabaseProjectRef: process.env.SUPABASE_PROJECT_REF || '',
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseToken: process.env.NUXT_PUBLIC_SUPABASE_TOKEN || process.env.SUPABASE_TOKEN || 'sbp_2feae4f3fd6ed28f6777be024857d03a2cb45e8a',
    },
  },
})
