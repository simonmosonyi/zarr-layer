import { useRef, useEffect } from 'react'
import { Box } from 'theme-ui'
import Controls from './controls'
import { useAppStore } from '../lib/store'

// Match the carbonplan Sidebar width={4} formula at the desktop breakpoint:
// calc(4 * 100vw / 12 + 37px) = calc(100vw / 3 + 37px)
const SIDEBAR_W = 'calc(100vw / 3 + 37px)'
// Button sits 48px in from the right edge of the panel
const BUTTON_LEFT_OPEN = 'calc(100vw / 3 + 37px - 48px)'
const BUTTON_LEFT_CLOSED = '4px'

const SidebarContent = () => (
  <>
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        mb: 2,
      }}
    >
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          bg: '#169EB0',
          flexShrink: 0,
        }}
      />
      <Box
        as='h1'
        sx={{
          fontSize: [3],
          fontFamily: 'heading',
          letterSpacing: '0.04em',
          lineHeight: 1.2,
          m: 0,
          color: '#DBD5D2',
        }}
      >
        EODC Zarr Viewer
      </Box>
    </Box>
    <Box sx={{ height: '1px', bg: '#45505D', my: 3 }} />
    <Controls />
  </>
)

const SidebarComponent = () => {
  const sidebarRef = useRef<HTMLDivElement>(null)
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth)
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed)

  useEffect(() => {
    const updateSidebarWidth = () => {
      if (sidebarCollapsed) {
        setSidebarWidth(0)
        return
      }
      setSidebarWidth(sidebarRef.current?.offsetWidth ?? 0)
    }
    updateSidebarWidth()
    window.addEventListener('resize', updateSidebarWidth)
    return () => {
      window.removeEventListener('resize', updateSidebarWidth)
      setSidebarWidth(0)
    }
  }, [setSidebarWidth, sidebarCollapsed])

  return (
    <>
      {/* Desktop sidebar */}
      <Box sx={{ display: ['none', 'none', 'block'] }}>
        {/* Panel */}
        <Box
          ref={sidebarRef}
          className='custom-scrollbar'
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            width: SIDEBAR_W,
            bg: '#1b1e23',
            borderRight: '1px solid #45505D',
            overflowY: 'auto',
            zIndex: 1000,
            px: 4,
            pt: 4,
            pb: 5,
            transform: sidebarCollapsed
              ? 'translateX(calc(-100vw / 3 - 37px))'
              : 'translateX(0)',
            transition: 'transform 0.2s ease',
          }}
        >
          <SidebarContent />
        </Box>

        {/* Fold / expand toggle button */}
        <Box
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          sx={{
            position: 'fixed',
            top: '50%',
            left: sidebarCollapsed ? BUTTON_LEFT_CLOSED : BUTTON_LEFT_OPEN,
            transform: 'translateY(-50%)',
            width: 32,
            height: 32,
            bg: 'rgba(27,30,35,0.92)',
            border: '1px solid rgba(115,123,141,0.35)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 2000,
            color: '#737B8D',
            fontSize: 16,
            lineHeight: 1,
            transition: 'left 0.2s ease, border-color 0.15s, color 0.15s',
            '&:hover': {
              borderColor: 'rgba(22,158,176,0.6)',
              color: '#BAE3FA',
            },
          }}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </Box>
      </Box>

      {/* Mobile bottom panel */}
      <Box
        sx={{
          display: ['block', 'block', 'none'],
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '50vh',
          bg: '#1b1e23',
          overflowY: 'auto',
          zIndex: 1000,
          px: [4, 5],
          py: [3],
          borderTop: '1px solid #45505D',
        }}
      >
        <SidebarContent />
      </Box>
    </>
  )
}

export default SidebarComponent
