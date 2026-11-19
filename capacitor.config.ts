import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor shell around the same Vite build that serves the web app.
 *
 * Why not load a remote URL: a WebView pointed at a remote origin gets no
 * service worker, no offline shell, and no access to the local assets. Shipping
 * the built files inside the APK means the app opens instantly and the only
 * network traffic is the API and Supabase calls the app actually needs.
 *
 * Consequence to be explicit about: the app is NOT auto-updating. A new web
 * deploy does not reach installed APKs — they must be rebuilt and republished.
 */
const config: CapacitorConfig = {
  appId: 'com.floatbet.gaming',
  appName: 'FloatBet',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    // Same dark background as the manifest, so the gap between the splash
    // and the first paint is invisible rather than a white flash.
    backgroundColor: '#08090f',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
    // Payments open in the system browser, never inside the WebView.
    hostname: 'shoppa-ten.vercel.app',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#08090f',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
}

export default config
