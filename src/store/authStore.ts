import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type AuthStore = {
  user: User | null
  loading: boolean
  isRecovery: boolean
  init: () => void
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<string | null>
  updatePassword: (newPassword: string) => Promise<string | null>
  clearRecovery: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  loading: true,
  isRecovery: false,

  init: () => {
    supabase.auth.getSession().then(({ data }) => {
      set({ user: data.session?.user ?? null, loading: false })
    })
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        set({ user: session?.user ?? null, isRecovery: true, loading: false })
      } else {
        set({ user: session?.user ?? null })
      }
    })
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? error.message : null
  },

  signOut: async () => {
    await supabase.auth.signOut()
  },

  sendPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://trail-fun.github.io/volcano/',
    })
    return error ? error.message : null
  },

  updatePassword: async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return error ? error.message : null
  },

  clearRecovery: () => set({ isRecovery: false }),
}))
