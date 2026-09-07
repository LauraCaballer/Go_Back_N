// SlidingWindow.js — tracks base / nextSeqNum and the window bounds
// over a fixed universe of sequence numbers [0, totalPackets).

export class SlidingWindow {
  constructor(size, totalPackets) {
    this.size = size;
    this.totalPackets = totalPackets;
    this.base = 0;
    this.nextSeqNum = 0;
  }

  resize(newSize) {
    this.size = Math.max(1, Math.min(newSize, this.totalPackets));
  }

  setTotalPackets(total) {
    this.totalPackets = total;
    this.base = Math.min(this.base, total);
    this.nextSeqNum = Math.min(this.nextSeqNum, total);
  }

  // Is `seq` currently inside [base, base+size)?
  isInWindow(seq) {
    return seq >= this.base && seq < this.base + this.size;
  }

  // Can we send nextSeqNum right now?
  canSend() {
    return this.nextSeqNum < this.base + this.size && this.nextSeqNum < this.totalPackets;
  }

  advanceNext() {
    if (this.nextSeqNum < this.totalPackets) this.nextSeqNum += 1;
  }

  // Cumulative ACK: slide base to ackNum + 1.
  slideTo(ackNum) {
    if (ackNum + 1 > this.base) this.base = ackNum + 1;
  }

  isFinished() {
    return this.base >= this.totalPackets;
  }

  reset() {
    this.base = 0;
    this.nextSeqNum = 0;
  }
}
