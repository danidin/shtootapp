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
      </style>
      <div class="shtoots"></div>
      <textarea placeholder="Say a Shtoot..."></textarea><br/>
      <button>Send</button>
      <div class="error"></div>
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
    this.listEl.innerHTML = filtered.map(s =>
      `<div class="shtoot${s.userID === this.userID ? ' mine' : ''}">
        <span>${this._linkify(s.text)}</span>
        <div class="meta">${this._escapeHtml(s.userID)} @ ${new Date(Number(s.timestamp)).toLocaleTimeString()}</div>
      </div>`
    ).join('');
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
    this.ws.onmessage = (event) => {
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
    const text = this.textarea.value.trim();
    this.errorEl.textContent = '';
    if (!text) return;
    try {
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
}

customElements.define('shtoot-peh', ShtootPeh);
