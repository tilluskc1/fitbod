/** What the device tells us; read from the browser in one place so the rule stays testable. */
export interface DeviceInfo {
  userAgent: string;
  touchPoints: number;
  /** Already running from the home screen (display-mode standalone or iOS navigator.standalone). */
  standalone: boolean;
}

export interface InstallHint {
  title: string;
  how: string;
}

/**
 * How to keep Home Strength on this phone (#214). iPhone has no install prompt, so it needs the
 * Share steps; Android Chrome offers Install app from its menu. Nothing once installed or on desktop.
 */
export function installHint({ userAgent, touchPoints, standalone }: DeviceInfo): InstallHint | null {
  if (standalone) return null;
  // iPadOS Safari reports a Mac user agent; a touch screen tells them apart.
  const apple = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  if (apple) {
    return {
      title: 'Add Home Strength to your Home Screen.',
      how: 'In Safari, tap Share, then Add to Home Screen. Safari can clear a site’s data after 7 days of browsing without opening it; a Home Screen app keeps it.',
    };
  }
  if (/Android/.test(userAgent)) {
    return {
      title: 'Install Home Strength on this phone.',
      how: 'In Chrome, open the ⋮ menu, then Install app (or Add to Home screen). It opens like an app and keeps your data on this phone.',
    };
  }
  return null;
}

/** The live device, for the Settings sheet. */
export function currentDevice(): DeviceInfo {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    touchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
  };
}
