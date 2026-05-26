import { create } from 'zustand'
import { parseGpx } from '../utils/gpxParser'
import { importZip, exportZip } from '../utils/zipHandler'
import type { Race, Route, Point, Segment, Junction } from '../types/race'

type RaceStore = {
  race: Race | null
  routes: Route[]
  points: Point[]

  setRace: (r: Race) => void
  loadFromGpx: (file: File) => Promise<void>
  loadFromZip: (file: File) => Promise<void>
  exportToZip: () => Promise<void>

  addRoute: (route: Route) => void
  updateRoute: (id: string, patch: Partial<Route>) => void
  deleteRoute: (id: string) => void
  setSegments: (routeId: string, segments: Segment[]) => void
  setJunction: (routeId: string, junction: Junction) => void

  addPoint: (point: Point) => void
  updatePoint: (id: string, patch: Partial<Point>) => void
  deletePoint: (id: string) => void
  togglePoint: (id: string) => void
}

export const useRaceStore = create<RaceStore>((set, get) => ({
  race: null,
  routes: [],
  points: [],

  setRace: r => set({ race: r }),

  loadFromGpx: async (file) => {
    const text = await file.text()
    const coords = parseGpx(text)
    const id = crypto.randomUUID()
    const race: Race = { id, name: file.name.replace(/\.gpx$/i, ''), date: '', description: '' }
    const route: Route = {
      id: 'r_main', name: 'メインコース', type: 'course',
      gpxFile: 'course_main.gpx', coords,
      difficulty: 'medium', transportSuitability: ['walk', 'stretcher'],
      segments: [], junction: null,
    }
    set({ race, routes: [route], points: [] })
  },

  loadFromZip: async (file) => {
    const data = await importZip(file)
    set({ race: data.race, routes: data.routes, points: data.points })
  },

  exportToZip: async () => {
    const { race, routes, points } = get()
    if (!race) return
    await exportZip(race, routes, points)
  },

  addRoute: route => set(s => ({ routes: [...s.routes, route] })),
  updateRoute: (id, patch) => set(s => ({ routes: s.routes.map(r => r.id === id ? { ...r, ...patch } : r) })),
  deleteRoute: id => set(s => ({ routes: s.routes.filter(r => r.id !== id) })),
  setSegments: (routeId, segments) => set(s => ({
    routes: s.routes.map(r => r.id === routeId ? { ...r, segments } : r),
  })),
  setJunction: (routeId, junction) => set(s => ({
    routes: s.routes.map(r => r.id === routeId ? { ...r, junction } : r),
  })),

  addPoint: point => set(s => ({ points: [...s.points, point] })),
  updatePoint: (id, patch) => set(s => ({ points: s.points.map(p => p.id === id ? { ...p, ...patch } : p) })),
  deletePoint: id => set(s => ({ points: s.points.filter(p => p.id !== id) })),
  togglePoint: id => set(s => ({
    points: s.points.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p),
  })),
}))
