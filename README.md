# Figurinhas

Web app (PWA) para criar figurinhas de WhatsApp com fotos e vídeos, focado no iPhone.
Tudo roda no aparelho: os pacotes ficam no IndexedDB, e a remoção de fundo usa IA local.

```bash
npm install
npm run dev      # http://localhost:5173 (use o IP da rede para abrir no iPhone)
npm run build
```

## Estrutura

- `src/lib/encode.ts` + `encoder.worker.ts`: WebP via libwebp/WASM (o Safari não gera WebP com canvas). Estática ≤100 KB, animada ≤500 KB.
- `src/lib/webp.ts`: monta o WebP animado (chunks VP8X/ANIM/ANMF) a partir de quadros estáticos.
- `src/lib/render.ts`: composição da figurinha (imagem, contorno, desenho, texto), usada na prévia e na exportação.
- `src/lib/bg.ts` + `bg.worker.ts`: remoção de fundo com transformers.js + `onnx-community/ormbg-ONNX` (Apache-2.0, ~44 MB, baixado sob demanda).
- `src/lib/wastickers.ts`: exporta e importa `.wastickers` (e o `pack.json` do lolocomotive/stickers).
- `src/store.tsx`: pacotes e figurinhas (regras do WhatsApp: 3–30 por pacote, sem misturar estáticas e animadas).
- `src/screens/`: Biblioteca, Pacote, Editor e as folhas de ações.

## Limitação conhecida

Um site não consegue adicionar um *pacote* direto no WhatsApp: a API oficial exige um app nativo.
O envio é feito figurinha por figurinha (pelo menu de compartilhar ou copiando e colando), e o pacote pode ser exportado como `.wastickers`.
