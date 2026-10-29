/// Mac (system) alerts for moments the user may miss while Nindo is in the
/// background, such as a focus round ending. While the window is in front
/// and focused the toast is enough, so nothing is shown then.

function supported(): boolean {
  return typeof Notification !== 'undefined';
}

/// Asks once, from a click, whether Nindo may show alerts. Browsers only
/// allow the question during a user action.
export function askForAlerts() {
  if (!supported() || Notification.permission !== 'default') return;
  void Notification.requestPermission().catch(() => undefined);
}

/// Shows [title] as a system alert when allowed and the window is hidden or
/// another app is in front.
/// [tag] replaces an earlier alert with the same tag, so two open windows
/// show one alert, not two.
export function alertInBackground(title: string, body: string, tag: string) {
  if (!supported() || Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return;
  try {
    const n = new Notification(title, { body, tag, icon: './icon-192.png' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some browsers only allow alerts from a service worker; the toast still shows.
  }
}
