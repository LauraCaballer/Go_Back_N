// Sender.js — the GBN sending side.
// Owns the packet array + sliding window, decides what can be sent,
// runs the single retransmission timer bound to `base`, and applies
// cumulative ACKs.

import { Packet } from './Packet.js';
import { SlidingWindow } from './SlidingWindow.js';

export class Sender {
  constructor({ totalPackets, windowSize, timeoutMs, onEvent }) {
    this.totalPackets = totalPackets;
    this.window = new SlidingWindow(windowSize, totalPackets);
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent || (() => {});
    this.packets = this._buildPackets(totalPackets);
    this.timerElapsed = 0;   // ms elapsed on the current base timer
    this.timerActive = false;
  }

  _buildPackets(total) {
    return Array.from({ length: total }, (_, i) => new Packet(i));
  }

  setTotalPackets(total) {
    this.totalPackets = total;
    this.packets = this._buildPackets(total);
    this.window.setTotalPackets(total);
    this.stopTimer();
  }

  setWindowSize(size) {
    this.window.resize(size);
  }

  setTimeout(ms) {
    this.timeoutMs = ms;
  }

  // ---- sending -----------------------------------------------------

  canSendNext() {
    return this.window.canSend();
  }

  nextSeqToSend() {
    return this.window.canSend() ? this.window.nextSeqNum : null;
  }

  // Called once the channel has actually accepted the packet.
  registerSent(seq) {
    const packet = this.packets[seq];
    packet.markSent();
    this.window.advanceNext();
    if (!this.timerActive) this.startTimer();
    this.onEvent('data-sent', { seq, attempts: packet.attempts });
  }

  markInTransit(seq) {
    this.packets[seq].markInTransit();
  }

  // ---- timer ---------------------------------------------------------

  startTimer() {
    this.timerActive = true;
    this.timerElapsed = 0;
  }

  stopTimer() {
    this.timerActive = false;
    this.timerElapsed = 0;
  }

  // Advance the base timer by dtMs; returns true if a timeout fired.
  tickTimer(dtMs) {
    if (!this.timerActive) return false;
    this.timerElapsed += dtMs;
    if (this.timerElapsed >= this.timeoutMs) {
      this.stopTimer();
      return true;
    }
    return false;
  }

  timerProgress() {
    if (!this.timerActive) return 0;
    return Math.min(1, this.timerElapsed / this.timeoutMs);
  }

  // Packets that must be retransmitted right now: base .. nextSeqNum-1.
  packetsToRetransmit() {
    const list = [];
    for (let s = this.window.base; s < this.window.nextSeqNum; s++) {
      list.push(this.packets[s]);
    }
    return list;
  }

  onTimeout() {
    const range = this.packetsToRetransmit();

    this.onEvent('timeout', {
        base: this.window.base,
        upTo: this.window.nextSeqNum - 1
    });

    // El temporizador vuelve a comenzar para el paquete base.
    if (this.window.base < this.window.nextSeqNum) {
        this.startTimer();
    }

    return range;
}

  // ---- ACK handling ----------------------------------------------------

  handleAck(ackNum) {
    if (ackNum < this.window.base) {
      // Duplicate / stale ACK — window doesn't move.
      this.onEvent('ack-stale', { ackNum, base: this.window.base });
      return { moved: false };
    }
    const previousBase = this.window.base;
    for (let s = previousBase; s <= ackNum; s++) {
      if (this.packets[s]) this.packets[s].markAcked();
    }
    this.window.slideTo(ackNum);
    this.onEvent('ack-applied', { ackNum, newBase: this.window.base });

    if (this.window.base >= this.window.nextSeqNum) {
      this.stopTimer();
    } else {
      // Still unacked packets outstanding — restart the timer for the new base.
      this.startTimer();
    }
    return { moved: this.window.base !== previousBase };
  }

  isFinished() {
    return this.window.isFinished();
  }

  reset(totalPackets, windowSize) {
    this.totalPackets = totalPackets;
    this.packets = this._buildPackets(totalPackets);
    this.window = new SlidingWindow(windowSize, totalPackets);
    this.stopTimer();
  }
}