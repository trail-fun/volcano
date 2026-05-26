import { create } from 'zustand'

export type Mode = 'edit' | 'operation'
export type EditTool = 'none' | 'add_point' | 'set_segment' | 'set_junction' | 'draw_road_access'

type ModeStore = {
  mode: Mode
  activeTool: EditTool
  setMode: (mode: Mode) => void
  setActiveTool: (tool: EditTool) => void
}

export const useModeStore = create<ModeStore>(set => ({
  mode: 'edit',
  activeTool: 'none',
  setMode: mode => set({ mode, activeTool: 'none' }),
  setActiveTool: activeTool => set({ activeTool }),
}))
