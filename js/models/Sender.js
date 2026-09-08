// Sender.js — el lado emisor. Soporta dos políticas ARQ:
//   'gbn' (Go-Back-N): UN solo temporizador atado a `base`. Al vencer,
//     se retransmite TODO el rango base..nextSeqNum-1.
//   'sr'  (Selective Repeat): un temporizador INDEPENDIENTE por cada
//     paquete enviado y aún sin confirmar. Al vencer uno, se retransmite
//     SOLO ese paquete — los demás siguen su propio reloj sin verse
//     afectados.

import { Packet } from './Packet.js';
import { SlidingWindow } from './SlidingWindow.js';

export class Sender {
  constructor({ totalPackets, windowSize, timeoutMs, policy = 'gbn', onEvent }) {
    this.totalPackets = totalPackets;
    this.policy = policy; // 'gbn' | 'sr'
    this.window = new SlidingWindow(windowSize, totalPackets);
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent || (() => {});
    this.packets = this._buildPackets(totalPackets);

    // Go-Back-N: un solo timer atado a la base.
    this.timerElapsed = 0;
    this.timerActive = false;

    // Selective Repeat: un timer por paquete en vuelo. Map<seq, elapsedMs>.
    this.timers = new Map();
  }

  _buildPackets(total) {
    return Array.from({ length: total }, (_, i) => new Packet(i));
  }

  setTotalPackets(total) {
    this.totalPackets = total;
    this.packets = this._buildPackets(total);
    this.window.setTotalPackets(total);
    this.stopTimer();
    this.timers.clear();
  }

  setWindowSize(size) {
    this.window.resize(size);
  }

  setTimeout(ms) {
    this.timeoutMs = ms;
  }

  setPolicy(policy) {
    this.policy = policy;
    this.stopTimer();
    this.timers.clear();
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
    if (this.policy === 'gbn') {
      if (!this.timerActive) this.startTimer();
    } else {
      // SR: este paquete arranca su propio reloj de retransmisión.
      this.timers.set(seq, 0);
    }
    this.onEvent('data-sent', { seq, attempts: packet.attempts });
  }

  markInTransit(seq) {
    this.packets[seq].markInTransit();
  }

  // ---- timer (Go-Back-N: un solo timer atado a la base) ----------------

  startTimer() {
    this.timerActive = true;
    this.timerElapsed = 0;
  }

  stopTimer() {
    this.timerActive = false;
    this.timerElapsed = 0;
  }

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

  // ---- timers (Selective Repeat: uno por paquete) -----------------------

  // Avanza todos los timers activos (SR) o el único timer (GBN) según la
  // política. Devuelve la lista de números de secuencia que vencieron.
  advanceTimers(dtMs) {
    if (this.policy === 'gbn') {
      if (this.tickTimer(dtMs)) {
        return this.packetsToRetransmit().map((p) => p.seq);
      }
      return [];
    }

    const expired = [];
    for (const [seq, elapsed] of this.timers) {
      const next = elapsed + dtMs;
      if (next >= this.timeoutMs) {
        expired.push(seq);
      } else {
        this.timers.set(seq, next);
      }
    }
    return expired;
  }

  // Progreso [0,1] del timer más próximo a vencer. Útil para pintar UNA
  // sola barra representativa en SR (aunque haya varios timers a la vez).
  soonestTimerProgress() {
    if (this.policy === 'gbn') return this.timerProgress();
    if (this.timers.size === 0) return { active: false, progress: 0, seq: null };
    let bestSeq = null;
    let bestElapsed = -Infinity;
    for (const [seq, elapsed] of this.timers) {
      if (elapsed > bestElapsed) {
        bestElapsed = elapsed;
        bestSeq = seq;
      }
    }
    return { active: true, progress: Math.min(1, bestElapsed / this.timeoutMs), seq: bestSeq };
  }

  // Packets that must be retransmitted right now: base .. nextSeqNum-1.
  // (Solo tiene sentido en Go-Back-N: en SR cada paquete se maneja aparte.)
  packetsToRetransmit() {
    const list = [];
    for (let s = this.window.base; s < this.window.nextSeqNum; s++) {
      list.push(this.packets[s]);
    }
    return list;
  }

  // Go-Back-N: vence el timer de la base -> se reenvía toda la ventana.
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

  // Selective Repeat: vence el timer de UN paquete específico -> se
  // reinicia solo ese timer y se retransmite solo ese paquete.
  onTimeoutSR(seq) {
    this.onEvent('timeout-sr', { seq });
    if (this.packets[seq] && this.packets[seq].status !== 'acked') {
      this.timers.set(seq, 0); // reinicia su propio reloj
      return this.packets[seq];
    }
    this.timers.delete(seq);
    return null;
  }

  // ---- ACK handling ----------------------------------------------------

  handleAck(ackNum) {
    if (this.policy === 'gbn') return this._handleAckCumulative(ackNum);
    return this._handleAckSelective(ackNum);
  }

  // Go-Back-N: ACK n confirma TODO hasta n inclusive; la base salta directo.
  _handleAckCumulative(ackNum) {
    if (ackNum < this.window.base) {
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
      this.startTimer();
    }
    return { moved: this.window.base !== previousBase };
  }

  // Selective Repeat: ACK n confirma SOLO el paquete n. La base únicamente
  // avanza si hay una racha contigua ya confirmada empezando en `base`
  // (si `base` sigue sin confirmar, la ventana no se mueve aunque paquetes
  // más adelante ya estén acked).
  _handleAckSelective(ackNum) {
    const packet = this.packets[ackNum];
    if (!packet || packet.status === 'acked' || ackNum < this.window.base) {
      this.onEvent('ack-stale', { ackNum, base: this.window.base });
      return { moved: false };
    }

    packet.markAcked();
    this.timers.delete(ackNum);

    const previousBase = this.window.base;
    this.window.advanceBaseWhileAcked((seq) => this.packets[seq]?.status === 'acked');

    this.onEvent('ack-applied', { ackNum, newBase: this.window.base });
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
    this.timers.clear();
  }
}