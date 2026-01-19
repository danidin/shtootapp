class ShtootSpaceSelector extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shtoots = [];
    this.jwt = localStorage.getItem('jwt');
    this.userID = this.decodeJwtResponse(this.jwt).email;
    this.isDev = new URLSearchParams(window.location.search).get('dev') === 'true';
    this.wsUrl = this.isDev ? 'ws://localhost:4000/graphql' : 'wss://api.shtoot.net/graphql';
    this.ws = null;
    this.subscribed = false;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .space-list { list-style: none; margin: 0; padding: 0; font-family: sans-serif; }
        .space-item { padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #eee; }
        .space-item:hover { background: #f0f0f0; }
        .space-item.active { background: #e0e7ff; }
      </style>
      <ul class="space-list"></ul>
    `;
  }

  connectedCallback() {
    this.listEl = this.shadowRoot.querySelector('.space-list');
    this._renderSpaces();
    this._connectWs();
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

  _getSpaces() {
    const spaces = new Set();
    this.shtoots.forEach(s => {
      if (s.space) spaces.add(s.space);
    });
    return Array.from(spaces);
  }

  _formatSpaceTitle(space) {
    return space
      .split(',')
      .filter(email => email.trim() !== this.userID)
      .join(', ') || space;
  }

  _renderSpaces() {
    const currentSpace = new URLSearchParams(window.location.search).get('space');
    const spaces = this._getSpaces();

    const publicActive = !currentSpace ? 'active' : '';
    let html = `<li class="space-item ${publicActive}" data-space="">Public</li>`;

    html += spaces.map(space => {
      const isActive = space === currentSpace ? 'active' : '';
      const title = this._escapeHtml(this._formatSpaceTitle(space));
      return `<li class="space-item ${isActive}" data-space="${this._escapeHtml(space)}">${title}</li>`;
    }).join('');

    this.listEl.innerHTML = html;

    this.listEl.querySelectorAll('.space-item').forEach(item => {
      item.onclick = () => {
        const space = item.dataset.space;
        const params = new URLSearchParams(window.location.search);
        if (space) {
          params.set('space', space);
        } else {
          params.delete('space');
        }
        window.location.search = params.toString();
      };
    });
  }

  _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => (
      { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s] || s
    ));
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
          this.shtoots.push(msg.payload.data.shtootAdded);
          this._renderSpaces();
        }
      } catch (e) {
        console.error('ShtootSpaceSelector WS error:', e);
      }
    };
    this.ws.onerror = (e) => console.error('WebSocket error', e);
    this.ws.onclose = (e) => console.log('WebSocket closed', e.code);
  }
}

customElements.define('shtoot-space-selector', ShtootSpaceSelector);
