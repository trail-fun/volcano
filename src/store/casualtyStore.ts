import { create } from 'zustand'
import type { LatLng } from '../types/race'
import type { RouteCandidate } from '../types/candidate'

type CasualtyStore = {
  position: LatLng | null
  candidates: RouteCandidate[]
  selectedCandidateId: string | null
  isCalculating: boolean

  setPosition: (pos: LatLng, candidates: RouteCandidate[]) => void
  selectCandidate: (id: string | null) => void
  clearCasualty: () => void
}

export const useCasualtyStore = create<CasualtyStore>(set => ({
  position: null,
  candidates: [],
  selectedCandidateId: null,
  isCalculating: false,

  setPosition: (position, candidates) => set({ position, candidates, selectedCandidateId: null }),
  selectCandidate: id => set({ selectedCandidateId: id }),
  clearCasualty: () => set({ position: null, candidates: [], selectedCandidateId: null }),
}))
