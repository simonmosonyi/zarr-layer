import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { Box } from 'theme-ui'
import { Map } from '../components/map-shared'
import Sidebar from '../components/sidebar'
import { useAppStore } from '../lib/store'
import { DATASET_MAP } from '../datasets'

export default function Home() {
  const router = useRouter()
  const sidebarWidth = useAppStore((state) => state.sidebarWidth)

  useEffect(() => {
    if (!router.isReady) return

    const urlDataset = router.query.dataset
    if (typeof urlDataset === 'string' && DATASET_MAP[urlDataset]) {
      useAppStore.getState().setDatasetId(urlDataset)
    }

    return useAppStore.subscribe((state, prev) => {
      if (state.datasetId !== prev.datasetId) {
        router.replace({ query: { dataset: state.datasetId } }, undefined, {
          shallow: true,
        })
      }
    })
  }, [router.isReady]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Head>
        <title>EODC Zarr Viewer</title>
        <meta
          name='description'
          content='Interactive viewer for EODC Zarr data collections'
        />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <link rel='icon' href='/favicon.ico' />
      </Head>
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          overflow: 'hidden',
        }}
      >
        <Sidebar />
        {sidebarWidth !== null && <Map />}
      </Box>
    </>
  )
}
