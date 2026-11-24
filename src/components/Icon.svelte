<script lang="ts" module>
  // Simple 24×24 line icons drawn for Balonca (stroke = currentColor), so they look the same on every phone.
  const PATHS = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    play: 'M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5z',
    pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
    prev: 'M6 5v14M19 5.5v13a.7.7 0 0 1-1.1.6L8.5 12.6a.7.7 0 0 1 0-1.2l9.4-6.5a.7.7 0 0 1 1.1.6z',
    next: 'M18 5v14M5 5.5v13a.7.7 0 0 0 1.1.6l9.4-6.5a.7.7 0 0 0 0-1.2L6.1 4.9A.7.7 0 0 0 5 5.5z',
    repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
    expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
    link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2',
    cards: 'M8 3h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 7v12a2 2 0 0 0 2 2h12',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.3 9a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4M12 17.2v.1',
    bubble: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 10h.01M12 10h.01M16 10h.01',
    speaker: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
    gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4L10.6 6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z',
    book: 'M12 6.5C10.4 5 8 4.5 3 4.5v14c5 0 7.4.5 9 2 1.6-1.5 4-2 9-2v-14c-5 0-7.4.5-9 2zM12 6.5v14',
    tv: 'M3 6h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM8 2l4 4 4-4',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 22, fill = false }: { name: IconName; size?: number; fill?: boolean } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
  fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={fill ? 0 : 2} stroke-linecap="round" stroke-linejoin="round">
  <path d={PATHS[name]} />
</svg>

<style>
  svg { display: block; flex: none; }
</style>
