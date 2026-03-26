import { initKeys, createNewKey, importKeyBundle, encryptForSpace, decryptMessage, getStoredKeys } from './crypto.js';

class ShtootPeh extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shtoots = [];
    this.jwt = localStorage.getItem('jwt');
    this.userID = this.decodeJwtResponse(this.jwt).email;
    this.space = this._getSpaceFromRoute();
    this.isDev = new URLSearchParams(window.location.search).get('dev') === 'true';
    this.apiUrl = this.isDev ? 'http://localhost:4000/graphql' : 'https://api.shtoot.net/graphql';
    this.wsUrl = this.isDev ? 'ws://localhost:4000/graphql' : 'wss://api.shtoot.net/graphql';
    this.ws = null;
    this.subscribed = false;
    this.notificationRequested = false;
    this.connectedAt = Date.now();
    this.swRegistration = null;
    this.cryptoKeys = null;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: flex; flex-direction: column; height: 100%; }
        .shtoots { flex: 1; overflow-y: auto; margin-bottom: 10px; padding: 6px; font-family: sans-serif; }
        .shtoot { border: 1px solid #eee; padding: 4px 6px; border-radius: 4px; margin-bottom: 4px; background: white; }
        .shtoot.mine { background: #e3f2fd; }
        .shtoot a { color: #0066cc; text-decoration: none; }
        .shtoot a:hover { text-decoration: underline; }
        textarea { width: 100%; min-height: 2.5em; font-family: inherit; margin-bottom: 0.5em; box-sizing: border-box; }
        button {
          padding: 12px 24px;
          background: #0066cc;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
        }
        button:hover { background: #0052a3; }
        button:active { background: #004080; }
        @media (max-width: 768px) {
          textarea { font-size: 16px; }
        }
        .meta { font-size: 0.8em; color: #888; }
        .error { color: red; font-size: 0.9em; }
        .warn { color: red; font-size: 0.85em; margin-left: 4px; }
        .key-setup {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.6);
          z-index: 200;
          justify-content: center;
          align-items: center;
        }
        .key-setup.open { display: flex; }
        .key-setup-card {
          background: white;
          padding: 28px;
          border-radius: 10px;
          max-width: 400px;
          width: 90%;
          font-family: sans-serif;
        }
        .key-setup-card h2 { margin-top: 0; font-size: 18px; }
        .key-setup-card p { font-size: 13px; color: #444; }
        .key-setup-card .choice { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
        .key-setup-card .choice button {
          padding: 12px;
          font-size: 14px;
          border-radius: 6px;
          cursor: pointer;
          border: 1px solid #0066cc;
        }
        .key-setup-card .choice .primary { background: #0066cc; color: white; }
        .key-setup-card .choice .primary:hover { background: #0052a3; }
        .key-setup-card .choice .secondary { background: white; color: #0066cc; }
        .key-setup-card .choice .secondary:hover { background: #f0f0f0; }
        .key-setup-card textarea {
          width: 100%;
          height: 80px;
          font-size: 11px;
          font-family: monospace;
          box-sizing: border-box;
          resize: vertical;
          margin-top: 8px;
        }
        .key-setup-card input[type=text] {
          width: 100%;
          padding: 6px;
          margin: 8px 0;
          box-sizing: border-box;
          font-size: 18px;
          letter-spacing: 4px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        .key-setup-card .btn-row { display: flex; gap: 8px; margin-top: 10px; }
        .key-setup-card .btn-row button { flex: 1; padding: 10px; font-size: 14px; }
        .key-setup-card .setup-error { color: red; font-size: 0.85em; margin-top: 6px; }
      </style>
      <div class="shtoots"></div>
      <textarea placeholder="Say a Shtoot..."></textarea><br/>
      <button>Send</button>
      <div class="error"></div>

      <div class="key-setup" id="key-setup">
        <div class="key-setup-card">
          <h2>Set up encryption</h2>
          <p>Shtoot uses end-to-end encryption for private messages. How would you like to set up this device?</p>
          <div class="choice" id="key-setup-choice">
            <button class="primary" id="new-key-btn">This is my first device</button>
            <button class="secondary" id="import-key-btn">I have Shtoot on another device</button>
          </div>
          <div id="key-import-form" style="display:none">
            <p>Paste the blob from your other device:</p>
            <textarea id="setup-blob" placeholder="Paste blob here…"></textarea>
            <input type="text" id="setup-pin" placeholder="PIN" maxlength="6" inputmode="numeric">
            <div class="setup-error" id="setup-error"></div>
            <div class="btn-row">
              <button class="primary" id="setup-import-btn">Import</button>
              <button class="secondary" id="setup-back-btn">Back</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    this.textarea = this.shadowRoot.querySelector('textarea');
    this.listEl = this.shadowRoot.querySelector('.shtoots');
    this.errorEl = this.shadowRoot.querySelector('.error');
    this.shadowRoot.querySelector('button').onclick = () => this._createShtoot();
    this.textarea.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._createShtoot();
      }
    };
    this._registerServiceWorker();
    this._requestNotificationPermission();
    this._connectWs();
    initKeys(this.userID, this.apiUrl).then(keys => {
      if (keys) {
        this.cryptoKeys = keys;
      } else {
        this._showKeySetup();
      }
    }).catch(() => {});

    this.shadowRoot.getElementById('new-key-btn').onclick = () => this._createNewKey();
    this.shadowRoot.getElementById('import-key-btn').onclick = () => {
      this.shadowRoot.getElementById('key-setup-choice').style.display = 'none';
      this.shadowRoot.getElementById('key-import-form').style.display = 'block';
    };
    this.shadowRoot.getElementById('setup-back-btn').onclick = () => {
      this.shadowRoot.getElementById('key-import-form').style.display = 'none';
      this.shadowRoot.getElementById('key-setup-choice').style.display = 'flex';
      this.shadowRoot.getElementById('setup-error').textContent = '';
    };
    this.shadowRoot.getElementById('setup-import-btn').onclick = () => this._importKey();
  }

  async _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.register('/peh/sw.js');
      } catch (e) {
        console.log('Service worker registration failed:', e);
      }
    }
  }

  _requestNotificationPermission() {
    if (!this.notificationRequested && 'Notification' in window && Notification.permission === 'default') {
      this.notificationRequested = true;
      Notification.requestPermission();
    }
  }

  _notify(shtoot) {
    if ('Notification' in window && Notification.permission === 'granted' && shtoot.userID !== this.userID && shtoot.timestamp > this.connectedAt) {
      const options = {
        body: shtoot.text,
        tag: shtoot.ID
      };
      if (this.swRegistration) {
        this.swRegistration.showNotification(shtoot.userID, options);
      } else {
        try {
          new Notification(shtoot.userID, options);
        } catch (e) {}
      }
    }
  }

  disconnectedCallback() {
    if (this.ws) this.ws.close();
  }

  decodeJwtResponse(token) {
    let base64Url = token.split('.')[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    let jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
  }

  _getSpaceFromRoute() {
    const params = new URLSearchParams(window.location.search);
    return params.get('space');
  }

  _renderShtoots() {
    const filtered = this.shtoots.filter(s =>
      this.space ? s.space === this.space : !s.space
    );
    this.listEl.innerHTML = filtered.map(s => {
      let displayText;
      if (s._encrypted) {
        displayText = `🔒 ${this._linkify(s.text)}`;
      } else if (this._is1to1Space(this.space)) {
        displayText = `${this._linkify(s.text)}<span class="warn">⚠️</span>`;
      } else {
        displayText = this._linkify(s.text);
      }
      return `<div class="shtoot${s.userID === this.userID ? ' mine' : ''}">
        <span>${displayText}</span>
        <div class="meta">${this._escapeHtml(s.userID)} @ ${new Date(Number(s.timestamp)).toLocaleTimeString()}</div>
      </div>`;
    }).join('');
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => (
      { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s] || s
    ));
  }

  _linkify(str) {
    const urlPattern = /(https?:\/\/[^\s<]+)/g;
    return this._escapeHtml(str).replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  _connectWs() {
    this.ws = new WebSocket(this.wsUrl, 'graphql-transport-ws');
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'connection_init',
        payload: { Authorization: `Bearer ${this.jwt}` }
      }));
    };
    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connection_ack' && !this.subscribed) {
          this.ws.send(JSON.stringify({
            id: '1',
            type: 'subscribe',
            payload: {
              query: `subscription { shtootAdded { ID userID text timestamp space } }`
            }
          }));
          this.subscribed = true;
        }
        if (msg.type === 'next' && msg.id === '1' && msg.payload && msg.payload.data && msg.payload.data.shtootAdded) {
          const shtoot = msg.payload.data.shtootAdded;
          try {
            const parsed = JSON.parse(shtoot.text);
            if (parsed && parsed.e2e === 1) {
              const keys = this.cryptoKeys || await getStoredKeys(this.userID);
              if (keys) {
                shtoot.text = await decryptMessage(shtoot.text, keys.privateKey);
                shtoot._encrypted = true;
              }
            }
          } catch (_) {}
          this.shtoots.push(shtoot);
          this._renderShtoots();
          this._notify(shtoot);
        }
        if (msg.type === 'complete') {
          this.errorEl.textContent = 'Subscription ended';
        }
        if (msg.type === 'error') {
          this.errorEl.textContent = 'Subscription error: ' + JSON.stringify(msg.payload);
        }
      } catch (e) {
        this.errorEl.textContent = 'Bad WS message: ' + e;
      }
    };
    this.ws.onerror = (e) => {
      this.errorEl.textContent = 'WebSocket error';
    };
    this.ws.onclose = (e) => {
      this.errorEl.textContent = 'WebSocket closed: ' + (e.reason || e.code);
    };
  }

  async _createShtoot() {
    let text = this.textarea.value.trim();
    this.errorEl.textContent = '';
    if (!text) return;
    try {
      if (this._is1to1Space(this.space)) {
        const keys = this.cryptoKeys || await getStoredKeys(this.userID);
        if (keys) {
          const recipientEmail = this._getRecipientEmail(this.space) || this.userID;
          text = await encryptForSpace(text, this.userID, recipientEmail, keys, this.apiUrl);
        }
      }
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.jwt}`
        },
        body: JSON.stringify({
          query: `mutation($userID: ID!, $text: String!, $space: String) {
            createShtoot(userID: $userID, text: $text, space: $space) { ID userID text timestamp }
          }`,
          variables: { userID: this.userID, text, space: this.space || '' },
        }),
      });
      const json = await res.json();
      if (json.errors) {
        this.errorEl.textContent = json.errors[0].message;
      } else {
        this.textarea.value = '';
      }
    } catch (err) {
      this.errorEl.textContent = 'Network error: ' + err;
    }
  }

  _showKeySetup() {
    this.shadowRoot.getElementById('key-setup').classList.add('open');
  }

  _hideKeySetup() {
    this.shadowRoot.getElementById('key-setup').classList.remove('open');
  }

  async _createNewKey() {
    const btn = this.shadowRoot.getElementById('new-key-btn');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      this.cryptoKeys = await createNewKey(this.userID, this.apiUrl);
      this._hideKeySetup();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'This is my first device';
    }
  }

  async _importKey() {
    const blob = this.shadowRoot.getElementById('setup-blob').value.trim();
    const pin = this.shadowRoot.getElementById('setup-pin').value.trim();
    const errEl = this.shadowRoot.getElementById('setup-error');
    errEl.textContent = '';

    if (!blob || !pin) {
      errEl.textContent = 'Please enter both the blob and PIN.';
      return;
    }

    const btn = this.shadowRoot.getElementById('setup-import-btn');
    btn.disabled = true;
    btn.textContent = 'Importing…';

    try {
      await importKeyBundle(blob, pin, this.userID);
      this.cryptoKeys = await initKeys(this.userID, this.apiUrl);
      this._hideKeySetup();
    } catch (_) {
      errEl.textContent = 'Import failed — check your blob and PIN.';
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  }

  _is1to1Space(space) {
    return !!space && space.split(',').length === 2;
  }

  _getRecipientEmail(space) {
    return space.split(',').find(e => e !== this.userID);
  }
}

customElements.define('shtoot-peh', ShtootPeh);
