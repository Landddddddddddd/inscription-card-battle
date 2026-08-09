// Online (WAN) peer-to-peer transport — no backend server required.
//
// Two connection modes, both exposing the SAME simple channel API so main.js
// can treat them identically once connected:
//   - PeerJS mode (一键邀请):  a public signaling broker pairs a host "peer id"
//     (the room code) with the guest. Smooth, but depends on the broker.
//   - Manual mode (邀请码):    raw WebRTC + public STUN. The host generates an
//     "offer" code, the guest pastes it and returns an "answer" code. Works with
//     zero external services — the most reliable option behind strict networks.
//
// Unified API:
//   const net = new OnlineNet({ isHost, roomCode, manual, onMessage, onOpen, onClose, onError, onStatus });
//   await net.connect();            // establish the data channel
//   net.send(obj);                  // JSON over the channel
//   net.close();
//   net.inviteLink                  // shareable URL (PeerJS room code, or manual offer)
//   net.offerStr / net.answerStr    // populated in manual mode for the UI to show
//   net.acceptAnswer(str)           // manual host: apply the pasted answer
// Message shape (application-level) is defined in main.js.

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Lazily inject the PeerJS client from CDN (only when PeerJS mode is used).
function loadPeerJS() {
  return new Promise((resolve, reject) => {
    if (window.Peer) return resolve(window.Peer);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS 加载失败')));
    s.onerror = () => reject(new Error('PeerJS 脚本加载失败（网络不可达）'));
    document.head.appendChild(s);
  });
}

function waitIceComplete(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    let done = false;
    const fin = () => { if (!done) { done = true; pc.removeEventListener('icegatheringstatechange', fin); resolve(); } };
    pc.addEventListener('icegatheringstatechange', fin);
    // Safety timeout: some networks never reach "complete"; ship what we have.
    setTimeout(fin, 2500);
  });
}

export class OnlineNet {
  constructor(opts = {}) {
    this.isHost = !!opts.isHost;
    this.roomCode = (opts.roomCode || '').toUpperCase();
    this.manual = !!opts.manual;
    this.onMessage = opts.onMessage || (() => {});
    this.onOpen = opts.onOpen || (() => {});
    this.onClose = opts.onClose || (() => {});
    this.onError = opts.onError || (() => {});
    this.onStatus = opts.onStatus || (() => {});

    this.peer = null;     // PeerJS instance
    this.pc = null;       // RTCPeerConnection (manual)
    this.dc = null;       // RTCDataChannel
    this.offerStr = null;
    this.answerStr = null;
    this._open = false;
    this.inviteLink = location.origin + location.pathname + (this.manual ? '' : '?join=' + this.roomCode);
  }

  async connect() {
    if (this.manual) return this._connectManual();
    return this._connectPeer();
  }

  // Normalize a native RTCDataChannel OR a PeerJS DataConnection to our API.
  // Native uses onopen/onmessage property setters and raw string frames; PeerJS
  // uses the EventEmitter .on('open'/'data') API and serializes JSON for us.
  _attachChannel(ch) {
    const isPeer = (typeof ch.on === 'function');
    this.dc = ch;
    if (isPeer) {
      this._send = (obj) => ch.send(obj);            // PeerJS serializes
      ch.on('open', () => { this._open = true; this.onOpen(); });
      ch.on('data', (data) => { this.onMessage(typeof data === 'string' ? this._safeParse(data) : data); });
      ch.on('close', () => { this._open = false; this.onClose(); });
      ch.on('error', (e) => this.onError(e));
    } else {
      this._send = (obj) => ch.send(JSON.stringify(obj));
      ch.onopen = () => { this._open = true; this.onOpen(); };
      ch.onclose = () => { this._open = false; this.onClose(); };
      ch.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (_) { return; }
        this.onMessage(m);
      };
    }
  }

  _encode(desc) { return btoa(unescape(encodeURIComponent(JSON.stringify(desc)))); }
  _decode(str) { return JSON.parse(decodeURIComponent(escape(atob(str)))); }
  _safeParse(str) { try { return JSON.parse(str); } catch (_) { return null; } }

  // ---------------- PeerJS mode ----------------
  async _connectPeer() {
    const Peer = await loadPeerJS();
    this.peer = new Peer(this.isHost ? this.roomCode : undefined);
    this.peer.on('error', (err) => this.onError(err));
    if (this.isHost) {
      this.peer.on('connection', (conn) => { this._attachChannel(conn); });
      this.onStatus('wait', { roomCode: this.roomCode, link: this.inviteLink });
    } else {
      this.peer.on('open', () => {
        const conn = this.peer.connect(this.roomCode, { reliable: true });
        this._attachChannel(conn);
        this.onStatus('connecting');
      });
    }
  }

  // ---------------- Manual (raw WebRTC) mode ----------------
  async _connectManual() {
    this.pc = new RTCPeerConnection({ iceServers: ICE });
    if (this.isHost) {
      this.dc = this.pc.createDataChannel('game');
      this._attachChannel(this.dc);
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await waitIceComplete(this.pc);
      this.offerStr = this._encode(this.pc.localDescription);
      this.inviteLink = location.origin + location.pathname + '?m=' + encodeURIComponent(this.offerStr);
      this.onStatus('offer', { offer: this.offerStr, link: this.inviteLink });
    } else {
      // Guest: offer is supplied via connectWithOffer(offerStr) — see below.
      this.pc.ondatachannel = (e) => this._attachChannel(e.channel);
    }
  }

  // Guest side: provide the host's offer string (pasted or from ?m= link).
  async connectWithOffer(offerStr) {
    if (!this.manual) return this.connect();
    if (this.pc == null) await this._connectManual();
    const desc = this._decode(offerStr);
    await this.pc.setRemoteDescription(desc);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitIceComplete(this.pc);
    this.answerStr = this._encode(this.pc.localDescription);
    this.onStatus('answer', { answer: this.answerStr });
  }

  // Host side: apply the guest's pasted answer string to complete the handshake.
  async acceptAnswer(answerStr) {
    if (!this.manual || !this.pc) return;
    try {
      const desc = this._decode(answerStr);
      await this.pc.setRemoteDescription(desc);
      this.onStatus('connecting');
    } catch (e) { this.onError(e); }
  }

  send(obj) {
    if (this._open && this._send) {
      try { this._send(obj); return true; } catch (_) {}
    }
    return false;
  }

  close() {
    try { if (this.dc) this.dc.close(); } catch (_) {}
    try { if (this.pc) this.pc.close(); } catch (_) {}
    try { if (this.peer) this.peer.destroy(); } catch (_) {}
    this._open = false;
  }
}
