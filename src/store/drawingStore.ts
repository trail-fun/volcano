import { create } from 'zustand'
import type { LatLng } from '../types/race'

type DrawingStore = {
  routeType: 'escape' | 'road_access' | null
  points: LatLng[]
  startDrawing: (type: 'escape' | 'road_access') => void
  addPoint: (p: LatLng) => void
  removeLastPoint: () => void
  clearDrawing: () => void
}

export const useDrawingStore = create<DrawingStore>(set => ({
  routeType: null,
  points: [],
  startDrawing: type => set({ routeType: type, points: [] }),
  addPoint: p => set(s => ({ points: [...s.points, p] })),
  removeLastPoint: () => set(s => ({ points: s.points.slice(0, -1) })),
  clearDrawing: () => set({ routeType: null, points: [] }),
}))
