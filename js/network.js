// LAN client: Server-Sent Events for state push + plain POST for actions.
// No external libraries.

export class NetClient {
  constructor(room, token, side, onState, onStart) {
    this.room = room;
    this.token = token;
    this.side = side;
    this.onState = onState;
    this.onStart = onStart;
    this.ready = false;
    this.es = null;
  }

  connect() {
    const url = `/api/events?room=${encodeURIComponent(this.room)}&token=${encodeURIComponent(this.token)}`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'state') {
        this.onState(msg.state, msg.you);
      } else if (msg.type === 'start') {
        this.ready = true;
        if (this.onStart) this.onStart();
      }
    };
    this.es = es;
  }

  send(action) {
    return fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: this.room, token: this.token, action }),
    });
  }

  close() { if (this.es) this.es.close(); }
}
