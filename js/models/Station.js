// Station.js — una "estación" del diálogo full-duplex con piggybacking.
// Cada estación es simultáneamente emisora Y receptora: compone un
// Sender (para lo que ELLA manda) + un Receiver (para lo que recibe del
// otro lado) + una cola de ACKs pendientes de despachar.
//
// La cola de ACKs pendientes es el corazón del piggybacking: cuando el
// Receiver de esta estación acepta (o descarta) un paquete, el ACK
// correspondiente NO se manda de inmediato — se encola aquí, esperando
// a que esta estación tenga su propio dato listo para "montarlo encima"
// (piggyback). Si pasa demasiado tiempo sin esa oportunidad
// (`ackHoldMs`), se despacha solo (ACK puro / naked ACK).

import { Sender } from './Sender.js';
import { Receiver } from './Receiver.js';

export class Station {
  constructor({ id, totalPackets, windowSize, timeoutMs, policy, sequenceBits, ackHoldMs, onEvent }) {
    this.id = id; // 'A' | 'B'
    this.ackHoldMs = ackHoldMs;
    this.sequenceBits = sequenceBits;
    this.onEvent = onEvent || (() => {});

    this.sender = new Sender({
      totalPackets,
      windowSize,
      timeoutMs,
      policy,
      onEvent: (type, data) => this.onEvent('sender', type, data)
    });

    this.receiver = new Receiver({
      policy,
      windowSize,
      onEvent: (type, data) => this.onEvent('receiver', type, data)
    });

    this.pendingAcks = []; // cola FIFO de { ackNum, elapsedMs }

    // Retransmisiones escalonadas (mismo patrón que Simulation.js, pero
    // por estación — cada una tiene su propia cascada independiente).
    this.pendingRetransmissions = [];
    this.retransmissionTimerMs = 0;

    // Auto-send propio de esta estación.
    this.autoSendEnabled = false;
    this.autoSendTimer = 0;
  }

  setPolicy(policy) {
    this.sender.setPolicy(policy);
    this.receiver.setPolicy(policy);
  }

  setWindowSize(size) {
    this.sender.setWindowSize(size);
    this.receiver.setWindowSize(size);
  }

  setTimeout(ms) {
    this.sender.setTimeout(ms);
  }

  setAckHold(ms) {
    this.ackHoldMs = ms;
  }

  reset(totalPackets, windowSize) {
    this.sender.reset(totalPackets, windowSize);
    this.receiver.reset();
    this.pendingAcks = [];
    this.pendingRetransmissions = [];
    this.retransmissionTimerMs = 0;
    this.autoSendTimer = 0;
  }

  // ---- cola de ACKs pendientes (piggyback vs. naked) --------------------

  queueAck(ackNum) {
    this.pendingAcks.push({ ackNum, elapsedMs: 0 });
  }

  hasPendingAck() {
    return this.pendingAcks.length > 0;
  }

  oldestPendingAckAge() {
    return this.pendingAcks.length ? this.pendingAcks[0].elapsedMs : 0;
  }

  advanceAckHold(dtMs) {
    for (const entry of this.pendingAcks) entry.elapsedMs += dtMs;
  }

  // Saca el ACK más antiguo de la cola — se usa tanto para montarlo en
  // el próximo dato saliente como para mandarlo solo si se acabó la espera.
  popAck() {
    return this.pendingAcks.shift();
  }

  isFinished() {
    return this.sender.isFinished();
  }
}
