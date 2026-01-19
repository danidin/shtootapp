class ShtootUser extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.jwt = localStorage.getItem('jwt');
    const payload = this.decodeJwtResponse(this.jwt);
    this.email = payload.email;
    this.name = payload.name || this.email;
    this.picture = payload.picture;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .user-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          font-family: sans-serif;
        }
        .avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #ccc;
        }
        .user-info {
          display: flex;
          flex-direction: column;
        }
        .user-name {
          font-weight: 500;
          font-size: 14px;
        }
        .user-email {
          font-size: 12px;
          color: #666;
        }
        button {
          margin-top: 8px;
          padding: 6px 12px;
          cursor: pointer;
          border: 1px solid #ccc;
          background: #fff;
          border-radius: 4px;
        }
        button:hover {
          background: #f0f0f0;
        }
      </style>
      <div class="user-badge">
        ${this.picture ? `<img class="avatar" src="${this._escapeHtml(this.picture)}" alt="avatar">` : '<div class="avatar"></div>'}
        <div class="user-info">
          <span class="user-name">${this._escapeHtml(this.name)}</span>
          <span class="user-email">${this._escapeHtml(this.email)}</span>
        </div>
      </div>
      <button id="logout">Log Out</button>
    `;
  }

  connectedCallback() {
    this.shadowRoot.getElementById('logout').onclick = () => {
      localStorage.setItem('jwt', '');
      window.location = '/peh/login';
    };
  }

  decodeJwtResponse(token) {
    let base64Url = token.split('.')[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    let jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  }

  _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => (
      { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s] || s
    ));
  }
}

customElements.define('shtoot-user', ShtootUser);
