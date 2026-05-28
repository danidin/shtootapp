/**
 * Shims the Web Notifications API with Capacitor LocalNotifications so the
 * unchanged shtoot-peh.js code that calls `new Notification(...)` works inside
 * the Android WebView.
 *
 * shtoot-peh.js calls:
 *   - 'Notification' in window  (feature detect)
 *   - Notification.permission
 *   - Notification.requestPermission()
 *   - this.swRegistration.showNotification(title, { body, tag })
 *   - new Notification(title, options)
 *
 * sw.js never runs inside Capacitor — sync-peh.js drops the registration call —
 * so the swRegistration branch is dead; only the direct `new Notification`
 * branch matters here.
 */

const LocalNotifications = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null;

if (LocalNotifications) {
  let permissionState = 'default';
  let nextId = 1;

  async function ensurePermission() {
    try {
      const result = await LocalNotifications.checkPermissions();
      if (result.display === 'granted') {
        permissionState = 'granted';
        return 'granted';
      }
      const req = await LocalNotifications.requestPermissions();
      permissionState = req.display === 'granted' ? 'granted' : 'denied';
      return permissionState;
    } catch (_) {
      permissionState = 'denied';
      return 'denied';
    }
  }

  function ShtootNotification(title, options) {
    options = options || {};
    LocalNotifications.schedule({
      notifications: [{
        id: nextId++,
        title: String(title || 'Shtoot'),
        body: String(options.body || ''),
        // Use the tag (Shtoot ID) as extra so duplicates don't pile up — schedule with
        // the same numeric id when present so Android replaces an existing one.
        extra: { tag: options.tag || null },
      }],
    }).catch(() => {});
  }

  Object.defineProperty(ShtootNotification, 'permission', {
    get() { return permissionState; },
  });

  ShtootNotification.requestPermission = function (cb) {
    const p = ensurePermission();
    if (typeof cb === 'function') p.then(cb);
    return p;
  };

  // Kick off the initial permission check so Notification.permission reports
  // something useful by the time shtoot-peh.js queries it.
  ensurePermission();

  window.Notification = ShtootNotification;
}
