import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.rildo.figurinhas',
  appName: 'Figurinhas',
  webDir: 'dist',
  android: {
    // Mantém o mesmo visual escuro/claro do app web enquanto carrega.
    backgroundColor: '#00000000',
  },
}

export default config
