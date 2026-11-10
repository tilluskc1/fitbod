/** What the device tells us; read from the browser in one place so the rule stays testable. */
export interface DeviceInfo {
  userAgent: string;
  touchPoints: number;
  /** Already running from the home screen (display-mode standalone or iOS navigator.standalone). */
  standalone: boolean;
}

/** How to keep Home Strength on this phone (#214, #307). */
export interface InstallGuide {
  title: string;
  /** The Add to Home Screen (or Install app) step, in this browser's words. */
  add: string;
  /**
   * A Home Screen app on iOS has its own storage, so the browser's workouts must be backed up and
   * restored into it. Android's installed app shares the browser's storage.
   */
  carryData: boolean;
}

const SAFARI_ADD = 'Tap Share at the bottom, then Add to Home Screen, then Add.';
// (#307) Firefox and Edge menus are not verified on a device yet; until then, the Safari route.
const VIA_SAFARI = 'Open this page in Safari, then tap Share, then Add to Home Screen.';
// In-app webviews (Instagram, Facebook, LinkedIn, X, Google app…) cannot add to the Home Screen.
const IN_APP = /Instagram|FBAN|FBAV|FBIOS|LinkedInApp|Twitter|Line\/|GSA\/|Snapchat|musical_ly|TikTok/;

function iosAdd(userAgent: string): string {
  if (IN_APP.test(userAgent)) return `Open this page in Safari first. Then ${SAFARI_ADD[0].toLowerCase()}${SAFARI_ADD.slice(1)}`;
  if (/CriOS/.test(userAgent)) return 'Tap Share in the address bar, then Add to Home Screen. Not there? Open this page in Safari and add it from there.';
  if (/FxiOS|EdgiOS/.test(userAgent)) return VIA_SAFARI;
  return SAFARI_ADD;
}

function androidAdd(userAgent: string): string {
  if (/SamsungBrowser/.test(userAgent)) return 'In Samsung Internet, open the menu, then Add page to, then Home screen.';
  if (/Firefox/.test(userAgent)) return 'In Firefox, open the ⋮ menu, then Add to Home screen.';
  if (/Chrome\//.test(userAgent) && !/EdgA|OPR|YaBrowser/.test(userAgent)) {
    return 'In Chrome, open the ⋮ menu, then Install app (or Add to Home screen).';
  }
  return 'Open your browser’s menu, then Install app or Add to Home screen.';
}

/** The steps for this device, or null once installed or on a desktop. */
export function installGuide({ userAgent, touchPoints, standalone }: DeviceInfo): InstallGuide | null {
  if (standalone) return null;
  // iPadOS Safari reports a Mac user agent; a touch screen tells them apart.
  const apple = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  if (apple) return { title: 'Add Home Strength to your Home Screen.', add: iosAdd(userAgent), carryData: true };
  if (/Android/.test(userAgent)) return { title: 'Install Home Strength on this device.', add: androidAdd(userAgent), carryData: false };
  return null;
}

export interface InstallStep {
  key: 'backup' | 'add' | 'restore';
  text: string;
}

/**
 * (#307) The sheet's numbered steps. With workouts to carry into the iOS Home Screen app: back up,
 * add, restore. With none, or on Android, only the add step.
 */
export function installSteps(guide: InstallGuide, workouts: number): InstallStep[] {
  const add: InstallStep = { key: 'add', text: guide.add };
  if (!guide.carryData || workouts === 0) return [add];
  return [
    { key: 'backup', text: 'Back up your workouts. The Home Screen app starts empty.' },
    add,
    { key: 'restore', text: 'Open the new app and tap Restore backup on the first screen.' },
  ];
}

/** (#307) Today's line. */
export const INSTALL_NOTE = 'Keep Home Strength on your Home Screen. It keeps your workouts safe and opens like an app.';
const SNOOZE_MS = 7 * 86_400_000;
const MAX_DISMISSALS = 2;

/**
 * (#307) Today shows the note after the first finished workout, outside a running session, until
 * it is installed. Each × hides it for 7 days; after two it lives only in Settings.
 */
export function showInstallNote({
  device,
  completedWorkouts,
  sessionOpen,
  dismissals,
  now,
}: {
  device: DeviceInfo;
  completedWorkouts: number;
  sessionOpen: boolean;
  dismissals: string[] | undefined;
  now: Date;
}): boolean {
  if (sessionOpen || completedWorkouts < 1 || !installGuide(device)) return false;
  const record = dismissals ?? [];
  if (record.length >= MAX_DISMISSALS) return false;
  const last = record.at(-1);
  return last === undefined || now.getTime() - Date.parse(last) >= SNOOZE_MS;
}

/** (#307) The stored record after one more ×: its dates, never more than two. */
export function dismissInstallNote(dismissals: string[] | undefined, now: Date): string[] {
  return [...(dismissals ?? []), now.toISOString()].slice(0, MAX_DISMISSALS);
}

/** The live device, for Today and Settings. */
export function currentDevice(): DeviceInfo {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    touchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
  };
}
