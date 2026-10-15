const PATHS = {
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  photo: 'M4 7a3 3 0 013-3h10a3 3 0 013 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3V7zM4 16l4.5-4.5a2 2 0 012.8 0L16 16M14 14l1.5-1.5a2 2 0 012.8 0L20 14.5M15.5 8.5h.01',
  video: 'M3.5 7.5a2.5 2.5 0 012.5-2.5h7.5a2.5 2.5 0 012.5 2.5v9a2.5 2.5 0 01-2.5 2.5H6a2.5 2.5 0 01-2.5-2.5v-9zM16 10.5l4.2-2.6a.5.5 0 01.8.4v7.4a.5.5 0 01-.8.4L16 13.5',
  share: 'M12 3.5v11M8 7.5l4-4 4 4M7 11H6a2 2 0 00-2 2v5.5a2 2 0 002 2h12a2 2 0 002-2V13a2 2 0 00-2-2h-1',
  copy: 'M9 9h9a2 2 0 012 2v8a2 2 0 01-2 2h-7a2 2 0 01-2-2V9zM15 9V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h3',
  download: 'M12 4v11M8 11l4 4 4-4M5 19.5h14',
  trash: 'M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v1.5M6.5 6.5l.8 12.1a2 2 0 002 1.9h5.4a2 2 0 002-1.9l.8-12.1',
  magic: 'M5 19L15.5 8.5M13.5 6.5l4 4M7 4v3M5.5 5.5h3M18 14v3M16.5 15.5h3M19 3.5v2M18 4.5h2',
  text: 'M5 6.5V5h14v1.5M12 5v14M9.5 19h5',
  draw: 'M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1zM14.5 6.5l3 3',
  outline: 'M12 3.5c4.7 0 8.5 3.8 8.5 8.5s-3.8 8.5-8.5 8.5S3.5 16.7 3.5 12 7.3 3.5 12 3.5zM12 7.5a4.5 4.5 0 110 9 4.5 4.5 0 010-9z',
  crop: 'M7 3v12a2 2 0 002 2h12M3 7h12a2 2 0 012 2v12',
  undo: 'M9 14L4.5 9.5 9 5M5 9.5h9.5a5 5 0 010 10H11',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  folder: 'M3.5 7.5A2.5 2.5 0 016 5h3.6l2 2H18a2.5 2.5 0 012.5 2.5V17a2.5 2.5 0 01-2.5 2.5H6A2.5 2.5 0 013.5 17V7.5z',
  import: 'M12 15V4M8 11l4 4 4-4M4.5 14.5V18a2 2 0 002 2h11a2 2 0 002-2v-3.5',
  pencil: 'M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4z',
  smile: 'M12 3.5a8.5 8.5 0 110 17 8.5 8.5 0 010-17zM8.5 14a4.5 4.5 0 007 0M9 9.5h.01M15 9.5h.01',
  star: 'M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6L12 4z',
  left: 'M14.5 6l-6 6 6 6',
  right: 'M9.5 6l6 6-6 6',
  scissors: 'M6.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM6.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8.6 7.6L19 17M8.6 16.4L19 7',
  play: 'M8 5.5v13l10-6.5-10-6.5z',
  pause: 'M8 5.5v13M16 5.5v13',
  sticker: 'M14 20.5H8A4.5 4.5 0 013.5 16V8A4.5 4.5 0 018 3.5h8A4.5 4.5 0 0120.5 8v6M14 20.5c0-3.6 2.9-6.5 6.5-6.5M14 20.5l6.5-6.5',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22, strokeWidth = 1.9 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} fill={name === 'play' ? 'currentColor' : 'none'} />
    </svg>
  )
}
