// Channel.js — the physical medium between sender and receiver.
// Owns every item currently "in flight" (a data packet or an ACK),
// advances their progress over time, and enforces half/full duplex rules.

let uid = 0;

export class Channel {
  constructor({ mode = 'full', baseDurationMs = 1800 } = {}) {
    this.mode = mode; // 'half' | 'full'
    this.baseDurationMs = baseDurationMs;
    this.items = new Map(); // id -> item
  }

  setMode(mode) {
    this.mode = mode;
  }

  setBaseDuration(ms) {
    this.baseDurationMs = ms;
  }

  // In half duplex only one direction may be "occupied" at a time.
  // We treat the channel as busy if ANY item is currently travelling.
  isBusy(direction) {
    if (this.mode === 'full') return false;
    for (const item of this.items.values()) {
      if (!item.arrived && !item.lost) return true;
    }
    return false;
  }

  canSend(direction) {
    return !this.isBusy(direction);
  }

  _push(item) {
    this.items.set(item.id, item);
    return item;
  }

  sendData(packet, { speedMultiplier = 1 } = {}) {
    const item = {
      id: `pkt-${packet.seq}-${++uid}`,
      kind: 'data',
      seq: packet.seq,
      direction: 'down', // sender -> receiver
      progress: 0,
      durationMs: this.baseDurationMs / speedMultiplier,
      arrived: false,
      lost: false,
      createdAt: performance.now()
    };
    return this._push(item);
  }

  sendAck(ackNum, { speedMultiplier = 1, duplicate = false } = {}) {
    const item = {
      id: `ack-${ackNum}-${++uid}`,
      kind: 'ack',
      seq: ackNum,
      direction: 'up', // receiver -> sender
      progress: 0,
      durationMs: this.baseDurationMs / speedMultiplier,
      arrived: false,
      lost: false,
      duplicate,
      createdAt: performance.now()
    };
    return this._push(item);
  }

  // Mark an in-flight item as lost (user-triggered "packet loss").
  markLost(id) {
    const item = this.items.get(id);
    if (item && !item.arrived) {
      item.lost = true;
      return item;
    }
    return null;
  }

  // Advance every item by dtMs. Returns { arrivedData, arrivedAcks, lost }.
  tick(dtMs) {
    const arrivedData = [];
    const arrivedAcks = [];
    const lost = [];

    for (const item of this.items.values()) {
      if (item.arrived || item.lost) continue;
      item.progress += dtMs / item.durationMs;
      if (item.progress >= 1) {
        item.progress = 1;
        item.arrived = true;
        if (item.kind === 'data') arrivedData.push(item);
        else arrivedAcks.push(item);
      }
    }

    // Sweep out items that have been resolved (arrived or lost) after
    // giving the UI a moment to animate them; the UI removes stale DOM
    // nodes itself, here we just keep the data model tidy.
    for (const [id, item] of this.items) {
      if (item.lost) lost.push(item);
    }

    return { arrivedData, arrivedAcks, lost };
  }

  remove(id) {
    this.items.delete(id);
  }

  clear() {
    this.items.clear();
  }
}
