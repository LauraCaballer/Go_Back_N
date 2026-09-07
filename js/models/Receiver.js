// Receiver.js — the GBN receiving side.
// Only accepts packets strictly in order (expectedSeqNum); anything
// else is discarded and answered with a duplicate cumulative ACK.

export class Receiver {
  constructor({ onEvent } = {}) {
    this.expectedSeqNum = 0;
    this.onEvent = onEvent || (() => {});
    this.receivedLog = []; // sequence numbers accepted, in order
  }

  // Returns { accepted: boolean, ackNum: number|null }
  handlePacket(seq) {
    if (seq === this.expectedSeqNum) {
      this.receivedLog.push(seq);
      const ackNum = this.expectedSeqNum;
      this.expectedSeqNum += 1;
      this.onEvent('packet-accepted', { seq, ackNum });
      return { accepted: true, ackNum };
    }

    // Out of order (either ahead of what we expect, or a stale duplicate).
    const ackNum = this.expectedSeqNum - 1; // -1 means "nothing acked yet"
    this.onEvent('packet-discarded', { seq, expected: this.expectedSeqNum, ackNum });
    return { accepted: false, ackNum };
  }

  reset() {
    this.expectedSeqNum = 0;
    this.receivedLog = [];
  }
}
