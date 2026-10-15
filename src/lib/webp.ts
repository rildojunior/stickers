// Montagem de WebP animado a partir de quadros WebP estáticos.
// Formato: https://developers.google.com/speed/webp/docs/riff_container

interface Chunk {
  fourcc: string
  data: Uint8Array
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function readChunks(buf: Uint8Array): Chunk[] {
  if (dec.decode(buf.subarray(0, 4)) !== 'RIFF' || dec.decode(buf.subarray(8, 12)) !== 'WEBP') {
    throw new Error('Arquivo WebP inválido')
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const chunks: Chunk[] = []
  let offset = 12
  while (offset + 8 <= buf.length) {
    const fourcc = dec.decode(buf.subarray(offset, offset + 4))
    const size = view.getUint32(offset + 4, true)
    chunks.push({ fourcc, data: buf.subarray(offset + 8, offset + 8 + size) })
    offset += 8 + size + (size & 1)
  }
  return chunks
}

export function isAnimatedWebp(buf: Uint8Array): boolean {
  try {
    const vp8x = readChunks(buf).find((c) => c.fourcc === 'VP8X')
    return !!vp8x && (vp8x.data[0] & 0x02) !== 0
  } catch {
    return false
  }
}

function chunkBytes(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1
  const out = new Uint8Array(8 + data.length + pad)
  out.set(enc.encode(fourcc), 0)
  new DataView(out.buffer).setUint32(4, data.length, true)
  out.set(data, 8)
  return out
}

function uint24(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >> 8) & 0xff
  target[offset + 2] = (value >> 16) & 0xff
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export interface AnimFrame {
  /** Um WebP estático completo (saída do libwebp). */
  webp: Uint8Array
  durationMs: number
}

export function muxAnimatedWebp(frames: AnimFrame[], width: number, height: number): Uint8Array {
  const vp8x = new Uint8Array(10)
  vp8x[0] = 0x10 | 0x02 // alpha + animação
  uint24(vp8x, 4, width - 1)
  uint24(vp8x, 7, height - 1)

  const anim = new Uint8Array(6) // fundo transparente, loop infinito

  const anmfs = frames.map(({ webp, durationMs }) => {
    const imageChunks = readChunks(webp).filter((c) => c.fourcc === 'ALPH' || c.fourcc === 'VP8 ' || c.fourcc === 'VP8L')
    const header = new Uint8Array(16)
    uint24(header, 6, width - 1)
    uint24(header, 9, height - 1)
    uint24(header, 12, Math.max(1, Math.round(durationMs)))
    header[15] = 0x02 // sem blending, sem disposal: cada quadro substitui o anterior
    return chunkBytes('ANMF', concat([header, ...imageChunks.map((c) => chunkBytes(c.fourcc, c.data))]))
  })

  const body = concat([enc.encode('WEBP'), chunkBytes('VP8X', vp8x), chunkBytes('ANIM', anim), ...anmfs])
  const riff = new Uint8Array(8 + body.length)
  riff.set(enc.encode('RIFF'), 0)
  new DataView(riff.buffer).setUint32(4, body.length, true)
  riff.set(body, 8)
  return riff
}
