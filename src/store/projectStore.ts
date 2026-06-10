import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export type ProjectMeta = {
  id: string
  name: string
  updated_at: string
  is_owner: boolean
}

export type ProjectShare = {
  email: string
}

type ProjectStore = {
  projects: ProjectMeta[]
  saving: boolean
  currentProjectId: string | null
  setCurrentProjectId: (id: string | null) => void
  fetchProjects: () => Promise<void>
  saveProject: (name: string, data: object) => Promise<string | null>
  updateProject: (id: string, name: string, data: object) => Promise<string | null>
  loadProject: (id: string) => Promise<object | null>
  deleteProject: (id: string) => Promise<void>
  getShares: (projectId: string) => Promise<ProjectShare[]>
  addShare: (projectId: string, email: string) => Promise<string | null>
  removeShare: (projectId: string, email: string) => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  saving: false,
  currentProjectId: null,
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  fetchProjects: async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase
      .from('projects')
      .select('id, name, updated_at, user_id')
      .order('updated_at', { ascending: false })
    const projects: ProjectMeta[] = (data ?? []).map(p => ({
      id: p.id,
      name: p.name,
      updated_at: p.updated_at,
      is_owner: p.user_id === user?.id,
    }))
    set({ projects })
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

  getShares: async (projectId) => {
    const { data } = await supabase
      .from('project_shares')
      .select('shared_with_email')
      .eq('project_id', projectId)
      .order('created_at')
    return (data ?? []).map(r => ({ email: r.shared_with_email }))
  },

  addShare: async (projectId, email) => {
    const { error } = await supabase.from('project_shares').insert({
      project_id: projectId,
      shared_with_email: email.trim().toLowerCase(),
    })
    return error ? error.message : null
  },

  removeShare: async (projectId, email) => {
    await supabase.from('project_shares')
      .delete()
      .eq('project_id', projectId)
      .eq('shared_with_email', email)
  },
}))
