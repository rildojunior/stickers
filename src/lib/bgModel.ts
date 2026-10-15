/** Modelo de recorte (Apache-2.0). Baixado uma vez (~44 MB) e executado no próprio aparelho. */
export const BG_MODEL = 'onnx-community/ormbg-ONNX'
export const BG_MODEL_SIZE_MB = 44
const READY_KEY = 'figurinhas.bgModelReady'

export const isBgModelCached = () => localStorage.getItem(READY_KEY) === '1'
export const markBgModelCached = () => localStorage.setItem(READY_KEY, '1')
