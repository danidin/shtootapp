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

const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
const LocalNotifications = Plugins.LocalNotifications || null;
const PushNotifications = Plugins.PushNotifications || null;

// FCM push registration: on launch, ask for permission, register with FCM, then
// forward the token to ozen so it can target this device. The same WebSocket
// flow continues to drive in-app updates; FCM only fires when the WebView is
// suspended or killed and a message arrives.
if (PushNotifications) {
  // shtoot-peh.js hardcodes the same URL; ?dev=true uses localhost (only useful
  // with `cleartext: true` in capacitor.config.json on an emulator).
  const isDev = new URLSearchParams(window.location.search).get('dev') === 'true';
  const apiUrl = isDev ? 'http://localhost:4000/graphql' : 'https://api.shtoot.net/graphql';

  const sendTokenToOzen = async (token) => {
    const jwt = localStorage.getItem('jwt');
    if (!jwt) return;
    try {
      await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          query: 'mutation($token: String!) { registerFcmToken(token: $token) }',
          variables: { token },
        }),
      });
    } catch (_) {}
  };

  PushNotifications.addListener('registration', (t) => {
    if (t && t.value) sendTokenToOzen(t.value);
  });
  PushNotifications.addListener('registrationError', (err) => {
    console.error('PushNotifications registration error', err);
  });
  // Foreground data-only messages are also delivered to ShtootMessagingService
  // (which suppresses notify when in foreground); the WebSocket handles UI.
  PushNotifications.addListener('pushNotificationReceived', () => {});
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const shtootId = action && action.notification && action.notification.data && action.notification.data.shtootId;
    if (shtootId) {
      try { localStorage.setItem('pendingShtootId', shtootId); } catch (_) {}
    }
  });

  const registerPush = async () => {
    try {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive !== 'granted') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive === 'granted') {
        await PushNotifications.register();
      }
    } catch (e) {
      console.error('PushNotifications setup failed', e);
    }
  };

  // Defer until JWT is present (login completed). Polling is cheap and avoids
  // a tight coupling with the login page's success path.
  const waitForJwt = () => {
    if (localStorage.getItem('jwt')) {
      registerPush();
    } else {
      setTimeout(waitForJwt, 500);
    }
  };
  waitForJwt();
}

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
