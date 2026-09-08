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

  // Selective Repeat: la base solo avanza mientras haya una racha CONTIGUA
  // de paquetes ya confirmados empezando justo en `base` (a diferencia de
  // Go-Back-N, un ACK individual no mueve la base si el paquete `base`
  // en sí sigue sin confirmar). `isAcked(seq)` es un predicado que consulta
  // el estado real del paquete.
  advanceBaseWhileAcked(isAcked) {
    while (this.base < this.nextSeqNum && isAcked(this.base)) {
      this.base += 1;
    }
  }

  // Máximo de secuencia distinguible dado el número de bits `m` (rango
  // 0..2^m - 1). Go-Back-N puede usar ventanas de hasta 2^m - 1; Selective
  // Repeat, al no ser acumulativo, necesita la mitad como máximo o el
  // receptor no puede distinguir un paquete nuevo de uno viejo reenviado
  // con el número de secuencia envuelto (wrap-around).
  static maxWindowSize(policy, sequenceBits) {
    const range = 2 ** sequenceBits;
    return policy === 'sr' ? Math.floor(range / 2) : range - 1;
  }

  isFinished() {
    return this.base >= this.totalPackets;
  }

  reset() {
    this.base = 0;
    this.nextSeqNum = 0;
  }
}
