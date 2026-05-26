import type { Transport, Difficulty } from './race'

export type CandidateSegment = {
  routeId: string
  direction: 'forward' | 'backward'
  fromIndex: number
  toIndex: number
}

export type RouteCandidate = {
  id: string
  label: string
  exitPointId: string
  exitPointName: string
  exitPointType: 'exit' | 'helipad'
  segments: CandidateSegment[]
  totalDistanceM: number
  totalDescentM: number
  totalAscentM: number
  difficulty: Difficulty
  transportSuitability: Transport[]
}
