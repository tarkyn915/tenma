// Built-in wallpapers live in public/wallpapers and are copied into dist as-is.
export const WALLPAPER_IDS = ['none', 'aurora', 'forest', 'custom'] as const;
export type WallpaperId = typeof WALLPAPER_IDS[number];
export const BUILTIN_WALLPAPERS = {
  aurora: { full: '/wallpapers/aurora.jpg', thumb: '/wallpapers/aurora-thumb.jpg' },
  forest: { full: '/wallpapers/forest.jpg', thumb: '/wallpapers/forest-thumb.jpg' },
} as const;
export const DEFAULT_WALLPAPER_OPACITY = 40;
export const DEFAULT_WALLPAPER_BLUR = 0;

export const isWallpaperId = (value: string): value is WallpaperId => (WALLPAPER_IDS as readonly string[]).includes(value);
