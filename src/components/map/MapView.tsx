import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useRaceStore } from '../../store/raceStore'
import { useModeStore } from '../../store/modeStore'
import { useCasualtyStore } from '../../store/casualtyStore'
import { useDrawingStore } from '../../store/drawingStore'
import { useMapStore } from '../../store/mapStore'
import { calcWaterRoute } from '../../hooks/useRouteCalc'
import { POINT_ICONS, ROUTE_STYLES, CANDIDATE_COLORS } from './mapStyles'
import { snapToRoute } from '../../utils/geo'
import type { LatLngEle } from '../../types/race'
import type { HiddenRange } from '../../store/mapStore'

function buildVisibleSegments(coords: LatLngEle[], hidden: HiddenRange[]): [number, number][][] {
  if (hidden.length === 0) return [coords.map(c => [c.lat, c.lng] as [number, number])]
  const isHiddenEdge = (j: number) => hidden.some(r => j >= r.startIndex && j < r.endIndex)
  const segments: [number, number][][] = []
  let cur: [number, number][] = []
  for (let j = 0; j < coords.length - 1; j++) {
    if (!isHiddenEdge(j)) {
      if (cur.length === 0) cur.push([coords[j].lat, coords[j].lng])
      cur.push([coords[j + 1].lat, coords[j + 1].lng])
    } else {
      if (cur.length >= 2) segments.push([...cur])
      cur = []
    }
  }
  if (cur.length >= 2) segments.push(cur)
  return segments
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
  const { position, selectedCandidateId, setPosition, selectCandidate, candidates } = useCasualtyStore()
  const { routeType: drawingRouteType, points: drawingPoints, addPoint: addDrawingPoint } = useDrawingStore()
  const { command, hiddenCourseRanges } = useMapStore()
  const drawingLayersRef = useRef<L.Layer[]>([])
  const vertexLayersRef = useRef<L.Layer[]>([])
  const snapPreviewRef = useRef<L.CircleMarker | L.Marker | null>(null)
  const routesRef = useRef(routes)
  useEffect(() => { routesRef.current = routes }, [routes])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !command) return
    if (command.type === 'fitBounds' && command.latlngs.length >= 2) {
      const bounds = L.latLngBounds(command.latlngs.map(p => [p.lat, p.lng] as [number, number]))
      map.fitBounds(bounds, { padding: [30, 30] })
    } else if (command.type === 'panTo') {
      map.setView([command.latlng.lat, command.latlng.lng], Math.max(map.getZoom(), 15))
    }
  }, [command])

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true }).setView([35.7, 137.5], 10)
    L.tileLayer(GSI_URL, { attribution: '©国土地理院', maxZoom: 18 }).addTo(map)
    // ポイントマーカーをルート線（overlayPane z:400）の上に表示するカスタムペイン
    const pane = map.createPane('pointsPane')
    pane.style.zIndex = '450'
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = (e: L.LeafletMouseEvent) => {
      if (mode === 'operation') {
        const { lat, lng } = e.latlng
        const wr = calcWaterRoute({ lat, lng }, routes, points)
        setPosition({ lat, lng }, wr ? [wr] : [])
        if (wr) selectCandidate(wr.id)
      } else if (activeTool === 'add_point' || activeTool === 'set_junction') {
        onMapClick?.(e.latlng.lat, e.latlng.lng)
      } else if (activeTool === 'draw_route') {
        addDrawingPoint({ lat: e.latlng.lat, lng: e.latlng.lng })
      }
    }
    map.on('click', handler)
    return () => { map.off('click', handler) }
  }, [mode, activeTool, routes, points, onMapClick, setPosition])

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

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current.forEach(l => l.remove())
    layersRef.current = []

    const dimmed = position !== null && candidates.length > 0
    const baseOpacity = dimmed ? 0.2 : 1.0
    const mainRoute = routes.find(r => r.type === 'course')

    for (const route of routes) {
      if (route.coords.length < 2) continue
      const style = { ...ROUTE_STYLES[route.type], opacity: ROUTE_STYLES[route.type].opacity! * baseOpacity }
      const hidden = route.type === 'course' ? hiddenCourseRanges : []
      for (const seg of buildVisibleSegments(route.coords, hidden)) {
        if (seg.length < 2) continue
        const line = L.polyline(seg, style).addTo(map)
        if (!dimmed) line.bindTooltip(route.name, { sticky: true })
        layersRef.current.push(line)
      }

      if (route.type !== 'course' && route.junction) {
        const m = L.circleMarker([route.junction.lat, route.junction.lng], {
          radius: 6, color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: dimmed ? 0.2 : 1, weight: 2,
        }).addTo(map)
        if (!dimmed) m.bindTooltip(`分岐: ${route.name}`)
        layersRef.current.push(m)
      }
    }

    // 地点がhiddenRangeの内側(境界除く)にあるか判定
    const isInHiddenRange = (lat: number, lng: number): boolean => {
      if (hiddenCourseRanges.length === 0 || !mainRoute) return false
      const snap = snapToRoute({ lat, lng }, mainRoute.coords, 200)
      if (!snap) return false
      const ci = snap.ratio >= 0.5
        ? Math.min(snap.segmentIndex + 1, mainRoute.coords.length - 1)
        : snap.segmentIndex
      return hiddenCourseRanges.some(r => ci > r.startIndex && ci < r.endIndex)
    }

    for (const pt of points) {
      if (isInHiddenRange(pt.lat, pt.lng)) continue
      const opacity = !pt.enabled ? 0.35 : dimmed ? 0.3 : 1
      const popupContent = `<b>${pt.name}</b>${
        pt.type === 'location' && (pt.cp || pt.section)
          ? ` <span style="color:#dc2626;font-size:10px">${[pt.cp ? 'CP' : '', pt.section ? 'S' : ''].filter(Boolean).join(' ')}</span>`
          : ''
      }${pt.note ? `<br><span style="font-size:11px;color:#555">${pt.note}</span>` : ''}`
      if (pt.type === 'location') {
        const radius = pt.cp ? 6 : 4
        const m = L.circleMarker([pt.lat, pt.lng], {
          radius, color: '#dc2626', fillColor: 'white', fillOpacity: 1, weight: 2, opacity,
          pane: 'pointsPane',
        }).addTo(map)
        m.bindPopup(popupContent)
        m.on('click', e => { e.originalEvent.stopPropagation(); m.openPopup() })
        layersRef.current.push(m)
      } else {
        const icon = L.divIcon({
          html: `<div style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));opacity:${opacity}">${POINT_ICONS[pt.type]}</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14], className: '',
        })
        const marker = L.marker([pt.lat, pt.lng], { icon, pane: 'pointsPane' }).addTo(map)
        marker.bindPopup(popupContent)
        marker.on('click', e => { e.originalEvent.stopPropagation(); marker.openPopup() })
        layersRef.current.push(marker)
      }
    }
  }, [routes, points, position, candidates, hiddenCourseRanges])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    casualtyMarkerRef.current?.remove()
    if (!position) { casualtyMarkerRef.current = null; return }
    const icon = L.divIcon({
      html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))">🏃</div>',
      iconSize: [32, 32], iconAnchor: [16, 16], className: '',
    })
    const m = L.marker([position.lat, position.lng], { icon, zIndexOffset: 1000 }).addTo(map)
    m.bindPopup('競技者位置').openPopup()
    casualtyMarkerRef.current = m
  }, [position])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    candidateLayersRef.current.forEach(l => l.remove())
    candidateLayersRef.current = []
    if (!position || candidates.length === 0) return

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
        const slice = route.coords.slice(lo, hi + 1)
        if (slice.length < 2) continue
        const line = L.polyline(slice.map(c => [c.lat, c.lng] as [number, number]), {
          color, weight: isSelected ? 7 : 4, opacity: isSelected ? 1.0 : 0.55,
        }).addTo(map)
        candidateLayersRef.current.push(line)
      }
    }
  }, [candidates, selectedCandidateId, routes, position])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    vertexLayersRef.current.forEach(l => l.remove())
    vertexLayersRef.current = []
    if (mode !== 'edit') return

    for (const route of routes) {
      const color = route.type === 'course' ? '#16a34a' : route.type === 'escape' ? '#2563eb' : '#6b7280'
      route.coords.forEach((coord, i) => {
        // メインコースの非表示範囲内の頂点はスキップ
        if (route.type === 'course' && hiddenCourseRanges.some(r => i > r.startIndex && i < r.endIndex)) return
        const icon = L.divIcon({
          html: `<div style="width:8px;height:8px;background:white;border:2px solid ${color};border-radius:50%;cursor:move;"></div>`,
          iconSize: [8, 8], iconAnchor: [4, 4], className: '',
        })
        const m = L.marker([coord.lat, coord.lng], { icon, draggable: true }).addTo(map)
        const routeId = route.id
        m.on('dragend', () => {
          const { lat, lng } = (m as L.Marker).getLatLng()
          const store = useRaceStore.getState()
          const cur = store.routes.find(r => r.id === routeId)
          if (!cur) return
          const oldCoord = cur.coords[i]
          const newCoords = cur.coords.map((c, j) => j === i ? { ...c, lat, lng } : c)
          store.updateRoute(routeId, { coords: newCoords })
          // 頂点に重なっているポイントを一緒に移動（約5m以内）
          const eps = 0.00005
          for (const pt of store.points) {
            if (Math.abs(pt.lat - oldCoord.lat) < eps && Math.abs(pt.lng - oldCoord.lng) < eps) {
              store.updatePoint(pt.id, { lat, lng })
            }
          }
        })
        vertexLayersRef.current.push(m)
      })
    }
  }, [routes, mode, hiddenCourseRanges])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const snapTools = activeTool === 'set_junction'
    const pinTool = activeTool === 'add_point'
    if (!snapTools && !pinTool) {
      snapPreviewRef.current?.remove()
      snapPreviewRef.current = null
      return
    }

    const marker = snapTools
      ? L.circleMarker([0, 0], { radius: 8, color: '#f97316', fillColor: '#fb923c', fillOpacity: 0.9, weight: 3 })
      : L.marker([0, 0], {
          icon: L.divIcon({
            html: '<div style="font-size:20px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));opacity:0.75">📍</div>',
            iconSize: [24, 24], iconAnchor: [12, 24], className: '',
          }),
        })

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (snapTools) {
        const mainRoute = routesRef.current.find(r => r.type === 'course')
        if (!mainRoute) return
        const snap = snapToRoute(e.latlng, mainRoute.coords, 5000)
        if (snap) {
          marker.setLatLng([snap.foot.lat, snap.foot.lng])
          if (!map.hasLayer(marker)) marker.addTo(map)
        } else {
          marker.remove()
        }
      } else {
        marker.setLatLng(e.latlng)
        if (!map.hasLayer(marker)) marker.addTo(map)
      }
    }
    const onMouseOut = () => marker.remove()

    map.on('mousemove', onMouseMove)
    map.on('mouseout', onMouseOut)
    snapPreviewRef.current = marker

    return () => {
      map.off('mousemove', onMouseMove)
      map.off('mouseout', onMouseOut)
      marker.remove()
      snapPreviewRef.current = null
    }
  }, [activeTool])

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
