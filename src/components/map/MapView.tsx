import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useRaceStore } from '../../store/raceStore'
import { useModeStore } from '../../store/modeStore'
import { useCasualtyStore } from '../../store/casualtyStore'
import { useDrawingStore } from '../../store/drawingStore'
import { calcCandidates } from '../../hooks/useRouteCalc'
import { POINT_ICONS, ROUTE_STYLES, TERRAIN_STYLES, CANDIDATE_COLORS } from './mapStyles'
import type { Segment, LatLngEle } from '../../types/race'

// コースを terrain 種別ごとのランに分割
function getTerrainRuns(coords: LatLngEle[], segments: Segment[]) {
  if (segments.length === 0) return [{ terrain: 'trail' as const, coords }]
  const map: ('trail' | 'road')[] = new Array(coords.length).fill('trail')
  for (const seg of segments) {
    for (let i = seg.startIndex; i <= Math.min(seg.endIndex, coords.length - 1); i++) map[i] = seg.terrain
  }
  const runs: { terrain: 'trail' | 'road'; coords: LatLngEle[] }[] = []
  let cur = map[0], curCoords: LatLngEle[] = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    if (map[i] === cur) { curCoords.push(coords[i]) }
    else { runs.push({ terrain: cur, coords: curCoords }); cur = map[i]; curCoords = [coords[i - 1], coords[i]] }
  }
  runs.push({ terrain: cur, coords: curCoords })
  return runs
}

// 候補範囲内のトレイル区間のみ座標配列として返す
function getTrailSlices(coords: LatLngEle[], segments: Segment[], lo: number, hi: number): LatLngEle[][] {
  if (segments.length === 0) {
    const s = coords.slice(lo, hi + 1)
    return s.length >= 2 ? [s] : []
  }
  const map: ('trail' | 'road')[] = new Array(coords.length).fill('trail')
  for (const seg of segments) {
    for (let i = seg.startIndex; i <= Math.min(seg.endIndex, coords.length - 1); i++) map[i] = seg.terrain
  }
  const result: LatLngEle[][] = []
  let cur: LatLngEle[] = []
  for (let i = lo; i <= hi; i++) {
    if (map[i] === 'trail') { cur.push(coords[i]) }
    else { if (cur.length >= 2) result.push([...cur]); cur = [] }
  }
  if (cur.length >= 2) result.push(cur)
  return result
}

const GSI_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'

export default function MapView({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const layersRef = useRef<L.Layer[]>([])
  const casualtyMarkerRef = useRef<L.Marker | null>(null)
  const candidateLayersRef = useRef<L.Layer[]>([])
  const prevCourseIdRef = useRef<string | null>(null)

  const { routes, points } = useRaceStore()
  const { mode, activeTool } = useModeStore()
  const { position, selectedCandidateId, setPosition, candidates } = useCasualtyStore()
  const { routeType: drawingRouteType, points: drawingPoints, addPoint: addDrawingPoint } = useDrawingStore()
  const drawingLayersRef = useRef<L.Layer[]>([])

  // 地図初期化
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true }).setView([35.7, 137.5], 10)
    L.tileLayer(GSI_URL, { attribution: '©国土地理院', maxZoom: 18 }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // 地図クリック
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = (e: L.LeafletMouseEvent) => {
      if (mode === 'operation') {
        const { lat, lng } = e.latlng
        const newCandidates = calcCandidates({ lat, lng }, routes, points)
        setPosition({ lat, lng }, newCandidates)
      } else if (activeTool === 'add_point' || activeTool === 'set_segment') {
        onMapClick?.(e.latlng.lat, e.latlng.lng)
      } else if (activeTool === 'draw_route') {
        addDrawingPoint({ lat: e.latlng.lat, lng: e.latlng.lng })
      }
    }
    map.on('click', handler)
    return () => { map.off('click', handler) }
  }, [mode, activeTool, routes, points, onMapClick, setPosition])

  // メインコース読み込み時にfitBounds
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const courseRoute = routes.find(r => r.type === 'course')
    if (!courseRoute || courseRoute.coords.length < 2) return
    if (courseRoute.id === prevCourseIdRef.current) return
    prevCourseIdRef.current = courseRoute.id
    const bounds = L.latLngBounds(courseRoute.coords.map(c => [c.lat, c.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [20, 20] })
  }, [routes])

  // ルート・ポイント描画
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current.forEach(l => l.remove())
    layersRef.current = []

    for (const route of routes) {
      if (route.coords.length < 2) continue

      if (route.type === 'course') {
        // トレイル/ロードで色分け
        for (const run of getTerrainRuns(route.coords, route.segments)) {
          const line = L.polyline(run.coords.map(c => [c.lat, c.lng] as [number, number]), TERRAIN_STYLES[run.terrain]).addTo(map)
          line.bindTooltip(`${route.name}（${run.terrain === 'trail' ? 'トレイル' : 'ロード'}）`, { sticky: true })
          layersRef.current.push(line)
        }
      } else {
        const latlngs = route.coords.map(c => [c.lat, c.lng] as [number, number])
        const style = ROUTE_STYLES[route.type]
        const line = L.polyline(latlngs, style).addTo(map)
        line.bindTooltip(route.name, { sticky: true })
        layersRef.current.push(line)

        if (route.junction) {
          const m = L.circleMarker([route.junction.lat, route.junction.lng], {
            radius: 6, color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 1, weight: 2,
          }).addTo(map)
          m.bindTooltip(`分岐: ${route.name}`)
          layersRef.current.push(m)
        }
      }
    }

    for (const pt of points) {
      const icon = L.divIcon({
        html: `<div style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));${!pt.enabled ? 'opacity:0.35' : ''}">${POINT_ICONS[pt.type]}</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], className: '',
      })
      const marker = L.marker([pt.lat, pt.lng], { icon }).addTo(map)
      marker.bindPopup(`<b>${pt.name}</b><br><span style="font-size:11px">${pt.note || ''}</span>`)
      layersRef.current.push(marker)
    }
  }, [routes, points])

  // 傷病者マーカー
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    casualtyMarkerRef.current?.remove()
    if (!position) { casualtyMarkerRef.current = null; return }
    const icon = L.divIcon({
      html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))">🚨</div>',
      iconSize: [32, 32], iconAnchor: [16, 16], className: '',
    })
    const m = L.marker([position.lat, position.lng], { icon, zIndexOffset: 1000 }).addTo(map)
    m.bindPopup('傷病者位置').openPopup()
    casualtyMarkerRef.current = m
  }, [position])

  // 全候補ライン（色分け・選択中は太く前面）
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    candidateLayersRef.current.forEach(l => l.remove())
    candidateLayersRef.current = []
    if (!position || candidates.length === 0) return

    // 非選択を先に描画し、選択中を最後（前面）に
    const ordered = [
      ...candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.id !== selectedCandidateId),
      ...candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.id === selectedCandidateId),
    ]

    for (const { c, i } of ordered) {
      const isSelected = c.id === selectedCandidateId
      const color = CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]
      for (const seg of c.segments) {
        const route = routes.find(r => r.id === seg.routeId)
        if (!route) continue
        const lo = Math.min(seg.fromIndex, seg.toIndex)
        const hi = Math.max(seg.fromIndex, seg.toIndex)
        // トレイル区間のみ表示
        const slices = getTrailSlices(route.coords, route.segments, lo, hi)
        for (const slice of slices) {
          const line = L.polyline(slice.map(c => [c.lat, c.lng] as [number, number]), {
            color, weight: isSelected ? 7 : 4, opacity: isSelected ? 1.0 : 0.55,
          }).addTo(map)
          candidateLayersRef.current.push(line)
        }
      }
    }
  }, [candidates, selectedCandidateId, routes, position])

  // 手描きプレビュー
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    drawingLayersRef.current.forEach(l => l.remove())
    drawingLayersRef.current = []
    if (drawingPoints.length === 0) return
    const color = drawingRouteType === 'escape' ? '#2563eb' : '#6b7280'
    if (drawingPoints.length >= 2) {
      const line = L.polyline(drawingPoints.map(p => [p.lat, p.lng] as [number, number]), {
        color, weight: 3, opacity: 0.8, dashArray: '8,5',
      }).addTo(map)
      drawingLayersRef.current.push(line)
    }
    drawingPoints.forEach((p, i) => {
      const isLast = i === drawingPoints.length - 1
      const m = L.circleMarker([p.lat, p.lng], {
        radius: isLast ? 7 : 4, color, fillColor: isLast ? color : '#fff',
        fillOpacity: 1, weight: 2,
      }).addTo(map)
      drawingLayersRef.current.push(m)
    })
  }, [drawingPoints, drawingRouteType])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
}
