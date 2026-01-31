class ShtootAddContact extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.jwt = localStorage.getItem('jwt');
    this.userEmail = this.decodeJwtResponse(this.jwt).email;
    this.showInput = false;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 8px 12px; border-bottom: 1px solid #eee; }
        .add-btn {
          background: none;
          border: 1px dashed #0066cc;
          color: #0066cc;
          padding: 8px 12px;
          width: 100%;
          cursor: pointer;
          border-radius: 4px;
          font-size: 14px;
        }
        .add-btn:hover { background: #f0f7ff; }
        .input-row {
          display: none;
          gap: 8px;
        }
        .input-row.show { display: flex; }
        input {
          flex: 1;
          min-width: 0;
          padding: 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
        }
        .go-btn {
          padding: 8px 12px;
          background: #0066cc;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .go-btn:hover { background: #0052a3; }
      </style>
      <button class="add-btn">+ Add Contact</button>
      <div class="input-row">
        <input type="email" placeholder="Email address">
        <button class="go-btn">Go</button>
      </div>
    `;
  }

  connectedCallback() {
    this.addBtn = this.shadowRoot.querySelector('.add-btn');
    this.inputRow = this.shadowRoot.querySelector('.input-row');
    this.input = this.shadowRoot.querySelector('input');
    const goBtn = this.shadowRoot.querySelector('.go-btn');

    this.addBtn.onclick = () => {
      this.addBtn.style.display = 'none';
      this.inputRow.classList.add('show');
      this.input.focus();
    };

    goBtn.onclick = () => this._addContact(this.input.value);
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter') this._addContact(this.input.value);
      if (e.key === 'Escape') this._closeInput();
    };

    this._onClickOutside = (e) => {
      if (!this.contains(e.target)) this._closeInput();
    };
    document.addEventListener('click', this._onClickOutside);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._onClickOutside);
  }

  _closeInput() {
    this.inputRow.classList.remove('show');
    this.addBtn.style.display = '';
    this.input.value = '';
  }

  _addContact(email) {
    email = email.trim();
    if (!email) return;
    const space = [this.userEmail, email].sort().join(',');
    const params = new URLSearchParams(window.location.search);
    params.set('space', space);
    window.location.search = params.toString();
  }

  decodeJwtResponse(token) {
    let base64Url = token.split('.')[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    let jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  }
}

customElements.define('shtoot-add-contact', ShtootAddContact);
