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

import { gql } from './gql.js';

const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
const LocalNotifications = Plugins.LocalNotifications || null;
const PushNotifications = Plugins.PushNotifications || null;
const ShtootBridge = Plugins.ShtootBridge || null;

// Tell native which space the user is currently looking at, so
// ShtootMessagingService can suppress notifications for that space while in
// foreground but still surface other-space messages. Re-asserted on
// visibilitychange in case the user returned via the launcher.
if (ShtootBridge) {
  const reportSpace = () => {
    const space = new URLSearchParams(window.location.search).get('space') || '';
    ShtootBridge.setCurrentSpace({ space }).catch(() => {});
  };
  reportSpace();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reportSpace();
  });
}

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
      await gql(apiUrl, jwt,
        'mutation($token: String!) { registerFcmToken(token: $token) }',
        { token });
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

  function ShtootNotification(_title, _options) {
    // No-op on Android: native ShtootMessagingService is the sole notification
    // source (it knows the current space and suppresses correctly). Leaving the
    // shim in place — including permission machinery below — so peh's existing
    // `new Notification(...)` calls don't throw.
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
