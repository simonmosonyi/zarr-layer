import React, { useMemo, useRef, useState, useEffect } from 'react'
import { Box, Flex } from 'theme-ui'
import type { TimeSeriesResult } from '@carbonplan/zarr-layer'
import { useAppStore } from '../lib/store'

const EODC_BLUE = '#169EB0'
const EODC_GREY = '#737B8D'
const EODC_DARK_GREY = '#45505D'
const EODC_LIGHT_BLUE = '#BAE3FA'

type Props = {
  result: TimeSeriesResult
  currentIndex?: number
  formatX?: (index: number) => string
  aggregate?: 'none' | 'monthly' | 'yearly'
  height?: number
}

const MARGIN = { top: 8, right: 8, bottom: 24, left: 46 }

function fmtY(v: number) {
  return Math.abs(v) >= 1000
    ? v.toExponential(1)
    : v.toPrecision(3).replace(/\.?0+$/, '')
}

// Group raw series into period means using the formatX date strings ("YYYY-MM-DD …")
// keyLen=7 for monthly ("YYYY-MM"), keyLen=4 for yearly ("YYYY")
function computeGroupMeans(
  values: number[],
  timeIndices: number[],
  formatX: (i: number) => string,
  keyLen: number
): { labels: string[]; means: number[]; representativeIndices: number[] } {
  const buckets = new Map<
    string,
    { sum: number; count: number; firstIdx: number }
  >()

  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    const dateStr = formatX(timeIndices[i])
    const key = dateStr.slice(0, keyLen)
    const existing = buckets.get(key)
    if (existing) {
      existing.sum += v
      existing.count++
    } else {
      buckets.set(key, { sum: v, count: 1, firstIdx: timeIndices[i] })
    }
  }

  const sorted = Array.from(buckets.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  )
  return {
    labels: sorted.map(([k]) => k),
    means: sorted.map(([, b]) => b.sum / b.count),
    representativeIndices: sorted.map(([, b]) => b.firstIdx),
  }
}

type TooltipState = {
  x: number
  y: number
  label: string
  value: number
} | null

export const TimeSeriesChart: React.FC<Props> = ({
  result,
  currentIndex,
  formatX,
  aggregate = 'none',
  height = 160,
}) => {
  const { values, timeIndices } = result

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(260)
  const [tooltip, setTooltip] = useState<TooltipState>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const aggregated = useMemo(() => {
    if (aggregate === 'none' || !formatX) return null
    const keyLen = aggregate === 'yearly' ? 4 : 7
    return computeGroupMeans(values, timeIndices, formatX, keyLen)
  }, [aggregate, values, timeIndices, formatX])

  // Use aggregated series or raw series
  const displayValues = aggregated ? aggregated.means : values
  const displayIndices = aggregated
    ? aggregated.representativeIndices
    : timeIndices

  const { yMin, yMax, validCount } = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    let count = 0
    for (const v of displayValues) {
      if (Number.isFinite(v)) {
        if (v < min) min = v
        if (v > max) max = v
        count++
      }
    }
    return { yMin: min, yMax: max, validCount: count }
  }, [displayValues])

  if (validCount === 0) return null

  const innerW = Math.max(containerWidth - MARGIN.left - MARGIN.right, 1)
  const innerH = height - MARGIN.top - MARGIN.bottom
  const yRange = yMax - yMin || 1
  const xCount = displayValues.length

  const xScale = (i: number) => (i / Math.max(xCount - 1, 1)) * innerW
  const yScale = (v: number) => innerH - ((v - yMin) / yRange) * innerH

  const pathD = displayValues.reduce((acc, v, i) => {
    if (!Number.isFinite(v)) return acc
    const x = xScale(i).toFixed(1)
    const y = yScale(v).toFixed(1)
    return acc + (acc === '' ? `M${x},${y}` : `L${x},${y}`)
  }, '')

  const yTicks = [yMin, yMin + yRange / 2, yMax]

  // X axis: start / mid / end labels
  const xLabels: { i: number; label: string }[] = []
  if (displayIndices.length > 0) {
    const getLabel = (rawIdx: number, displayPos: number) => {
      if (aggregated) return aggregated.labels[displayPos]
      return formatX ? formatX(rawIdx) : String(rawIdx)
    }
    const candidateIs = [0, Math.floor((xCount - 1) / 2), xCount - 1]
    const seen = new Set<number>()
    for (const ci of candidateIs) {
      if (seen.has(ci)) continue
      seen.add(ci)
      xLabels.push({ i: ci, label: getLabel(displayIndices[ci], ci) })
    }
  }

  // Current time marker (only meaningful in raw mode)
  let markerX: number | null = null
  if (!aggregated && currentIndex !== undefined) {
    const pos = displayIndices.indexOf(currentIndex)
    if (pos >= 0) markerX = xScale(pos)
  }

  const svgW = innerW + MARGIN.left + MARGIN.right

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (xCount === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = (e.clientX - rect.left) * (svgW / rect.width) - MARGIN.left
    if (svgX < 0 || svgX > innerW) {
      setTooltip(null)
      return
    }
    let pos = Math.round(
      Math.max(0, Math.min(xCount - 1, (svgX / innerW) * (xCount - 1)))
    )
    if (!Number.isFinite(displayValues[pos])) {
      let lo = pos - 1,
        hi = pos + 1
      while (lo >= 0 || hi < xCount) {
        if (lo >= 0 && Number.isFinite(displayValues[lo])) {
          pos = lo
          break
        }
        if (hi < xCount && Number.isFinite(displayValues[hi])) {
          pos = hi
          break
        }
        lo--
        hi++
      }
    }
    if (!Number.isFinite(displayValues[pos])) {
      setTooltip(null)
      return
    }
    const value = displayValues[pos]
    const label = aggregated
      ? aggregated.labels[pos]
      : formatX
      ? formatX(displayIndices[pos])
      : String(displayIndices[pos])
    setTooltip({ x: xScale(pos), y: yScale(value), label, value })
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        mt: 2,
        width: '100%',
        borderLeft: '2px solid',
        borderColor: EODC_DARK_GREY,
        pl: 1,
      }}
    >
      <svg
        viewBox={`0 0 ${svgW} ${height}`}
        width={svgW}
        height={height}
        style={{ display: 'block', overflow: 'visible', width: '100%' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Y grid + labels */}
          {yTicks.map((v, ti) => {
            const y = yScale(v)
            return (
              <g key={ti}>
                <line
                  x1={0}
                  y1={y}
                  x2={innerW}
                  y2={y}
                  stroke={EODC_DARK_GREY}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
                <text
                  x={-4}
                  y={y}
                  textAnchor='end'
                  dominantBaseline='middle'
                  fontSize={9}
                  fill={EODC_GREY}
                >
                  {fmtY(v)}
                </text>
              </g>
            )
          })}

          {/* Current time marker (raw mode only) */}
          {markerX !== null && (
            <line
              x1={markerX}
              y1={0}
              x2={markerX}
              y2={innerH}
              stroke={EODC_LIGHT_BLUE}
              strokeOpacity={0.7}
              strokeWidth={1.5}
              strokeDasharray='3,2'
            />
          )}

          {/* Data dots — always rendered so sparse raw series are visible */}
          {displayValues.map((v, i) => {
            if (!Number.isFinite(v)) return null
            return (
              <circle
                key={i}
                cx={xScale(i)}
                cy={yScale(v)}
                r={aggregated ? 2.5 : 2}
                fill={EODC_BLUE}
                fillOpacity={aggregated ? 1 : 0.75}
              />
            )
          })}

          {/* Data line */}
          {pathD && (
            <path
              d={pathD}
              fill='none'
              stroke={EODC_BLUE}
              strokeWidth={aggregated ? 1 : 1.5}
              strokeOpacity={aggregated ? 0.4 : 1}
            />
          )}

          {/* X axis baseline */}
          <line
            x1={0}
            y1={innerH}
            x2={innerW}
            y2={innerH}
            stroke={EODC_DARK_GREY}
            strokeOpacity={0.8}
            strokeWidth={1}
          />

          {/* X labels */}
          {xLabels.map(({ i, label }) => (
            <text
              key={i}
              x={xScale(i)}
              y={innerH + 14}
              textAnchor={
                i === 0 ? 'start' : i === xCount - 1 ? 'end' : 'middle'
              }
              fontSize={9}
              fill={EODC_GREY}
            >
              {label}
            </text>
          ))}

          {/* Hover tooltip */}
          {tooltip &&
            (() => {
              const TW = 112,
                TH = 30,
                PAD = 4
              const tx = Math.max(0, Math.min(innerW - TW, tooltip.x - TW / 2))
              const ty =
                tooltip.y - TH - 6 < 0 ? tooltip.y + 8 : tooltip.y - TH - 6
              return (
                <g pointerEvents='none'>
                  <circle
                    cx={tooltip.x}
                    cy={tooltip.y}
                    r={3.5}
                    fill={EODC_LIGHT_BLUE}
                    stroke='none'
                  />
                  <rect
                    x={tx}
                    y={ty}
                    width={TW}
                    height={TH}
                    rx={3}
                    fill='rgba(27,30,35,0.92)'
                    stroke={EODC_DARK_GREY}
                    strokeWidth={0.75}
                  />
                  <text
                    x={tx + PAD}
                    y={ty + PAD + 8}
                    fontSize={8}
                    fill={EODC_GREY}
                  >
                    {tooltip.label}
                  </text>
                  <text
                    x={tx + PAD}
                    y={ty + PAD + 20}
                    fontSize={9}
                    fill={EODC_LIGHT_BLUE}
                    fontWeight='bold'
                  >
                    {fmtY(tooltip.value)}
                  </text>
                </g>
              )
            })()}
        </g>
      </svg>
    </Box>
  )
}

export function TimeSeriesChartOverlay() {
  const timeSeriesResult = useAppStore((s) => s.timeSeriesResult)
  const timeSeriesAgg = useAppStore((s) => s.timeSeriesAgg)
  const formatTimeIndex = useAppStore((s) => s.formatTimeIndex)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const datasetState = useAppStore((s) => s.datasetState)
  const setTimeSeriesResult = useAppStore((s) => s.setTimeSeriesResult)

  if (!timeSeriesResult) return null

  const currentTime =
    typeof datasetState.time === 'number' ? datasetState.time : null
  const idx =
    currentTime !== null
      ? timeSeriesResult.timeIndices.indexOf(currentTime)
      : -1
  const val = idx >= 0 ? timeSeriesResult.values[idx] : null

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 32,
        left: (sidebarWidth ?? 0) + 16,
        bg: 'rgba(27, 30, 35, 0.88)',
        color: '#DBD5D2',
        px: 3,
        pt: 2,
        pb: 1,
        borderRadius: 4,
        border: '1px solid rgba(115, 123, 141, 0.4)',
        width: `calc(100vw - ${(sidebarWidth ?? 0) + 32}px)`,
        zIndex: 10,
      }}
    >
      <Flex
        sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}
      >
        <Box
          sx={{
            fontSize: 0,
            color: '#737B8D',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Time series
          {val !== null && Number.isFinite(val) && (
            <Box
              as='span'
              sx={{
                color: '#DBD5D2',
                ml: 2,
                textTransform: 'none',
                letterSpacing: 'normal',
              }}
            >
              now:{' '}
              <Box as='span' sx={{ color: EODC_BLUE }}>
                {val.toPrecision(4)}
              </Box>
            </Box>
          )}
        </Box>
        <Box
          as='span'
          onClick={() => setTimeSeriesResult(null)}
          sx={{
            cursor: 'pointer',
            fontSize: 0,
            color: '#737B8D',
            '&:hover': { color: '#DBD5D2' },
          }}
        >
          ✕
        </Box>
      </Flex>
      <TimeSeriesChart
        result={timeSeriesResult}
        currentIndex={currentTime ?? undefined}
        formatX={formatTimeIndex ?? undefined}
        aggregate={timeSeriesAgg}
        height={220}
      />
    </Box>
  )
}
