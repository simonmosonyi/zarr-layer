import { useAppColormap } from '../lib/eodc-colormap'
import { Colorbar } from '@carbonplan/components'
import { Box } from 'theme-ui'
import { useAppStore } from '../lib/store'

function smartDecimals(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return 2
  for (let d = 0; d <= 10; d++) {
    if (min.toFixed(d) !== max.toFixed(d)) return d
  }
  return 10
}

export function MapTimeMeanColorbar() {
  const timeMeanEnabled = useAppStore((s) => s.timeMeanEnabled)
  const timeMeanResult = useAppStore((s) => s.timeMeanResult)
  const clim = useAppStore((s) => s.clim)
  const colormap = useAppStore((s) => s.colormap)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const themedColormap = useAppColormap(colormap, { format: 'hex' })

  if (!timeMeanEnabled || !timeMeanResult || timeMeanResult.data.length === 0)
    return null

  const d = smartDecimals(clim[0], clim[1])

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
        minWidth: 220,
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          fontSize: 0,
          color: '#737B8D',
          mb: 1,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        Time mean
      </Box>
      <Colorbar
        colormap={themedColormap}
        clim={clim}
        format={(v: number) => v.toFixed(d)}
        horizontal
        width='100%'
        sxClim={{ fontSize: 0, color: '#DBD5D2' }}
      />
    </Box>
  )
}

// Rendering is handled by ZarrLayer.setTimeMeanData — nothing to mount here.
export function MapTimeMeanOverlay() {
  return null
}

// Keep useTimeMeanOverlay as a no-op for backward compatibility
export function useTimeMeanOverlay() {}
