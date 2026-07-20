import type { AppProps } from 'next/app'
import { ThemeProvider } from 'theme-ui'
import eodcTheme from '../lib/eodc-theme'
import '../styles/globals.css'
import '../styles/eodc-fonts.css'
import 'maplibre-gl/dist/maplibre-gl.css'

const App = ({ Component, pageProps }: AppProps) => {
  return (
    <ThemeProvider theme={eodcTheme as any}>
      <Component {...pageProps} />
    </ThemeProvider>
  )
}

export default App
