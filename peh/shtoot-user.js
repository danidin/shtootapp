import { getStoredKeys, exportKeyBundle, importKeyBundle, clearStoredKey, initKeys } from './crypto.js';

class ShtootUser extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.jwt = localStorage.getItem('jwt');
    const payload = this.decodeJwtResponse(this.jwt);
    this.email = payload.email;
    this.name = payload.name || this.email;
    this.picture = payload.picture;
    this.isDev = new URLSearchParams(window.location.search).get('dev') === 'true';
    this.apiUrl = this.isDev ? 'http://localhost:4000/graphql' : 'https://api.shtoot.net/graphql';
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
          display: block;
          width: 100%;
          text-align: left;
        }
        button:hover { background: #f0f0f0; }
        .modal {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5);
          z-index: 100;
          justify-content: center;
          align-items: center;
        }
        .modal.open { display: flex; }
        .modal-content {
          background: white;
          padding: 20px;
          border-radius: 8px;
          max-width: 420px;
          width: 90%;
          font-family: sans-serif;
        }
        .modal-content h3 { margin-top: 0; font-size: 16px; }
        .modal-content p { font-size: 13px; margin: 6px 0; }
        .modal-content textarea {
          width: 100%;
          height: 90px;
          font-size: 11px;
          font-family: monospace;
          box-sizing: border-box;
          resize: vertical;
        }
        .modal-content input[type=text] {
          width: 100%;
          padding: 6px;
          margin: 8px 0;
          box-sizing: border-box;
          font-size: 18px;
          letter-spacing: 4px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        .pin {
          font-size: 28px;
          font-weight: bold;
          letter-spacing: 6px;
          margin: 8px 0;
          color: #0066cc;
        }
        .btn-row {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }
        .btn-row button {
          margin-top: 0;
          width: auto;
          flex: 1;
        }
        .btn-primary {
          background: #0066cc;
          color: white;
          border-color: #0066cc;
        }
        .btn-primary:hover { background: #0052a3; }
        .error { color: red; font-size: 0.85em; margin-top: 6px; }
      </style>
      <div class="user-badge">
        ${this.picture ? `<img class="avatar" src="${this._escapeHtml(this.picture)}" alt="avatar">` : '<div class="avatar"></div>'}
        <div class="user-info">
          <span class="user-name">${this._escapeHtml(this.name)}</span>
          <span class="user-email">${this._escapeHtml(this.email)}</span>
        </div>
      </div>
      <button id="logout">Log Out</button>
      <button id="export-key">Export key…</button>
      <button id="import-key">Import key…</button>

      <div class="modal" id="export-modal">
        <div class="modal-content">
          <h3>Export Key to New Device</h3>
          <p>Copy this blob to your new device:</p>
          <textarea id="export-blob" readonly></textarea>
          <p>PIN: <span class="pin" id="export-pin"></span></p>
          <p><small>Keep the PIN separate from the blob. You'll need both to import on the new device.</small></p>
          <div class="btn-row">
            <button class="btn-primary" id="copy-blob">Copy blob</button>
            <button id="close-export">Close</button>
          </div>
        </div>
      </div>

      <div class="modal" id="import-modal">
        <div class="modal-content">
          <h3>Import Key from Another Device</h3>
          <p>Paste the blob from your old device:</p>
          <textarea id="import-blob" placeholder="Paste blob here…"></textarea>
          <input type="text" id="import-pin" placeholder="PIN" maxlength="6" inputmode="numeric">
          <div id="import-error" class="error"></div>
          <div class="btn-row">
            <button class="btn-primary" id="do-import">Import</button>
            <button id="close-import">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    this.shadowRoot.getElementById('logout').onclick = () => {
      localStorage.setItem('jwt', '');
      window.location = '/peh/login';
    };

    this.shadowRoot.getElementById('export-key').onclick = () => this._doExport();
    this.shadowRoot.getElementById('import-key').onclick = () => {
      this.shadowRoot.getElementById('import-modal').classList.add('open');
    };

    this.shadowRoot.getElementById('close-export').onclick = () => {
      this.shadowRoot.getElementById('export-modal').classList.remove('open');
    };
    this.shadowRoot.getElementById('copy-blob').onclick = () => {
      const blob = this.shadowRoot.getElementById('export-blob').value;
      navigator.clipboard.writeText(blob).then(() => {
        const btn = this.shadowRoot.getElementById('copy-blob');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy blob'; }, 2000);
      });
    };

    this.shadowRoot.getElementById('close-import').onclick = () => {
      this.shadowRoot.getElementById('import-modal').classList.remove('open');
      this.shadowRoot.getElementById('import-error').textContent = '';
    };
    this.shadowRoot.getElementById('do-import').onclick = () => this._doImport();
  }

  async _doExport() {
    const stored = await getStoredKeys();
    if (!stored) {
      alert('No encryption key found. Send a message first to generate one.');
      return;
    }
    try {
      const { blob, pin } = await exportKeyBundle(stored);
      this.shadowRoot.getElementById('export-blob').value = blob;
      this.shadowRoot.getElementById('export-pin').textContent = pin;
      this.shadowRoot.getElementById('export-modal').classList.add('open');
    } catch (e) {
      if (e.name === 'InvalidAccessError') {
        const ok = confirm(
          'Your key was created before migration was supported and cannot be exported.\n\n' +
          'You can generate a new key to enable migration, but existing encrypted messages will no longer be readable.\n\n' +
          'Generate a new key?'
        );
        if (ok) await this._regenerateKey();
      } else {
        alert('Export failed: ' + e.message);
      }
    }
  }

  async _regenerateKey() {
    await clearStoredKey();
    await initKeys(this.email, this.apiUrl);
    alert('New key generated. You can now use "Export key" to migrate to another device.');
  }

  async _doImport() {
    const blob = this.shadowRoot.getElementById('import-blob').value.trim();
    const pin = this.shadowRoot.getElementById('import-pin').value.trim();
    const errEl = this.shadowRoot.getElementById('import-error');
    errEl.textContent = '';

    if (!blob || !pin) {
      errEl.textContent = 'Please enter both the blob and PIN.';
      return;
    }

    const btn = this.shadowRoot.getElementById('do-import');
    btn.disabled = true;
    btn.textContent = 'Importing…';

    try {
      await importKeyBundle(blob, pin);
      await initKeys(this.email, this.apiUrl);
      alert('Key imported! The page will reload.');
      window.location.reload();
    } catch (_) {
      errEl.textContent = 'Import failed — check your blob and PIN.';
      btn.disabled = false;
      btn.textContent = 'Import';
    }
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
