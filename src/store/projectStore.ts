import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export type ProjectMeta = {
  id: string
  name: string
  updated_at: string
}

type ProjectStore = {
  projects: ProjectMeta[]
  saving: boolean
  fetchProjects: () => Promise<void>
  saveProject: (name: string, data: object) => Promise<string | null>
  updateProject: (id: string, name: string, data: object) => Promise<string | null>
  loadProject: (id: string) => Promise<object | null>
  deleteProject: (id: string) => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  saving: false,

  fetchProjects: async () => {
    const { data } = await supabase
      .from('projects')
      .select('id, name, updated_at')
      .order('updated_at', { ascending: false })
    set({ projects: data ?? [] })
  },

  saveProject: async (name, data) => {
    set({ saving: true })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { set({ saving: false }); return 'ログインが必要です' }
    const { error } = await supabase.from('projects').insert({
      name, data, user_id: user.id, updated_at: new Date().toISOString(),
    })
    set({ saving: false })
    return error ? error.message : null
  },

  updateProject: async (id, name, data) => {
    set({ saving: true })
    const { error } = await supabase.from('projects')
      .update({ name, data, updated_at: new Date().toISOString() })
      .eq('id', id)
    set({ saving: false })
    return error ? error.message : null
  },

  loadProject: async (id) => {
    const { data, error } = await supabase
      .from('projects')
      .select('data')
      .eq('id', id)
      .single()
    if (error || !data) return null
    return data.data
  },

  deleteProject: async (id) => {
    await supabase.from('projects').delete().eq('id', id)
  },
}))
