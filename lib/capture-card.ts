/**
 * captureCardDesktop
 *
 * Captures an HTML element as a PNG data-URL at a fixed "desktop" width,
 * even when called from a narrow mobile viewport.
 *
 * On desktop (viewport ≥ width): captures the element directly.
 * On mobile (viewport < width): clones the element into an off-screen
 *   container at the target width so the image always looks desktop-size.
 *
 * Returns null if the element is not available or capture fails.
 */
export async function captureCardDesktop(
  el: HTMLElement,
  exportWidth = 1040
): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const { toPng } = await import('html-to-image');

  const filter = (node: HTMLElement) =>
    !node.classList?.contains('export-ignore');

  // Desktop: capture directly — no off-screen clone needed
  if (window.innerWidth >= exportWidth) {
    return toPng(el, { pixelRatio: 2, cacheBust: true, filter });
  }

  // Mobile: clone into a fixed-width off-screen container.
  // html-to-image captures the clone at the forced width, giving the
  // same layout as the desktop view regardless of viewport width.
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'position:fixed',
    'top:0',
    `left:-${exportWidth + 200}px`,
    `width:${exportWidth}px`,
    'overflow:visible',
    'z-index:-1',
    'pointer-events:none',
  ].join(';');

  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.width = `${exportWidth}px`;
  clone.style.maxWidth = 'none';
  clone.style.minWidth = `${exportWidth}px`;
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  // Two rAF ticks so the browser lays out the clone before we screenshot it
  await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));

  try {
    return await toPng(clone, {
      pixelRatio: 2,
      cacheBust: true,
      width: exportWidth,
      filter,
    });
  } finally {
    document.body.removeChild(wrapper);
  }
}

/**
 * shareOrCopyImage
 *
 * Given a PNG blob:
 *  - Mobile with Web Share API (iOS 15+, Android Chrome 97+): opens the
 *    native OS share sheet so the user can save/share like any other image.
 *  - Everything else: writes to the clipboard (desktop Chrome/Edge/Firefox).
 *
 * Returns 'shared' | 'copied' | 'failed'.
 */
export async function shareOrCopyImage(
  blob: Blob,
  fileName: string
): Promise<'shared' | 'copied' | 'failed'> {
  try {
    const file = new File([blob], fileName, { type: 'image/png' });

    // Prefer Web Share on mobile — navigator.canShare checks API support + file type
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return 'shared';
    }

    // Desktop fallback: clipboard
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    return 'failed';
  }
}
