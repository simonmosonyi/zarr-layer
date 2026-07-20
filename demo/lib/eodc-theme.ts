import baseTheme from '@carbonplan/theme'

// EODC brand palette on dark/black background
// Blue #169EB0 | Light blue #BAE3FA | Dark grey #45505D
// Grey #737B8D | Light grey #DBD5D2 | Gold #A89154

const eodcTheme = {
  ...baseTheme,
  colors: {
    ...(baseTheme.colors as object),
    background: '#1b1e23',
    primary: '#DBD5D2',
    secondary: '#737B8D',
    muted: '#45505D',
    hinted: '#252a30',
    text: '#DBD5D2',
    blue: '#169EB0',
    teal: '#169EB0',
    modes: undefined,
  },
  fonts: {
    ...(baseTheme.fonts as object),
    body: "'MarkOT', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
    heading: "'MarkOT', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
    faux: "'MarkOT', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
    monospace: "'MarkOT', 'Courier New', monospace",
  },
}

export default eodcTheme
