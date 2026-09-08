// Receiver.js — el lado receptor. Soporta dos políticas:
//   'gbn': solo acepta el paquete esperado, en orden estricto. Cualquier
//     otra cosa se descarta y se re-confirma con el último ACK acumulado.
//   'sr' : acepta y guarda en buffer cualquier paquete dentro de la
//     ventana de recepción, aunque llegue fuera de orden. Responde con un
//     ACK individual (selectivo) por cada paquete, y solo "entrega" hacia
//     arriba la racha contigua que empieza en expectedSeqNum.

export class Receiver {
  constructor({ onEvent, policy = 'gbn', windowSize = 4 } = {}) {
    this.policy = policy;
    this.windowSize = windowSize;
    this.expectedSeqNum = 0;
    this.onEvent = onEvent || (() => {});
    this.receivedLog = []; // sequence numbers entregados en orden
    this.buffer = new Set(); // SR: seqs recibidos pero aún no "entregados"
  }

  setPolicy(policy) {
    this.policy = policy;
    this.buffer.clear();
  }

  setWindowSize(size) {
    this.windowSize = size;
  }

  // Returns { accepted: boolean, ackNum: number|null }
  handlePacket(seq) {
    return this.policy === 'gbn' ? this._handleGBN(seq) : this._handleSR(seq);
  }

  _handleGBN(seq) {
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

  _handleSR(seq) {
    // Ya fue entregado antes: probablemente el ACK original se perdió.
    // Se descarta el duplicado pero se re-confirma con su propio ACK
    // selectivo, para que el emisor pueda salir de su timeout.
    if (seq < this.expectedSeqNum) {
      this.onEvent('packet-duplicate', { seq, ackNum: seq });
      return { accepted: false, ackNum: seq, duplicate: true };
    }

    // Fuera de la ventana de recepción: no hay dónde guardarlo, se ignora.
    if (seq >= this.expectedSeqNum + this.windowSize) {
      this.onEvent('packet-discarded', { seq, expected: this.expectedSeqNum, ackNum: null });
      return { accepted: false, ackNum: null };
    }

    // Dentro de la ventana: se guarda en buffer (aunque llegue fuera de
    // orden) y se confirma individualmente — este es el corazón de SR.
    const wasNew = !this.buffer.has(seq);
    this.buffer.add(seq);

    // Si se completó una racha contigua desde expectedSeqNum, se "entrega".
    while (this.buffer.has(this.expectedSeqNum)) {
      this.buffer.delete(this.expectedSeqNum);
      this.receivedLog.push(this.expectedSeqNum);
      this.expectedSeqNum += 1;
    }

    this.onEvent(wasNew ? 'packet-accepted' : 'packet-duplicate', { seq, ackNum: seq });
    return { accepted: wasNew, ackNum: seq };
  }

  reset() {
    this.expectedSeqNum = 0;
    this.receivedLog = [];
    this.buffer.clear();
  }
}
