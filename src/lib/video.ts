export async function loadVideo(file: Blob): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  video.src = URL.createObjectURL(file)
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve()
    video.onerror = () => reject(new Error('Não foi possível abrir este vídeo.'))
    video.load()
  })
  // Alguns arquivos (ex.: gravados no navegador) chegam sem duração; buscar o fim força o cálculo.
  if (!Number.isFinite(video.duration)) {
    await new Promise<void>((resolve) => {
      video.ondurationchange = () => Number.isFinite(video.duration) && resolve()
      video.currentTime = 1e7
      setTimeout(resolve, 3000)
    })
    video.ondurationchange = null
    video.currentTime = 0
  }
  return video
}

export function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001))
    if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) return resolve()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    const onSeeked = () => {
      // Espera o quadro ser realmente apresentado, quando o navegador permitir.
      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(() => finish())
        setTimeout(finish, 120)
      } else {
        finish()
      }
    }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = target
    setTimeout(finish, 2000)
  })
}
