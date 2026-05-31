import { create } from 'zustand'
import { parseGpx } from '../utils/gpxParser'
import { importZip, exportZip } from '../utils/zipHandler'
import type { Race, Route, Point, Segment, Junction } from '../types/race'

type Snapshot = { race: Race | null; routes: Route[]; points: Point[] }

type RaceStore = {
  race: Race | null
  routes: Route[]
  points: Point[]
  history: Snapshot[]

  setRace: (r: Race) => void
  loadFromGpx: (file: File) => Promise<void>
  loadFromZip: (file: File) => Promise<void>
  exportToZip: () => Promise<void>
  undo: () => void

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

const MAX_HISTORY = 30

function pushSnap(s: RaceStore): Snapshot[] {
  const snap: Snapshot = { race: s.race, routes: s.routes, points: s.points }
  const hist = [...s.history, snap]
  return hist.length > MAX_HISTORY ? hist.slice(hist.length - MAX_HISTORY) : hist
}

export const useRaceStore = create<RaceStore>((set, get) => ({
  race: null,
  routes: [],
  points: [],
  history: [],

  setRace: r => set(s => ({ history: pushSnap(s), race: r })),

  loadFromGpx: async (file) => {
    const text = await file.text()
    const coords = parseGpx(text)
    const id = crypto.randomUUID()
    const race: Race = { id, name: file.name.replace(/\.gpx$/i, ''), date: '', description: '', startTime: '', cpMultipliers: {} }
    const route: Route = {
      id: 'r_main', name: 'メインコース', type: 'course',
      gpxFile: 'course_main.gpx', coords,
      difficulty: 'medium', transportSuitability: ['walk', 'stretcher'],
      segments: coords.length >= 2
        ? [{ startIndex: 0, endIndex: coords.length - 1, name: '', courseTime: '', breakTime: '' }]
        : [],
      junction: null,
    }
    set({ race, routes: [route], points: [], history: [] })
  },

  loadFromZip: async (file) => {
    const data = await importZip(file)
    set({
      race: { ...data.race, startTime: data.race.startTime ?? '', cpMultipliers: data.race.cpMultipliers ?? {} },
      routes: data.routes,
      points: data.points.map((p: Point) => ({ ...p, cp: p.cp ?? false, section: p.section ?? false })),
      history: [],
    })
  },

  exportToZip: async () => {
    const { race, routes, points } = get()
    if (!race) return
    await exportZip(race, routes, points)
  },

  undo: () => set(s => {
    if (s.history.length === 0) return s
    const prev = s.history[s.history.length - 1]
    return { ...prev, history: s.history.slice(0, -1) }
  }),

  addRoute: route => set(s => ({ history: pushSnap(s), routes: [...s.routes, route] })),
  updateRoute: (id, patch) => set(s => ({ history: pushSnap(s), routes: s.routes.map(r => r.id === id ? { ...r, ...patch } : r) })),
  deleteRoute: id => set(s => ({ history: pushSnap(s), routes: s.routes.filter(r => r.id !== id) })),
  setSegments: (routeId, segments) => set(s => ({
    history: pushSnap(s),
    routes: s.routes.map(r => r.id === routeId ? { ...r, segments } : r),
  })),
  setJunction: (routeId, junction) => set(s => ({
    history: pushSnap(s),
    routes: s.routes.map(r => r.id === routeId ? { ...r, junction } : r),
  })),

  addPoint: point => set(s => ({ history: pushSnap(s), points: [...s.points, point] })),
  updatePoint: (id, patch) => set(s => ({ history: pushSnap(s), points: s.points.map(p => p.id === id ? { ...p, ...patch } : p) })),
  deletePoint: id => set(s => ({ history: pushSnap(s), points: s.points.filter(p => p.id !== id) })),
  togglePoint: id => set(s => ({ history: pushSnap(s), points: s.points.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p) })),
}))
