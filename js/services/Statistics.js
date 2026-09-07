// Statistics.js — running counters for the stats panel.

export class Statistics {
  constructor({ onChange } = {}) {
    this.onChange = onChange || (() => {});
    this.reset();
  }

  reset() {
    this.sent = 0;          // total data-packet sends (incl. retransmissions)
    this.uniqueSent = 0;    // distinct sequence numbers sent at least once
    this.received = 0;      // accepted by the receiver
    this.lost = 0;
    this.retransmitted = 0;
    this.acksSent = 0;
    this.acksReceived = 0;
    this.timeouts = 0;
    this._seenSeqs = new Set();
    this._emit();
  }

  recordSent(seq) {
    this.sent += 1;
    if (!this._seenSeqs.has(seq)) {
      this._seenSeqs.add(seq);
      this.uniqueSent += 1;
    } else {
      this.retransmitted += 1;
    }
    this._emit();
  }

  recordReceived() {
    this.received += 1;
    this._emit();
  }

  recordLost() {
    this.lost += 1;
    this._emit();
  }

  recordAckSent() {
    this.acksSent += 1;
    this._emit();
  }

  recordAckReceived() {
    this.acksReceived += 1;
    this._emit();
  }

  recordTimeout() {
    this.timeouts += 1;
    this._emit();
  }

  efficiency() {
    if (this.sent === 0) return 0;
    return Math.round((this.uniqueSent / this.sent) * 100);
  }

  _emit() {
    this.onChange({
      sent: this.sent,
      received: this.received,
      lost: this.lost,
      retransmitted: this.retransmitted,
      acksSent: this.acksSent,
      acksReceived: this.acksReceived,
      timeouts: this.timeouts,
      efficiency: this.efficiency()
    });
  }
}
