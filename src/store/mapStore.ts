import { create } from 'zustand'
import type { LatLng } from '../types/race'

type MapCommand =
  | { seq: number; type: 'fitBounds'; latlngs: LatLng[] }
  | { seq: number; type: 'panTo'; latlng: LatLng }

export type HiddenRange = { startIndex: number; endIndex: number }

type MapStore = {
  command: MapCommand | null
  fitBounds: (latlngs: LatLng[]) => void
  panTo: (latlng: LatLng) => void
  hiddenCourseRanges: HiddenRange[]
  setHiddenCourseRanges: (ranges: HiddenRange[]) => void
}

let seq = 0

export const useMapStore = create<MapStore>(set => ({
  command: null,
  fitBounds: (latlngs) => set({ command: { seq: ++seq, type: 'fitBounds', latlngs } }),
  panTo: (latlng) => set({ command: { seq: ++seq, type: 'panTo', latlng } }),
  hiddenCourseRanges: [],
  setHiddenCourseRanges: (ranges) => set({ hiddenCourseRanges: ranges }),
}))
