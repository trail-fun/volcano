import { create } from 'zustand'

export type Mode = 'edit' | 'operation'
export type EditTool = 'none' | 'add_point' | 'set_junction' | 'draw_route'

type ModeStore = {
  mode: Mode
  activeTool: EditTool
  viewerOnly: boolean
  setMode: (mode: Mode) => void
  setActiveTool: (tool: EditTool) => void
  setViewerOnly: (v: boolean) => void
}

export const useModeStore = create<ModeStore>(set => ({
  mode: 'edit',
  activeTool: 'none',
  viewerOnly: false,
  setMode: mode => set({ mode, activeTool: 'none' }),
  setActiveTool: activeTool => set({ activeTool }),
  setViewerOnly: viewerOnly => set({ viewerOnly }),
}))
