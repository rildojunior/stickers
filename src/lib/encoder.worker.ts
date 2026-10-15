import encode from '@jsquash/webp/encode'
import type { EncodeOptions } from '@jsquash/webp/meta'

export interface EncodeRequest {
  id: number
  image: ImageData
  options: Partial<EncodeOptions>
}

export type EncodeResponse = { id: number; buffer: ArrayBuffer } | { id: number; error: string }

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { id, image, options } = event.data
  try {
    const buffer = await encode(image, options)
    ;(self as unknown as Worker).postMessage({ id, buffer } satisfies EncodeResponse, [buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) } satisfies EncodeResponse)
  }
}
