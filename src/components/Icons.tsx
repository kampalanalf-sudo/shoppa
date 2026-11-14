import React from 'react'

type P = React.SVGProps<SVGSVGElement> & { size?: number }

const base = (p: P) => ({
  width: p.size ?? 20,
  height: p.size ?? 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
})

export const IconHome = (p: P) => (
  <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>
)
export const IconSearch = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>
)
export const IconWallet = (p: P) => (
  <svg {...base(p)}><rect x="2.5" y="6" width="19" height="13" rx="3.5" /><path d="M2.5 10h19" /><circle cx="17" cy="14.5" r="1.3" fill="currentColor" stroke="none" /></svg>
)
export const IconGift = (p: P) => (
  <svg {...base(p)}><rect x="3" y="8" width="18" height="13" rx="2.5" /><path d="M3 12.5h18M12 8v13" /><path d="M12 8S10.5 3.5 8 4c-2 .4-2 4 4 4ZM12 8s1.5-4.5 4-4c2 .4 2 4-4 4Z" /></svg>
)
export const IconHistory = (p: P) => (
  <svg {...base(p)}><path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2" /><path d="M3 4v5h5" /><path d="M12 8v4.5l3 1.8" /></svg>
)
export const IconShield = (p: P) => (
  <svg {...base(p)}><path d="M12 3l7.5 3v6c0 4.5-3.1 7.9-7.5 9.5C7.6 19.9 4.5 16.5 4.5 12V6L12 3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>
)
export const IconVolume = (p: P) => (
  <svg {...base(p)}><path d="M4 10v4h3l4 3.5v-11L7 10H4Z" /><path d="M15 9.5a3.5 3.5 0 0 1 0 5" /><path d="M17.5 7a7 7 0 0 1 0 10" /></svg>
)
export const IconMuted = (p: P) => (
  <svg {...base(p)}><path d="M4 10v4h3l4 3.5v-11L7 10H4Z" /><path d="m15.5 10 4 4M19.5 10l-4 4" /></svg>
)
export const IconBolt = (p: P) => (
  <svg {...base(p)}><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" /></svg>
)
export const IconCopy = (p: P) => (
  <svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 6.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v6.5A2.5 2.5 0 0 0 6 15h.5" /></svg>
)
export const IconClose = (p: P) => (
  <svg {...base(p)}><path d="m6 6 12 12M18 6 6 18" /></svg>
)
export const IconChevronDown = (p: P) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
)
export const IconArrowUpRight = (p: P) => (
  <svg {...base(p)}><path d="M7 17 17 7M9 7h8v8" /></svg>
)
export const IconPlay = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
)
export const IconChevronLeft = (p: P) => (
  <svg {...base(p)}><path d="m14 6-6 6 6 6" /></svg>
)
export const IconDiamond = (p: P) => (
  <svg {...base(p)}><path d="M12 2.8 21 9.5 12 21 3 9.5 12 2.8Z" /><path d="M3 9.5h18M12 21 8.5 9.5 12 2.8l3.5 6.7L12 21Z" /></svg>
)
export const IconTrophy = (p: P) => (
  <svg {...base(p)}><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 5H5.5v2a3 3 0 0 0 3 3M16 5h2.5v2a3 3 0 0 1-3 3" /><path d="M12 13v4M9 20h6l-.5-3h-5L9 20Z" /></svg>
)
export const IconChat = (p: P) => (
  <svg {...base(p)}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5v-3.5H6.5A2.5 2.5 0 0 1 4 13.5v-7Z" /></svg>
)
export const IconFlame = (p: P) => (
  <svg {...base(p)}><path d="M12 2.5s5.5 4.2 5.5 9.5a5.5 5.5 0 0 1-11 0C6.5 9.6 8 7.8 8 7.8s.8 2 2.2 2.4C10.2 7 12 2.5 12 2.5Z" /></svg>
)
export const IconGrid = (p: P) => (
  <svg {...base(p)}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg>
)
export const IconGamepad = (p: P) => (
  <svg {...base(p)}><path d="M7.5 8h9a5 5 0 0 1 4.8 6.4l-.8 2.6A3 3 0 0 1 16.3 19l-1.6-1.6h-5.4L7.7 19a3 3 0 0 1-4.2-2l-.8-2.6A5 5 0 0 1 7.5 8Z" /><path d="M8 11.5v3M6.5 13h3" /><circle cx="16" cy="12.5" r="1" fill="currentColor" stroke="none" /><circle cx="17.8" cy="14.4" r="1" fill="currentColor" stroke="none" /></svg>
)
export const IconLive = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 16.5a6.4 6.4 0 0 0 0-9" /><path d="M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 19.5a10.6 10.6 0 0 0 0-15" /></svg>
)
export const IconSpade = (p: P) => (
  <svg {...base(p)}><path d="M12 3s6.5 4.6 6.5 9a3.8 3.8 0 0 1-6 3.2c.4 2.2 1 3.6 2.2 4.8H9.3c1.2-1.2 1.8-2.6 2.2-4.8a3.8 3.8 0 0 1-6-3.2C5.5 7.6 12 3 12 3Z" /></svg>
)
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7" /></svg>
)
export const IconInfo = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none" /></svg>
)
export const IconEye = (p: P) => (
  <svg {...base(p)}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
)
export const IconEyeOff = (p: P) => (
  <svg {...base(p)}><path d="M4 4l16 16" /><path d="M9.9 5.8A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.9M6.3 8A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.25 3.3-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
)
export const IconMenu = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
)
export const IconExternal = (p: P) => (
  <svg {...base(p)}><path d="M14 4h6v6M20 4l-8 8" /><path d="M18 14v4.5A2.5 2.5 0 0 1 15.5 21h-9A2.5 2.5 0 0 1 4 18.5v-9A2.5 2.5 0 0 1 6.5 7H11" /></svg>
)
